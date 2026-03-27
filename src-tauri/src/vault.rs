use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, State};
use thiserror::Error;
use tokio::fs;
use tokio::sync::RwLock;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::e2ee::{
    decrypt_cloud_vault, derive_session_key, encrypt_cloud_vault,
    encrypt_cloud_vault_with_derived_key, CloudVault, E2eeError, EncryptedVault, DERIVED_KEY_LEN,
};
use crate::models::{
    ExportEncryptedBackupRequest, ExportEncryptedBackupResponse, HostAdvancedOptions,
    HostAuthConfig, HostConfig, IdentityConfig, SaveVaultRequest, SaveVaultResponse,
    Snippet, UnlockAndLoadRequest, UnlockAndLoadResponse, VaultSyncExportResponse,
    VaultSyncImportRequest,
};

const VAULT_FILENAME: &str = "vault.bin";
const LEGACY_VAULT_FILENAME: &str = "cloud-vault.enc.json";

#[derive(Default)]
pub struct VaultSessionState {
    pub master_password: RwLock<Option<Zeroizing<String>>>,
    pub derived_key: RwLock<Option<Zeroizing<[u8; DERIVED_KEY_LEN]>>>,
    pub salt: RwLock<Option<[u8; 16]>>,
    pub version: RwLock<Option<u64>>,
    pub updated_at: RwLock<Option<i64>>,
}

#[derive(Debug, Error)]
enum VaultError {
    #[error("主密码不能为空")]
    EmptyPassword,
    #[error("无法定位应用数据目录")]
    AppDataPathUnavailable,
    #[error("读取金库文件失败")]
    ReadFailed,
    #[error("写入金库文件失败")]
    WriteFailed(String),
    #[error("金库格式损坏")]
    Corrupted,
    #[error("解锁失败")]
    UnlockFailed,
    #[error("金库主机列表格式无效")]
    InvalidHosts,
    #[error("金库身份列表格式无效")]
    InvalidIdentities,
    #[error("金库指令列表格式无效")]
    InvalidSnippets,
    #[error("金库尚未解锁")]
    VaultLocked,
    #[error("未找到可导出的加密金库")]
    BackupSourceMissing,
    #[error("同步数据格式无效")]
    InvalidSyncBlob,
}

impl VaultError {
    fn user_message(&self) -> String {
        match self {
            Self::EmptyPassword => "主密码不能为空。".to_string(),
            Self::AppDataPathUnavailable => "无法定位应用数据目录，请检查客户端权限。".to_string(),
            Self::ReadFailed => "读取本地金库失败，请稍后重试。".to_string(),
            Self::WriteFailed(message) => message.clone(),
            Self::Corrupted => "本地金库已损坏，请从备份恢复。".to_string(),
            Self::UnlockFailed => "主密码错误或金库校验失败。".to_string(),
            Self::InvalidHosts => "金库中的主机列表格式无效。".to_string(),
            Self::InvalidIdentities => "金库中的身份列表格式无效。".to_string(),
            Self::InvalidSnippets => "金库中的快捷指令格式无效。".to_string(),
            Self::VaultLocked => "请先解锁金库再保存配置。".to_string(),
            Self::BackupSourceMissing => {
                "未找到可导出的本地加密金库，请先完成一次解锁或保存。".to_string()
            }
            Self::InvalidSyncBlob => "云端同步数据格式无效，请检查同步服务返回内容。".to_string(),
        }
    }
}

impl From<E2eeError> for VaultError {
    fn from(err: E2eeError) -> Self {
        match err {
            E2eeError::EmptyPassword => Self::EmptyPassword,
            E2eeError::WrongMasterPassword => Self::UnlockFailed,
            E2eeError::IntegrityCheckFailed => Self::UnlockFailed,
            E2eeError::InvalidHeader | E2eeError::InvalidPackage => Self::Corrupted,
            E2eeError::DecryptFailed | E2eeError::DeserializeFailed => Self::Corrupted,
            E2eeError::KdfInit | E2eeError::KeyDerivation => Self::UnlockFailed,
            E2eeError::EncryptFailed | E2eeError::SerializeFailed => {
                Self::WriteFailed("写入本地金库失败，请检查磁盘空间或目录权限。".to_string())
            }
        }
    }
}

