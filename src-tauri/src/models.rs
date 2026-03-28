use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthMethod {
    Password,
    PrivateKey,
}

impl Default for AuthMethod {
    fn default() -> Self {
        Self::Password
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectRequest {
    pub session_id: Option<String>,
    pub host_config: HostConfig,
    pub identity_config: IdentityConfig,
    #[serde(default)]
    pub proxy_chain: Vec<ProxyJumpHop>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub term: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyJumpHop {
    pub host_config: HostConfig,
    pub identity_config: IdentityConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshWriteRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDisconnectRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectedResponse {
    pub session_id: String,
    pub pty_backend: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslateRequest {
    pub text: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTranslateResponse {
    pub command: String,
    pub provider: String,
    pub risk_notice: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExplainSshErrorRequest {
    pub error_message: String,
    #[serde(default)]
    pub log_context: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiExplainSshErrorResponse {
    pub provider: String,
    pub advice: String,
    pub risk_notice: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshErrorEvent {
    pub session_id: Option<String>,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshClosedEvent {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshPulseActivityRequest {
    pub session_id: String,
    pub active: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshKeyAlgorithm {
    Ed25519,
    Rsa4096,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshGenerateKeypairRequest {
    pub algorithm: SshKeyAlgorithm,
    #[serde(default)]
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshGenerateKeypairResponse {
    pub algorithm: SshKeyAlgorithm,
    pub private_key: String,
    pub public_key: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDerivePublicKeyRequest {
    pub private_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDerivePublicKeyResponse {
    pub public_key: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDeployPublicKeyRequest {
    pub session_id: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshExportPrivateKeyRequest {
    pub private_key: String,
    pub destination_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshExportPrivateKeyResponse {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SysStatus {
    pub cpu_usage_percent: f64,
    pub memory_usage_percent: f64,
    pub net_rx_bytes_per_sec: f64,
    pub net_tx_bytes_per_sec: f64,
    pub sampled_at: i64,
    pub interval_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSysStatusEvent {
    pub session_id: String,
    pub status: SysStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshDiagnosticLogEvent {
    pub session_id: String,
    pub level: String,
    pub stage: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostBasicInfo {
    #[serde(default = "default_host_name")]
    pub name: String,
    #[serde(default = "default_host_address")]
    pub address: String,
    #[serde(default = "default_host_port")]
    pub port: u16,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostAuthConfig {
    #[serde(default)]
    pub method: AuthMethod,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
}

impl Default for HostAuthConfig {
    fn default() -> Self {
        Self {
            method: AuthMethod::Password,
            password: Some(String::new()),
            private_key: Some(String::new()),
            passphrase: Some(String::new()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostAdvancedOptions {
    #[serde(default)]
    pub jump_host: String,
    #[serde(default)]
    pub proxy_jump_host_id: String,
    #[serde(default = "default_connection_timeout")]
    pub connection_timeout: u64,
    #[serde(default = "default_keep_alive_enabled")]
    pub keep_alive_enabled: bool,
    #[serde(default = "default_keep_alive_interval")]
    pub keep_alive_interval: u64,
    #[serde(default = "default_compression")]
    pub compression: bool,
    #[serde(default = "default_strict_host_key_checking")]
    pub strict_host_key_checking: bool,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_host_name() -> String {
    "未命名主机".to_string()
}

fn default_host_address() -> String {
    "127.0.0.1".to_string()
}

fn default_host_port() -> u16 {
    22
}

fn default_connection_timeout() -> u64 {
    10
}

fn default_keep_alive_enabled() -> bool {
    true
}

fn default_keep_alive_interval() -> u64 {
    30
}

fn default_compression() -> bool {
    true
}

fn default_strict_host_key_checking() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub basic_info: HostBasicInfo,
    #[serde(default)]
    pub identity_id: String,
    pub advanced_options: HostAdvancedOptions,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub auth_config: HostAuthConfig,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockAndLoadRequest {
    pub master_password: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockAndLoadResponse {
    pub hosts: Vec<HostConfig>,
    pub identities: Vec<IdentityConfig>,
    pub snippets: Vec<Snippet>,
    pub version: u64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVaultRequest {
    pub hosts: Vec<HostConfig>,
    pub identities: Vec<IdentityConfig>,
    #[serde(default)]
    pub snippets: Vec<Snippet>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVaultResponse {
    pub version: u64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncImportRequest {
    pub encrypted_blob_base64: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncExportResponse {
    pub encrypted_blob_base64: String,
    pub version: u64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEncryptedBackupRequest {
    pub destination_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportEncryptedBackupResponse {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportEncryptedBackupRequest {
    pub source_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckItem {
    pub id: String,
    pub label: String,
    pub status: String,
    pub message: String,
    pub suggestion: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResponse {
    pub generated_at: i64,
    pub items: Vec<HealthCheckItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpLsRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpMkdirRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpRmRequest {
    pub session_id: String,
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpRenameRequest {
    pub session_id: String,
    pub from_path: String,
    pub to_path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpUploadRequest {
    pub session_id: String,
    pub local_path: Option<String>,
    pub remote_path: String,
    pub content_base64: Option<String>,
    #[serde(default)]
    pub transfer_id: Option<String>,
    #[serde(default)]
    pub resume_from: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpDownloadRequest {
    pub session_id: String,
    pub remote_path: String,
    pub local_path: String,
    #[serde(default)]
    pub transfer_id: Option<String>,
    #[serde(default)]
    pub resume_from: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadTextRequest {
    pub session_id: String,
    pub remote_path: String,
    pub max_bytes: Option<usize>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpReadTextResponse {
    pub path: String,
    pub content: String,
    pub bytes: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_at: Option<i64>,
    pub file_type: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpLsResponse {
    pub path: String,
    pub entries: Vec<SftpEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferResponse {
    pub path: String,
    pub bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpTransferProgressEvent {
    pub session_id: String,
    pub transfer_id: String,
    pub direction: String,
    pub remote_path: String,
    pub local_path: String,
    pub transferred_bytes: u64,
    pub total_bytes: u64,
    pub progress: u8,
}
