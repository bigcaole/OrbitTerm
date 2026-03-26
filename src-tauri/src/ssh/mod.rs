use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use russh::client;
use russh::keys::{decode_openssh, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::{error::Error as SftpError, SftpSession};
use russh_sftp::protocol::{FileType, OpenFlags, StatusCode};
use tauri::{AppHandle, Manager};
use tokio::fs as tokio_fs;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio::time::timeout;
use uuid::Uuid;

use crate::error::{map_russh_error, SshBackendError, SshResult};
use crate::models::{
    AuthMethod, SftpDownloadRequest, SftpEntry, SftpLsRequest, SftpLsResponse, SftpMkdirRequest,
    SftpRenameRequest, SftpRmRequest, SftpTransferProgressEvent, SftpTransferResponse,
    SftpUploadRequest, SshClosedEvent, SshConnectRequest, SshConnectedResponse,
    SshDiagnosticLogEvent, SshErrorEvent, SshOutputEvent,
};

#[derive(Debug)]
pub enum SessionCommand {
    Input(String),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

#[derive(Clone)]
struct SessionEntry {
    command_tx: mpsc::Sender<SessionCommand>,
    handle: Arc<Mutex<client::Handle<ClientHandler>>>,
    tunnel_handles: Vec<Arc<Mutex<client::Handle<ClientHandler>>>>,
}

#[derive(Clone, Default)]
pub struct SshSessionRegistry {
    sessions: Arc<RwLock<HashMap<String, SessionEntry>>>,
}

#[derive(Debug, Default, Clone)]
struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

impl SshSessionRegistry {
    pub async fn connect(
        &self,
        app: AppHandle,
        request: SshConnectRequest,
    ) -> SshResult<SshConnectedResponse> {
        validate_connect_request(&request)?;

        let timeout_secs = request
            .host_config
            .advanced_options
            .connection_timeout
            .max(3);
        let cols = request.cols.unwrap_or(120).max(40);
        let rows = request.rows.unwrap_or(30).max(10);
        let term = request
            .term
            .clone()
            .unwrap_or_else(|| "xterm-256color".to_string());

        let session_id = request
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());

        let backend = pty_backend_name().to_string();

        let mut config = client::Config::default();
        // inactivity_timeout 代表会话空闲断开阈值，不应复用“连接超时”配置，
        // 否则会在短时间无输入时频繁断线（例如 10 秒）。
        config.inactivity_timeout = None;
        if request.host_config.advanced_options.keep_alive_enabled {
            let interval = request
                .host_config
                .advanced_options
                .keep_alive_interval
                .max(5);
            config.keepalive_interval = Some(Duration::from_secs(interval));
            config.keepalive_max = 3;
        } else {
            config.keepalive_interval = None;
        }
        emit_diagnostic_log(
            &app,
            &session_id,
            "info",
            "kex",
            format!(
                "KEX 偏好: {}",
                format_algorithm_list(config.preferred.kex.as_ref(), 4)
            ),
        );
        let jump_auth_chain = request
            .proxy_chain
            .iter()
            .map(|hop| auth_method_label(&hop.identity_config.auth_config.method))
            .collect::<Vec<&str>>();
        emit_diagnostic_log(
            &app,
            &session_id,
            "info",
            "auth",
            format!(
                "认证方式: 主机 [{}], 跳板链 {}",
                auth_method_label(&request.identity_config.auth_config.method),
                if jump_auth_chain.is_empty() {
                    "无".to_string()
                } else {
                    jump_auth_chain.join(" -> ")
                }
            ),
        );

        let config = Arc::new(config);
        let (handle_ref, tunnel_handles) =
            establish_connection_chain(&request, config, timeout_secs, &app, &session_id).await?;

        let mut channel = {
            let guard = handle_ref.lock().await;
            guard
                .channel_open_session()
                .await
                .map_err(|err| map_russh_error(&err))?
        };

        channel
            .request_pty(true, &term, u32::from(cols), u32::from(rows), 0, 0, &[])
            .await
            .map_err(|err| map_russh_error(&err))?;

        channel
            .request_shell(true)
            .await
            .map_err(|err| map_russh_error(&err))?;

        let (command_tx, mut command_rx) = mpsc::channel::<SessionCommand>(512);

        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(
                session_id.clone(),
                SessionEntry {
                    command_tx: command_tx.clone(),
                    handle: handle_ref.clone(),
                    tunnel_handles: tunnel_handles.clone(),
                },
            );
        }

        let registry = self.clone();
        let app_for_loop = app.clone();
        let loop_session_id = session_id.clone();
        let handle_for_loop = handle_ref.clone();
        let tunnel_handles_for_loop = tunnel_handles;
        tokio::spawn(async move {
            let mut writer = channel.make_writer();
            let mut has_error = false;

            loop {
                tokio::select! {
                    cmd = command_rx.recv() => {
                        match cmd {
                            Some(SessionCommand::Input(data)) => {
                                if writer.write_all(data.as_bytes()).await.is_err() {
                                    has_error = true;
                                    emit_error(
                                        &app_for_loop,
                                        Some(loop_session_id.clone()),
                                        SshBackendError::ChannelClosed,
                                    );
                                    break;
                                }
                            }
                            Some(SessionCommand::Resize { cols, rows }) => {
                                let remote_resize = channel
                                    .window_change(u32::from(cols), u32::from(rows), 0, 0)
                                    .await;
                                if let Err(err) = remote_resize {
                                    has_error = true;
                                    emit_error(
                                        &app_for_loop,
                                        Some(loop_session_id.clone()),
                                        map_russh_error(&err),
                                    );
                                    break;
                                }
                            }
                            Some(SessionCommand::Disconnect) | None => {
                                break;
                            }
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                let payload = SshOutputEvent {
                                    session_id: loop_session_id.clone(),
                                    data: String::from_utf8_lossy(&data).to_string(),
                                };
                                if app_for_loop.emit_all("ssh-output", payload).is_err() {
                                    break;
                                }
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let payload = SshOutputEvent {
                                    session_id: loop_session_id.clone(),
                                    data: String::from_utf8_lossy(&data).to_string(),
                                };
                                if app_for_loop.emit_all("ssh-output", payload).is_err() {
                                    break;
                                }
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                                break;
                            }
                            Some(_) => {}
                            None => {
                                break;
                            }
                        }
                    }
                }
            }

            let _ = channel.eof().await;
            let _ = channel.close().await;
            {
                let guard = handle_for_loop.lock().await;
                let _ = guard
                    .disconnect(Disconnect::ByApplication, "session closed", "zh-CN")
                    .await;
            }
            for tunnel_handle in tunnel_handles_for_loop.iter().rev() {
                let guard = tunnel_handle.lock().await;
                let _ = guard
                    .disconnect(Disconnect::ByApplication, "session closed", "zh-CN")
                    .await;
            }

            registry.remove_session(&loop_session_id).await;

            if !has_error {
                let _ = app_for_loop.emit_all(
                    "ssh-closed",
                    SshClosedEvent {
                        session_id: loop_session_id,
                    },
                );
            }
        });

        Ok(SshConnectedResponse {
            session_id,
            pty_backend: backend,
        })
    }

    pub async fn write_input(&self, session_id: &str, data: String) -> SshResult<()> {
        let tx = self.get_sender(session_id).await?;
        tx.send(SessionCommand::Input(data))
            .await
            .map_err(|_| SshBackendError::ChannelClosed)
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> SshResult<()> {
        let tx = self.get_sender(session_id).await?;
        tx.send(SessionCommand::Resize { cols, rows })
            .await
            .map_err(|_| SshBackendError::ChannelClosed)
    }

    pub async fn disconnect(&self, session_id: &str) -> SshResult<()> {
        let entry = self.get_entry(session_id).await?;
        let send_result = entry.command_tx.send(SessionCommand::Disconnect).await;
        if send_result.is_ok() {
            return Ok(());
        }

        self.force_close_entry(session_id.to_string(), entry).await;
        Err(SshBackendError::ChannelClosed)
    }

    pub async fn sftp_ls(&self, request: SftpLsRequest) -> SshResult<SftpLsResponse> {
        let target_path = if request.path.trim().is_empty() {
            ".".to_string()
        } else {
            request.path.clone()
        };

        let sftp = self.open_sftp_session(&request.session_id).await?;
        let canonical_path = sftp
            .canonicalize(target_path)
            .await
            .map_err(map_sftp_error)?;

        let mut entries = Vec::new();
        let read_dir = sftp
            .read_dir(canonical_path.clone())
            .await
            .map_err(map_sftp_error)?;

        for entry in read_dir {
            let metadata = entry.metadata();
            let file_type = metadata.file_type();
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let path = join_remote_path(&canonical_path, &name);
            let modified_at = metadata.mtime.map(i64::from);
            entries.push(SftpEntry {
                name,
                path,
                is_dir: file_type.is_dir(),
                size: metadata.len(),
                modified_at,
                file_type: file_type_label(file_type).to_string(),
            });
        }

        entries.sort_by(|left, right| {
            right
                .is_dir
                .cmp(&left.is_dir)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        });

        let _ = sftp.close().await;

        Ok(SftpLsResponse {
            path: canonical_path,
            entries,
        })
    }

    pub async fn sftp_mkdir(&self, request: SftpMkdirRequest) -> SshResult<()> {
        if request.path.trim().is_empty() {
            return Err(SshBackendError::InvalidInput);
        }

        let sftp = self.open_sftp_session(&request.session_id).await?;
        sftp.create_dir(request.path)
            .await
            .map_err(map_sftp_error)?;
        let _ = sftp.close().await;
        Ok(())
    }

    pub async fn sftp_rm(&self, request: SftpRmRequest) -> SshResult<()> {
        if request.path.trim().is_empty() {
            return Err(SshBackendError::InvalidInput);
        }

        let sftp = self.open_sftp_session(&request.session_id).await?;
        if request.recursive {
            remove_remote_path_recursive(&sftp, request.path).await?;
        } else {
            let metadata = sftp
                .symlink_metadata(request.path.clone())
                .await
                .map_err(map_sftp_error)?;
            if metadata.file_type().is_dir() {
                sftp.remove_dir(request.path)
                    .await
                    .map_err(map_sftp_error)?;
            } else {
                sftp.remove_file(request.path)
                    .await
                    .map_err(map_sftp_error)?;
            }
        }
        let _ = sftp.close().await;
        Ok(())
    }

    pub async fn sftp_rename(&self, request: SftpRenameRequest) -> SshResult<()> {
        if request.from_path.trim().is_empty() || request.to_path.trim().is_empty() {
            return Err(SshBackendError::InvalidInput);
        }

        let sftp = self.open_sftp_session(&request.session_id).await?;
        sftp.rename(request.from_path, request.to_path)
            .await
            .map_err(map_sftp_error)?;
        let _ = sftp.close().await;
        Ok(())
    }

    pub async fn sftp_download(
        &self,
        request: SftpDownloadRequest,
    ) -> SshResult<SftpTransferResponse> {
        if request.remote_path.trim().is_empty() || request.local_path.trim().is_empty() {
            return Err(SshBackendError::InvalidInput);
        }

        let sftp = self.open_sftp_session(&request.session_id).await?;
        let mut remote_file = sftp
            .open(request.remote_path.clone())
            .await
            .map_err(map_sftp_error)?;

        if let Some(parent) = Path::new(request.local_path.as_str()).parent() {
            tokio_fs::create_dir_all(parent).await.map_err(|err| {
                SshBackendError::SftpOperation(format!("创建本地目录失败：{err}"))
            })?;
        }

        let mut local_file = tokio_fs::File::create(request.local_path.clone())
            .await
            .map_err(|err| SshBackendError::SftpOperation(format!("创建本地文件失败：{err}")))?;

        let mut copied: u64 = 0;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read_len = remote_file.read(&mut buffer).await.map_err(|err| {
                SshBackendError::SftpOperation(format!("读取远端文件失败：{err}"))
            })?;
            if read_len == 0 {
                break;
            }

            local_file
                .write_all(&buffer[..read_len])
                .await
                .map_err(|err| {
                    SshBackendError::SftpOperation(format!("写入本地文件失败：{err}"))
                })?;
            copied = copied.saturating_add(read_len as u64);
        }

        local_file
            .flush()
            .await
            .map_err(|err| SshBackendError::SftpOperation(format!("刷新本地文件失败：{err}")))?;

        let _ = sftp.close().await;
        Ok(SftpTransferResponse {
            path: request.local_path,
            bytes: copied,
        })
    }

    pub async fn sftp_upload(
        &self,
        app: AppHandle,
        request: SftpUploadRequest,
    ) -> SshResult<SftpTransferResponse> {
        if request.remote_path.trim().is_empty() || request.local_path.trim().is_empty() {
            return Err(SshBackendError::InvalidInput);
        }

        let mut local_file = tokio_fs::File::open(request.local_path.clone())
            .await
            .map_err(|err| SshBackendError::SftpOperation(format!("读取本地文件失败：{err}")))?;
        let metadata = local_file.metadata().await.map_err(|err| {
            SshBackendError::SftpOperation(format!("读取本地文件信息失败：{err}"))
        })?;
        let total_size = metadata.len();

        let sftp = self.open_sftp_session(&request.session_id).await?;
        let mut remote_file = sftp
            .open_with_flags(
                request.remote_path.clone(),
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
            .map_err(map_sftp_error)?;

        let mut transferred: u64 = 0;
        let mut emitted_progress: u8 = 0;
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            let read_len = local_file.read(&mut buffer).await.map_err(|err| {
                SshBackendError::SftpOperation(format!("读取本地文件失败：{err}"))
            })?;
            if read_len == 0 {
                break;
            }

            remote_file
                .write_all(&buffer[..read_len])
                .await
                .map_err(|err| {
                    SshBackendError::SftpOperation(format!("写入远端文件失败：{err}"))
                })?;
            transferred = transferred.saturating_add(read_len as u64);

            let progress = if total_size == 0 {
                100
            } else {
                let ratio = (transferred.saturating_mul(100) / total_size).min(100);
                ratio as u8
            };
            if progress != emitted_progress {
                emitted_progress = progress;
                let _ = app.emit_all(
                    "sftp-upload-progress",
                    SftpTransferProgressEvent {
                        session_id: request.session_id.clone(),
                        remote_path: request.remote_path.clone(),
                        local_path: request.local_path.clone(),
                        progress,
                    },
                );
            }
        }

        remote_file
            .shutdown()
            .await
            .map_err(|err| SshBackendError::SftpOperation(format!("关闭远端文件失败：{err}")))?;

        if emitted_progress < 100 {
            let _ = app.emit_all(
                "sftp-upload-progress",
                SftpTransferProgressEvent {
                    session_id: request.session_id.clone(),
                    remote_path: request.remote_path.clone(),
                    local_path: request.local_path.clone(),
                    progress: 100,
                },
            );
        }

        let _ = sftp.close().await;
        Ok(SftpTransferResponse {
            path: request.remote_path,
            bytes: transferred,
        })
    }

    async fn get_sender(&self, session_id: &str) -> SshResult<mpsc::Sender<SessionCommand>> {
        let entry = self.get_entry(session_id).await?;
        Ok(entry.command_tx)
    }

    async fn open_sftp_session(&self, session_id: &str) -> SshResult<SftpSession> {
        let entry = self.get_entry(session_id).await?;
        let channel = {
            let guard = entry.handle.lock().await;
            guard
                .channel_open_session()
                .await
                .map_err(|err| map_russh_error(&err))?
        };

        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|err| map_russh_error(&err))?;

        SftpSession::new(channel.into_stream())
            .await
            .map_err(map_sftp_error)
    }

    async fn get_entry(&self, session_id: &str) -> SshResult<SessionEntry> {
        let sessions = self.sessions.read().await;
        sessions
            .get(session_id)
            .cloned()
            .ok_or(SshBackendError::SessionNotFound)
    }

    async fn remove_session(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
    }

    async fn force_close_entry(&self, session_id: String, entry: SessionEntry) {
        {
            let guard = entry.handle.lock().await;
            let _ = guard
                .disconnect(Disconnect::ByApplication, "session closed", "zh-CN")
                .await;
        }

        for tunnel_handle in entry.tunnel_handles.iter().rev() {
            let guard = tunnel_handle.lock().await;
            let _ = guard
                .disconnect(Disconnect::ByApplication, "session closed", "zh-CN")
                .await;
        }

        self.remove_session(&session_id).await;
    }
}