pub async fn unlock_and_load(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: UnlockAndLoadRequest,
) -> Result<UnlockAndLoadResponse, String> {
    let master_password = Zeroizing::new(request.master_password);

    let result = unlock_and_load_inner(&app, &state, master_password.as_str()).await;
    result.map_err(|err| err.user_message())
}

pub async fn save_vault(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: SaveVaultRequest,
) -> Result<SaveVaultResponse, String> {
    let result = save_vault_inner(&app, &state, request).await;
    result.map_err(|err| err.user_message())
}

pub async fn export_encrypted_backup(
    app: AppHandle,
    request: ExportEncryptedBackupRequest,
) -> Result<ExportEncryptedBackupResponse, String> {
    let result = export_encrypted_backup_inner(&app, request).await;
    result.map_err(|err| err.user_message())
}

pub async fn export_sync_blob(
    app: AppHandle,
) -> Result<VaultSyncExportResponse, String> {
    let result = export_sync_blob_inner(&app).await;
    result.map_err(|err| err.user_message())
}

pub async fn import_sync_blob(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: VaultSyncImportRequest,
) -> Result<UnlockAndLoadResponse, String> {
    let result = import_sync_blob_inner(&app, &state, request).await;
    result.map_err(|err| err.user_message())
}

pub async fn clear_vault_session(state: State<'_, VaultSessionState>) -> Result<(), String> {
    {
        let mut guard = state.master_password.write().await;
        *guard = None;
    }
    {
        let mut guard = state.derived_key.write().await;
        *guard = None;
    }
    {
        let mut guard = state.salt.write().await;
        *guard = None;
    }
    {
        let mut guard = state.version.write().await;
        *guard = None;
    }
    {
        let mut guard = state.updated_at.write().await;
        *guard = None;
    }
    Ok(())
}

async fn unlock_and_load_inner(
    app: &AppHandle,
    state: &State<'_, VaultSessionState>,
    master_password: &str,
) -> Result<UnlockAndLoadResponse, VaultError> {
    if master_password.is_empty() {
        return Err(VaultError::EmptyPassword);
    }

    let encrypted = load_or_initialize_vault(app, master_password).await?;
    let derived_key = derive_session_key(master_password, &encrypted)?;
    let decrypted = decrypt_cloud_vault(master_password, &encrypted)?;
    let (hosts, identities, snippets) = parse_vault_data(&decrypted)?;

    let mut salt = [0_u8; 16];
    if encrypted.salt.len() != salt.len() {
        return Err(VaultError::Corrupted);
    }
    salt.copy_from_slice(&encrypted.salt);

    {
        let mut password_guard = state.master_password.write().await;
        *password_guard = Some(Zeroizing::new(master_password.to_string()));
    }
    {
        let mut key_guard = state.derived_key.write().await;
        *key_guard = Some(derived_key);
    }
    {
        let mut salt_guard = state.salt.write().await;
        *salt_guard = Some(salt);
    }
    {
        let mut version_guard = state.version.write().await;
        *version_guard = Some(decrypted.version);
    }
    {
        let mut updated_at_guard = state.updated_at.write().await;
        *updated_at_guard = Some(decrypted.updated_at);
    }

    Ok(UnlockAndLoadResponse {
        hosts,
        identities,
        snippets,
        version: decrypted.version,
        updated_at: decrypted.updated_at,
    })
}

