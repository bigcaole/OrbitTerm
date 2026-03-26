#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod diagnostics;
#[allow(dead_code)]
mod e2ee;
mod error;
mod models;
mod ssh;
mod vault;

use error::SshBackendError;
use models::{
    AiExplainSshErrorRequest, AiExplainSshErrorResponse, AiTranslateRequest, AiTranslateResponse,
    ExportEncryptedBackupRequest, ExportEncryptedBackupResponse, HealthCheckResponse,
    SaveVaultRequest, SaveVaultResponse, SftpDownloadRequest, SftpLsRequest, SftpLsResponse,
    SftpMkdirRequest, SftpRenameRequest, SftpRmRequest, SftpTransferResponse, SftpUploadRequest,
    SshConnectRequest, SshConnectedResponse, SshDisconnectRequest, SshResizeRequest,
    SshWriteRequest, UnlockAndLoadRequest, UnlockAndLoadResponse,
};
use ssh::SshSessionRegistry;
use tauri::{AppHandle, State};
use vault::VaultSessionState;

#[tauri::command]
async fn ssh_connect(
    app: AppHandle,
    registry: State<'_, SshSessionRegistry>,
    request: SshConnectRequest,
) -> Result<SshConnectedResponse, String> {
    registry
        .connect(app, request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ssh_write(
    registry: State<'_, SshSessionRegistry>,
    request: SshWriteRequest,
) -> Result<(), String> {
    registry
        .write_input(&request.session_id, request.data)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ssh_resize(
    registry: State<'_, SshSessionRegistry>,
    request: SshResizeRequest,
) -> Result<(), String> {
    registry
        .resize(&request.session_id, request.cols, request.rows)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ssh_disconnect(
    registry: State<'_, SshSessionRegistry>,
    request: SshDisconnectRequest,
) -> Result<(), String> {
    registry
        .disconnect(&request.session_id)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ai_translate_command(request: AiTranslateRequest) -> Result<AiTranslateResponse, String> {
    ai::translate_command(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ai_explain_ssh_error(
    request: AiExplainSshErrorRequest,
) -> Result<AiExplainSshErrorResponse, String> {
    ai::explain_ssh_error(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_ls(
    registry: State<'_, SshSessionRegistry>,
    request: SftpLsRequest,
) -> Result<SftpLsResponse, String> {
    registry
        .sftp_ls(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_mkdir(
    registry: State<'_, SshSessionRegistry>,
    request: SftpMkdirRequest,
) -> Result<(), String> {
    registry
        .sftp_mkdir(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_rm(
    registry: State<'_, SshSessionRegistry>,
    request: SftpRmRequest,
) -> Result<(), String> {
    registry
        .sftp_rm(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_rename(
    registry: State<'_, SshSessionRegistry>,
    request: SftpRenameRequest,
) -> Result<(), String> {
    registry
        .sftp_rename(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_upload(
    app: AppHandle,
    registry: State<'_, SshSessionRegistry>,
    request: SftpUploadRequest,
) -> Result<SftpTransferResponse, String> {
    registry
        .sftp_upload(app, request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_download(
    registry: State<'_, SshSessionRegistry>,
    request: SftpDownloadRequest,
) -> Result<SftpTransferResponse, String> {
    registry
        .sftp_download(request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn unlock_and_load(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: UnlockAndLoadRequest,
) -> Result<UnlockAndLoadResponse, String> {
    vault::unlock_and_load(app, state, request).await
}

#[tauri::command]
async fn save_vault(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: SaveVaultRequest,
) -> Result<SaveVaultResponse, String> {
    vault::save_vault(app, state, request).await
}

#[tauri::command]
async fn export_encrypted_backup(
    app: AppHandle,
    request: ExportEncryptedBackupRequest,
) -> Result<ExportEncryptedBackupResponse, String> {
    vault::export_encrypted_backup(app, request).await
}

#[tauri::command]
async fn run_health_check(app: AppHandle) -> Result<HealthCheckResponse, String> {
    Ok(diagnostics::run_health_check(&app).await)
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn main() {
    let app = tauri::Builder::default()
        .manage(SshSessionRegistry::default())
        .manage(VaultSessionState::default())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ai_translate_command,
            ai_explain_ssh_error,
            sftp_ls,
            sftp_mkdir,
            sftp_rm,
            sftp_rename,
            sftp_upload,
            sftp_download,
            unlock_and_load,
            save_vault,
            export_encrypted_backup,
            run_health_check,
            app_version
        ]);

    if let Err(err) = app.run(tauri::generate_context!()) {
        let message = SshBackendError::Protocol(err.to_string()).user_message();
        eprintln!("{message}");
    }
}