fn validate_connect_request(request: &SshConnectRequest) -> SshResult<()> {
    if request.host_config.basic_info.address.trim().is_empty()
        || request.identity_config.username.trim().is_empty()
    {
        return Err(SshBackendError::InvalidInput);
    }

    if request.host_config.identity_id.trim().is_empty()
        || request.identity_config.id.trim().is_empty()
        || request.host_config.identity_id != request.identity_config.id
    {
        return Err(SshBackendError::InvalidInput);
    }

    for hop in &request.proxy_chain {
        if hop.host_config.basic_info.address.trim().is_empty()
            || hop.identity_config.username.trim().is_empty()
            || hop.host_config.identity_id.trim().is_empty()
            || hop.identity_config.id.trim().is_empty()
            || hop.host_config.identity_id != hop.identity_config.id
        {
            return Err(SshBackendError::InvalidInput);
        }
    }

    if !is_identity_auth_valid(&request.identity_config) {
        return Err(SshBackendError::InvalidInput);
    }
    for hop in &request.proxy_chain {
        if !is_identity_auth_valid(&hop.identity_config) {
            return Err(SshBackendError::InvalidInput);
        }
    }

    Ok(())
}

fn is_identity_auth_valid(identity: &crate::models::IdentityConfig) -> bool {
    match identity.auth_config.method {
        AuthMethod::Password => {
            identity
                .auth_config
                .password
                .as_deref()
                .unwrap_or_default()
                .trim()
                .len()
                > 0
        }
        AuthMethod::PrivateKey => {
            identity
                .auth_config
                .private_key
                .as_deref()
                .unwrap_or_default()
                .trim()
                .len()
                > 0
        }
    }
}