async fn save_vault_inner(
    app: &AppHandle,
    state: &State<'_, VaultSessionState>,
    request: SaveVaultRequest,
) -> Result<SaveVaultResponse, VaultError> {
    let key_local = {
        let key_guard = state.derived_key.read().await;
        let key = key_guard.as_ref().ok_or(VaultError::VaultLocked)?;
        key.clone()
    };

    let salt_local = {
        let salt_guard = state.salt.read().await;
        (*salt_guard).ok_or(VaultError::VaultLocked)?
    };

    let current_version = {
        let version_guard = state.version.read().await;
        (*version_guard).ok_or(VaultError::VaultLocked)?
    };
    let current_updated_at = {
        let updated_at_guard = state.updated_at.read().await;
        (*updated_at_guard).unwrap_or_else(now_unix_ts)
    };

    let next_version = current_version.saturating_add(1);
    let now = now_unix_ts();
    // Keep monotonic update timestamps to avoid cross-device clock skew issues.
    let next_updated_at = std::cmp::max(now, current_updated_at.saturating_add(1));

    let cloud_vault = CloudVault {
        version: next_version,
        updated_at: next_updated_at,
        data: json!({
            "hosts": request.hosts,
            "identities": request.identities,
            "snippets": request.snippets
        }),
    };

    let encrypted = encrypt_cloud_vault_with_derived_key(&*key_local, &salt_local, &cloud_vault)?;
    let encoded = serde_json::to_vec(&encrypted).map_err(|_| {
        VaultError::WriteFailed("写入本地金库失败，请检查磁盘空间或目录权限。".to_string())
    })?;

    let vault_path = resolve_vault_path(app, VAULT_FILENAME).await?;
    atomic_write(&vault_path, &encoded).await?;

    {
        let mut version_guard = state.version.write().await;
        *version_guard = Some(next_version);
    }
    {
        let mut updated_at_guard = state.updated_at.write().await;
        *updated_at_guard = Some(next_updated_at);
    }

    Ok(SaveVaultResponse {
        version: next_version,
        updated_at: next_updated_at,
    })
}

async fn export_encrypted_backup_inner(
    app: &AppHandle,
    request: ExportEncryptedBackupRequest,
) -> Result<ExportEncryptedBackupResponse, VaultError> {
    let destination = request.destination_path.trim();
    if destination.is_empty() {
        return Err(VaultError::WriteFailed("请选择备份导出路径。".to_string()));
    }

    let source_path = resolve_vault_path(app, VAULT_FILENAME).await?;
    let exists = fs::try_exists(&source_path)
        .await
        .map_err(|_| VaultError::ReadFailed)?;
    if !exists {
        return Err(VaultError::BackupSourceMissing);
    }

    let encrypted_bytes = fs::read(&source_path)
        .await
        .map_err(|_| VaultError::ReadFailed)?;

    let destination_path = PathBuf::from(destination);
    if let Some(parent) = destination_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .await
                .map_err(map_write_io_error)?;
        }
    }

    atomic_write(&destination_path, &encrypted_bytes).await?;

    Ok(ExportEncryptedBackupResponse {
        path: destination.to_string(),
        bytes: encrypted_bytes.len() as u64,
    })
}

async fn export_sync_blob_inner(app: &AppHandle) -> Result<VaultSyncExportResponse, VaultError> {
    let source_path = resolve_vault_path(app, VAULT_FILENAME).await?;
    let exists = fs::try_exists(&source_path)
        .await
        .map_err(|_| VaultError::ReadFailed)?;
    if !exists {
        return Err(VaultError::BackupSourceMissing);
    }

    let encrypted_bytes = fs::read(&source_path)
        .await
        .map_err(|_| VaultError::ReadFailed)?;
    let encrypted = serde_json::from_slice::<EncryptedVault>(&encrypted_bytes)
        .map_err(|_| VaultError::Corrupted)?;

    Ok(VaultSyncExportResponse {
        encrypted_blob_base64: base64::engine::general_purpose::STANDARD.encode(&encrypted_bytes),
        version: encrypted.version,
        updated_at: encrypted.updated_at,
    })
}

