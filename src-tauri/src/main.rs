#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod diagnostics;
#[allow(dead_code)]
mod e2ee;
mod error;
mod key_manager;
mod models;
mod ssh;
mod vault;

use error::SshBackendError;
use models::{
    AiExplainSshErrorRequest, AiExplainSshErrorResponse, AiTranslateRequest, AiTranslateResponse,
    ExportEncryptedBackupRequest, ExportEncryptedBackupResponse, HealthCheckResponse,
    SaveVaultRequest, SaveVaultResponse, SftpDownloadRequest, SftpLsRequest, SftpLsResponse,
    SftpMkdirRequest, SftpReadTextRequest, SftpReadTextResponse, SftpRenameRequest,
    SftpRmRequest, SftpTransferResponse, SftpUploadRequest, SshConnectRequest,
    SshConnectedResponse, SshDerivePublicKeyRequest, SshDerivePublicKeyResponse,
    SshDeployPublicKeyRequest, SshDisconnectRequest, SshExportPrivateKeyRequest,
    SshExportPrivateKeyResponse, SshGenerateKeypairRequest, SshGenerateKeypairResponse,
    SshPulseActivityRequest, SshResizeRequest, SshWriteRequest, UnlockAndLoadRequest,
    UnlockAndLoadResponse, VaultSyncExportResponse, VaultSyncImportRequest,
};
use ssh::SshSessionRegistry;
use tauri::{
    AppHandle, CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu,
};
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
async fn ssh_set_pulse_activity(
    registry: State<'_, SshSessionRegistry>,
    request: SshPulseActivityRequest,
) -> Result<(), String> {
    registry
        .set_pulse_activity(&request.session_id, request.active)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
fn ssh_generate_keypair(
    request: SshGenerateKeypairRequest,
) -> Result<SshGenerateKeypairResponse, String> {
    key_manager::generate_ssh_keypair(request).map_err(|err| err.user_message())
}

#[tauri::command]
fn ssh_derive_public_key(
    request: SshDerivePublicKeyRequest,
) -> Result<SshDerivePublicKeyResponse, String> {
    key_manager::derive_public_key(request).map_err(|err| err.user_message())
}

#[tauri::command]
async fn ssh_deploy_public_key(
    registry: State<'_, SshSessionRegistry>,
    request: SshDeployPublicKeyRequest,
) -> Result<(), String> {
    registry
        .deploy_public_key(&request.session_id, request.public_key)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn ssh_export_private_key(
    request: SshExportPrivateKeyRequest,
) -> Result<SshExportPrivateKeyResponse, String> {
    key_manager::export_private_key(request)
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
    app: AppHandle,
    registry: State<'_, SshSessionRegistry>,
    request: SftpDownloadRequest,
) -> Result<SftpTransferResponse, String> {
    registry
        .sftp_download(app, request)
        .await
        .map_err(|err| err.user_message())
}

#[tauri::command]
async fn sftp_read_text(
    registry: State<'_, SshSessionRegistry>,
    request: SftpReadTextRequest,
) -> Result<SftpReadTextResponse, String> {
    registry
        .sftp_read_text(request)
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
async fn vault_export_sync_blob(app: AppHandle) -> Result<VaultSyncExportResponse, String> {
    vault::export_sync_blob(app).await
}

#[tauri::command]
async fn vault_import_sync_blob(
    app: AppHandle,
    state: State<'_, VaultSessionState>,
    request: VaultSyncImportRequest,
) -> Result<UnlockAndLoadResponse, String> {
    vault::import_sync_blob(app, state, request).await
}

#[tauri::command]
async fn vault_clear_session(
    state: State<'_, VaultSessionState>,
) -> Result<(), String> {
    vault::clear_vault_session(state).await
}

#[tauri::command]
async fn run_health_check(app: AppHandle) -> Result<HealthCheckResponse, String> {
    Ok(diagnostics::run_health_check(&app).await)
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show_main_window", "显示主窗口"))
        .add_item(CustomMenuItem::new("quit_app", "退出 OrbitTerm"));
    let system_tray = SystemTray::new().with_menu(tray_menu);

    let app = tauri::Builder::default()
        .manage(SshSessionRegistry::default())
        .manage(VaultSessionState::default())
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick { .. } => {
                show_main_window(app);
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "show_main_window" => {
                    show_main_window(app);
                }
                "quit_app" => {
                    app.exit(0);
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            ssh_set_pulse_activity,
            ssh_generate_keypair,
            ssh_derive_public_key,
            ssh_deploy_public_key,
            ssh_export_private_key,
            ai_translate_command,
            ai_explain_ssh_error,
            sftp_ls,
            sftp_mkdir,
            sftp_rm,
            sftp_rename,
            sftp_upload,
            sftp_download,
            sftp_read_text,
            unlock_and_load,
            save_vault,
            export_encrypted_backup,
            vault_export_sync_blob,
            vault_import_sync_blob,
            vault_clear_session,
            run_health_check,
            app_version
        ]);

    if let Err(err) = app.run(tauri::generate_context!()) {
        let message = SshBackendError::Protocol(err.to_string()).user_message();
        eprintln!("{message}");
    }
}