async fn establish_connection_chain(
    request: &SshConnectRequest,
    config: Arc<client::Config>,
    timeout_secs: u64,
    app: &AppHandle,
    session_id: &str,
) -> SshResult<(
    Arc<Mutex<client::Handle<ClientHandler>>>,
    Vec<Arc<Mutex<client::Handle<ClientHandler>>>>,
)> {
    let mut all_targets = request.proxy_chain.clone();
    all_targets.push(crate::models::ProxyJumpHop {
        host_config: request.host_config.clone(),
        identity_config: request.identity_config.clone(),
    });

    let mut tunnel_handles: Vec<Arc<Mutex<client::Handle<ClientHandler>>>> = Vec::new();
    let mut previous_handle_ref: Option<Arc<Mutex<client::Handle<ClientHandler>>>> = None;
    let total_targets = all_targets.len();

    for (idx, target) in all_targets.into_iter().enumerate() {
        let hop_label = format!(
            "第 {}/{} 跳 {}:{}",
            idx + 1,
            total_targets,
            target.host_config.basic_info.address,
            target.host_config.basic_info.port
        );
        emit_diagnostic_log(
            app,
            session_id,
            "info",
            "connect",
            format!("开始连接 {hop_label}"),
        );

        let mut next_handle = if let Some(parent) = previous_handle_ref.as_ref() {
            match connect_via_parent(
                parent.clone(),
                config.clone(),
                target.host_config.basic_info.address.as_str(),
                target.host_config.basic_info.port,
                timeout_secs,
            )
            .await
            {
                Ok(handle) => handle,
                Err(err) => {
                    emit_diagnostic_log(
                        app,
                        session_id,
                        "error",
                        "connect",
                        format!("{hop_label} 连接失败: {}", err.user_message()),
                    );
                    return Err(err);
                }
            }
        } else {
            match connect_direct(
                config.clone(),
                target.host_config.basic_info.address.as_str(),
                target.host_config.basic_info.port,
                timeout_secs,
            )
            .await
            {
                Ok(handle) => handle,
                Err(err) => {
                    emit_diagnostic_log(
                        app,
                        session_id,
                        "error",
                        "connect",
                        format!("{hop_label} 连接失败: {}", err.user_message()),
                    );
                    return Err(err);
                }
            }
        };

        emit_diagnostic_log(
            app,
            session_id,
            "info",
            "connect",
            format!("{hop_label} TCP 通道已建立"),
        );
        authenticate_identity(
            &mut next_handle,
            &target.identity_config,
            timeout_secs,
            app,
            session_id,
            &hop_label,
        )
        .await?;
        let next_ref = Arc::new(Mutex::new(next_handle));

        if idx + 1 < total_targets {
            tunnel_handles.push(next_ref.clone());
        }
        previous_handle_ref = Some(next_ref);
    }

    let final_handle = previous_handle_ref.ok_or(SshBackendError::InvalidInput)?;
    Ok((final_handle, tunnel_handles))
}