async fn import_sync_blob_inner(
    app: &AppHandle,
    state: &State<'_, VaultSessionState>,
    request: VaultSyncImportRequest,
) -> Result<UnlockAndLoadResponse, VaultError> {
    let encoded_blob = request.encrypted_blob_base64.trim();
    if encoded_blob.is_empty() {
        return Err(VaultError::InvalidSyncBlob);
    }

    let master_password = {
        let guard = state.master_password.read().await;
        let password = guard.as_ref().ok_or(VaultError::VaultLocked)?;
        password.to_string()
    };

    let encrypted_bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded_blob)
        .map_err(|_| VaultError::InvalidSyncBlob)?;
    let encrypted = serde_json::from_slice::<EncryptedVault>(&encrypted_bytes)
        .map_err(|_| VaultError::InvalidSyncBlob)?;

    let decrypted = decrypt_cloud_vault(master_password.as_str(), &encrypted)?;
    let derived_key = derive_session_key(master_password.as_str(), &encrypted)?;
    let (hosts, identities, snippets) = parse_vault_data(&decrypted)?;

    let mut salt = [0_u8; 16];
    if encrypted.salt.len() != salt.len() {
        return Err(VaultError::Corrupted);
    }
    salt.copy_from_slice(&encrypted.salt);

    let vault_path = resolve_vault_path(app, VAULT_FILENAME).await?;
    atomic_write(&vault_path, &encrypted_bytes).await?;

    {
        let mut key_guard = state.derived_key.write().await;
        *key_guard = Some(derived_key);
    }
    {
        let mut salt_guard = state.salt.write().await;
        *salt_guard = Some(salt);
    }
    {
        let mut version_guard = state.version.write().await;
        *version_guard = Some(decrypted.version);
    }
    {
        let mut updated_at_guard = state.updated_at.write().await;
        *updated_at_guard = Some(decrypted.updated_at);
    }

    Ok(UnlockAndLoadResponse {
        hosts,
        identities,
        snippets,
        version: decrypted.version,
        updated_at: decrypted.updated_at,
    })
}

async fn load_or_initialize_vault(
    app: &AppHandle,
    master_password: &str,
) -> Result<EncryptedVault, VaultError> {
    let primary_path = resolve_vault_path(app, VAULT_FILENAME).await?;

    match fs::try_exists(&primary_path).await {
        Ok(true) => {
            let content = fs::read(&primary_path)
                .await
                .map_err(|_| VaultError::ReadFailed)?;
            serde_json::from_slice::<EncryptedVault>(&content).map_err(|_| VaultError::Corrupted)
        }
        Ok(false) => {
            let legacy_path = resolve_vault_path(app, LEGACY_VAULT_FILENAME).await?;
            match fs::try_exists(&legacy_path).await {
                Ok(true) => {
                    let content = fs::read(&legacy_path)
                        .await
                        .map_err(|_| VaultError::ReadFailed)?;
                    let encrypted = serde_json::from_slice::<EncryptedVault>(&content)
                        .map_err(|_| VaultError::Corrupted)?;
                    let encoded = serde_json::to_vec(&encrypted).map_err(|_| {
                        VaultError::WriteFailed(
                            "写入本地金库失败，请检查磁盘空间或目录权限。".to_string(),
                        )
                    })?;
                    atomic_write(&primary_path, &encoded).await?;
                    Ok(encrypted)
                }
                Ok(false) => {
                    let initial = CloudVault {
                        version: 1,
                        updated_at: now_unix_ts(),
                        data: json!({
                            "hosts": [],
                            "identities": [],
                            "snippets": []
                        }),
                    };

                    let encrypted = encrypt_cloud_vault(master_password, &initial)?;
                    let encoded = serde_json::to_vec(&encrypted).map_err(|_| {
                        VaultError::WriteFailed(
                            "写入本地金库失败，请检查磁盘空间或目录权限。".to_string(),
                        )
                    })?;
                    atomic_write(&primary_path, &encoded).await?;
                    Ok(encrypted)
                }
                Err(_) => Err(VaultError::ReadFailed),
            }
        }
        Err(_) => Err(VaultError::ReadFailed),
    }
}