async fn connect_direct(
    config: Arc<client::Config>,
    host: &str,
    port: u16,
    timeout_secs: u64,
) -> SshResult<client::Handle<ClientHandler>> {
    let address = format!("{host}:{port}");
    timeout(
        Duration::from_secs(timeout_secs),
        client::connect(config, address, ClientHandler),
    )
    .await
    .map_err(|_| SshBackendError::Timeout)
    .and_then(|result| result.map_err(|err| map_russh_error(&err)))
}

async fn connect_via_parent(
    parent: Arc<Mutex<client::Handle<ClientHandler>>>,
    config: Arc<client::Config>,
    host: &str,
    port: u16,
    timeout_secs: u64,
) -> SshResult<client::Handle<ClientHandler>> {
    let direct_channel = {
        let guard = parent.lock().await;
        timeout(
            Duration::from_secs(timeout_secs),
            guard.channel_open_direct_tcpip(
                host.to_string(),
                u32::from(port),
                "127.0.0.1".to_string(),
                0,
            ),
        )
        .await
        .map_err(|_| SshBackendError::Timeout)
        .and_then(|result| result.map_err(|err| map_russh_error(&err)))?
    };

    let stream = direct_channel.into_stream();
    timeout(
        Duration::from_secs(timeout_secs),
        client::connect_stream(config, stream, ClientHandler),
    )
    .await
    .map_err(|_| SshBackendError::Timeout)
    .and_then(|result| result.map_err(|err| map_russh_error(&err)))
}

async fn authenticate_identity(
    handle: &mut client::Handle<ClientHandler>,
    identity: &crate::models::IdentityConfig,
    timeout_secs: u64,
    app: &AppHandle,
    session_id: &str,
    hop_label: &str,
) -> SshResult<()> {
    let timeout_duration = Duration::from_secs(timeout_secs);
    let auth_method = auth_method_label(&identity.auth_config.method);
    emit_diagnostic_log(
        app,
        session_id,
        "info",
        "auth",
        format!(
            "{hop_label} 开始认证: username={}, method={auth_method}",
            identity.username
        ),
    );

    let auth_result = match identity.auth_config.method {
        AuthMethod::Password => {
            let password = identity
                .auth_config
                .password
                .clone()
                .ok_or(SshBackendError::InvalidInput)?;
            let result = timeout(
                timeout_duration,
                handle.authenticate_password(identity.username.clone(), password),
            )
            .await
            .map_err(|_| SshBackendError::Timeout)
            .and_then(|result| result.map_err(|err| map_russh_error(&err)));

            match result {
                Ok(value) => value,
                Err(err) => {
                    emit_diagnostic_log(
                        app,
                        session_id,
                        "error",
                        "auth",
                        format!("{hop_label} 认证请求失败: {}", err.user_message()),
                    );
                    return Err(err);
                }
            }
        }
        AuthMethod::PrivateKey => {
            let key_text = identity
                .auth_config
                .private_key
                .as_deref()
                .ok_or(SshBackendError::InvalidInput)?;

            let private_key = decode_openssh(
                key_text.as_bytes(),
                identity.auth_config.passphrase.as_deref(),
            )
            .map_err(|_| SshBackendError::AuthFailure)?;

            let key = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);

            let result = timeout(
                timeout_duration,
                handle.authenticate_publickey(identity.username.clone(), key),
            )
            .await
            .map_err(|_| SshBackendError::Timeout)
            .and_then(|result| result.map_err(|err| map_russh_error(&err)));

            match result {
                Ok(value) => value,
                Err(err) => {
                    emit_diagnostic_log(
                        app,
                        session_id,
                        "error",
                        "auth",
                        format!("{hop_label} 认证请求失败: {}", err.user_message()),
                    );
                    return Err(err);
                }
            }
        }
    };

    if !auth_result.success() {
        emit_diagnostic_log(
            app,
            session_id,
            "warn",
            "auth",
            format!("{hop_label} 认证失败（服务器拒绝）。"),
        );
        return Err(SshBackendError::AuthFailure);
    }

    emit_diagnostic_log(
        app,
        session_id,
        "info",
        "auth",
        format!("{hop_label} 认证成功。"),
    );
    Ok(())
}