async fn resolve_vault_path(app: &AppHandle, filename: &str) -> Result<PathBuf, VaultError> {
    let mut dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or(VaultError::AppDataPathUnavailable)?;

    fs::create_dir_all(&dir).await.map_err(map_write_io_error)?;

    dir.push(filename);
    Ok(dir)
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), VaultError> {
    let base_name = match path.file_name().and_then(|s| s.to_str()) {
        Some(name) => name.to_string(),
        None => "vault".to_string(),
    };
    let tmp_name = format!("{}.{}.tmp", base_name, Uuid::new_v4());
    let tmp_path = path.with_file_name(tmp_name);

    fs::write(&tmp_path, bytes)
        .await
        .map_err(map_write_io_error)?;

    if let Err(err) = fs::rename(&tmp_path, path).await {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(map_write_io_error(err));
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyHostBasicInfo {
    name: String,
    address: String,
    port: u16,
    username: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyHostConfig {
    basic_info: LegacyHostBasicInfo,
    auth_config: HostAuthConfig,
    advanced_options: HostAdvancedOptions,
}

fn parse_vault_data(
    vault: &CloudVault,
) -> Result<(Vec<HostConfig>, Vec<IdentityConfig>, Vec<Snippet>), VaultError> {
    let mut identities = match vault.data.get("identities") {
        Some(value) => serde_json::from_value::<Vec<IdentityConfig>>(value.clone())
            .map_err(|_| VaultError::InvalidIdentities)?,
        None => Vec::new(),
    };

    let snippets = match vault.data.get("snippets") {
        Some(value) => serde_json::from_value::<Vec<Snippet>>(value.clone())
            .map_err(|_| VaultError::InvalidSnippets)?,
        None => Vec::new(),
    };

    let hosts_value = match vault.data.get("hosts") {
        Some(value) => value.clone(),
        None => return Ok((Vec::new(), identities, snippets)),
    };

    if let Ok(hosts) = serde_json::from_value::<Vec<HostConfig>>(hosts_value.clone()) {
        let all_linked = hosts.iter().all(|host| {
            identities
                .iter()
                .any(|identity| identity.id == host.identity_id)
        });
        if !all_linked {
            return Err(VaultError::InvalidIdentities);
        }
        return Ok((hosts, identities, snippets));
    }

    let legacy_hosts = serde_json::from_value::<Vec<LegacyHostConfig>>(hosts_value)
        .map_err(|_| VaultError::InvalidHosts)?;

    let mut migrated_hosts = Vec::with_capacity(legacy_hosts.len());
    for (index, legacy_host) in legacy_hosts.into_iter().enumerate() {
        let mut preferred_id = format!(
            "legacy-identity-{}-{}",
            index + 1,
            legacy_host.basic_info.username
        );
        if preferred_id.trim().is_empty() {
            preferred_id = format!("legacy-identity-{}", index + 1);
        }
        let identity_id = next_identity_id(&identities, &preferred_id);

        identities.push(IdentityConfig {
            id: identity_id.clone(),
            name: format!("迁移身份-{}", legacy_host.basic_info.username),
            username: legacy_host.basic_info.username,
            auth_config: legacy_host.auth_config,
        });

        migrated_hosts.push(HostConfig {
            basic_info: crate::models::HostBasicInfo {
                name: legacy_host.basic_info.name,
                address: legacy_host.basic_info.address,
                port: legacy_host.basic_info.port,
                description: legacy_host.basic_info.description,
            },
            identity_id,
            advanced_options: legacy_host.advanced_options,
        });
    }

    Ok((migrated_hosts, identities, snippets))
}

fn next_identity_id(identities: &[IdentityConfig], preferred_id: &str) -> String {
    let seed = if preferred_id.trim().is_empty() {
        "identity".to_string()
    } else {
        preferred_id.to_string()
    };

    if identities.iter().all(|identity| identity.id != seed) {
        return seed;
    }

    let mut counter = 1_u64;
    loop {
        let candidate = format!("{}-{}", seed, counter);
        if identities.iter().all(|identity| identity.id != candidate) {
            return candidate;
        }
        counter = counter.saturating_add(1);
    }
}

fn map_write_io_error(err: io::Error) -> VaultError {
    let message = match err.kind() {
        io::ErrorKind::PermissionDenied => "保存失败：无写入权限，请检查目录权限。".to_string(),
        io::ErrorKind::StorageFull => "保存失败：磁盘空间不足，请清理后重试。".to_string(),
        _ => "保存失败：写入本地金库时发生错误，请稍后重试。".to_string(),
    };
    VaultError::WriteFailed(message)
}

fn now_unix_ts() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs() as i64,
        Err(_) => 0,
    }
}