fn map_sftp_error(err: SftpError) -> SshBackendError {
    match err {
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoSuchFile => SshBackendError::SftpNotFound,
            StatusCode::PermissionDenied => SshBackendError::SftpPermissionDenied,
            StatusCode::OpUnsupported => SshBackendError::SftpUnsupported,
            StatusCode::Failure if status.error_message.to_lowercase().contains("exist") => {
                SshBackendError::SftpAlreadyExists
            }
            _ => SshBackendError::SftpOperation(status.error_message),
        },
        SftpError::Timeout => SshBackendError::Timeout,
        SftpError::IO(detail) => SshBackendError::SftpOperation(detail),
        SftpError::Limited(detail) => SshBackendError::SftpOperation(detail),
        SftpError::UnexpectedPacket => {
            SshBackendError::SftpOperation("SFTP 返回了异常数据包".to_string())
        }
        SftpError::UnexpectedBehavior(detail) => SshBackendError::SftpOperation(detail),
    }
}

fn file_type_label(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Dir => "dir",
        FileType::File => "file",
        FileType::Symlink => "symlink",
        FileType::Other => "other",
    }
}

fn join_remote_path(base: &str, name: &str) -> String {
    if base == "/" {
        return format!("/{name}");
    }
    if base.ends_with('/') {
        return format!("{base}{name}");
    }
    format!("{base}/{name}")
}

async fn remove_remote_path_recursive(sftp: &SftpSession, path: String) -> SshResult<()> {
    let metadata = sftp
        .symlink_metadata(path.clone())
        .await
        .map_err(map_sftp_error)?;
    if !metadata.file_type().is_dir() {
        sftp.remove_file(path).await.map_err(map_sftp_error)?;
        return Ok(());
    }

    let mut dir_stack = vec![path.clone()];
    let mut dirs_for_delete = vec![path];
    let mut files_for_delete: Vec<String> = Vec::new();

    while let Some(current_dir) = dir_stack.pop() {
        let read_dir = sftp
            .read_dir(current_dir.clone())
            .await
            .map_err(map_sftp_error)?;

        for entry in read_dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child_path = join_remote_path(&current_dir, &name);
            let child_type = entry.file_type();
            if child_type.is_dir() {
                dirs_for_delete.push(child_path.clone());
                dir_stack.push(child_path);
            } else {
                files_for_delete.push(child_path);
            }
        }
    }

    for file in files_for_delete {
        sftp.remove_file(file).await.map_err(map_sftp_error)?;
    }

    dirs_for_delete.sort_by(|left, right| right.len().cmp(&left.len()));
    for dir in dirs_for_delete {
        sftp.remove_dir(dir).await.map_err(map_sftp_error)?;
    }

    Ok(())
}

fn format_algorithm_list<T: core::fmt::Debug>(items: &[T], max_count: usize) -> String {
    let mut list = Vec::new();
    for item in items.iter().take(max_count) {
        list.push(format!("{item:?}"));
    }
    if items.len() > max_count {
        list.push("...".to_string());
    }
    if list.is_empty() {
        return "unknown".to_string();
    }
    list.join(", ")
}

fn auth_method_label(method: &AuthMethod) -> &'static str {
    match method {
        AuthMethod::Password => "password",
        AuthMethod::PrivateKey => "private_key",
    }
}

fn emit_diagnostic_log(
    app: &AppHandle,
    session_id: &str,
    level: &str,
    stage: &str,
    message: String,
) {
    let payload = SshDiagnosticLogEvent {
        session_id: session_id.to_string(),
        level: level.to_string(),
        stage: stage.to_string(),
        message,
        timestamp: now_unix_ts(),
    };

    let _ = app.emit_all("ssh-diagnostic", payload);
}

fn now_unix_ts() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => 0,
    }
}

fn emit_error(app: &AppHandle, session_id: Option<String>, err: SshBackendError) {
    let payload = SshErrorEvent {
        session_id,
        code: err.code().to_string(),
        message: err.user_message(),
    };

    let _ = app.emit_all("ssh-error", payload);
}

pub fn pty_backend_name() -> &'static str {
    #[cfg(windows)]
    {
        // portable-pty 在 Windows 下默认使用 ConPTY 后端。
        return "ConPTY";
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        return "SystemPTY";
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        "NativePTY"
    }
}
