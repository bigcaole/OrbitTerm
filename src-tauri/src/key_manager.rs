use std::io;
use std::path::{Path, PathBuf};

use ssh_key::{Algorithm, HashAlg, LineEnding, PrivateKey, PublicKey};
use thiserror::Error;
use tokio::fs;
use uuid::Uuid;

use crate::models::{
    SshDerivePublicKeyRequest, SshDerivePublicKeyResponse, SshExportPrivateKeyRequest,
    SshExportPrivateKeyResponse, SshGenerateKeypairRequest, SshGenerateKeypairResponse,
    SshKeyAlgorithm,
};

#[derive(Debug, Error)]
pub enum KeyManagerError {
    #[error("请求参数无效: {0}")]
    InvalidInput(String),
    #[error("密钥生成失败")]
    GenerateFailed,
    #[error("私钥格式无效")]
    InvalidPrivateKey,
    #[error("公钥格式无效")]
    InvalidPublicKey,
    #[error("导出私钥失败: {0}")]
    ExportFailed(String),
}

impl KeyManagerError {
    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidInput(detail) => format!("参数无效：{detail}"),
            Self::GenerateFailed => "生成 SSH 密钥对失败，请稍后重试。".to_string(),
            Self::InvalidPrivateKey => "私钥内容无效，请确认是完整的 OpenSSH 私钥。".to_string(),
            Self::InvalidPublicKey => "公钥内容无效，请确认是完整的 OpenSSH 公钥。".to_string(),
            Self::ExportFailed(detail) => format!("导出私钥失败：{detail}"),
        }
    }
}

pub fn generate_ssh_keypair(
    request: SshGenerateKeypairRequest,
) -> Result<SshGenerateKeypairResponse, KeyManagerError> {
    let mut rng = ssh_key::rand_core::OsRng;
    let algorithm = match request.algorithm {
        SshKeyAlgorithm::Ed25519 => Algorithm::Ed25519,
        SshKeyAlgorithm::Rsa4096 => Algorithm::Rsa { hash: None },
    };

    let mut private_key =
        PrivateKey::random(&mut rng, algorithm).map_err(|_| KeyManagerError::GenerateFailed)?;
    let normalized_comment = request
        .comment
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    if !normalized_comment.is_empty() {
        private_key.set_comment(normalized_comment);
    }

    let private_pem = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|_| KeyManagerError::GenerateFailed)?;
    let public_line = private_key
        .public_key()
        .to_openssh()
        .map_err(|_| KeyManagerError::GenerateFailed)?;
    let fingerprint = private_key.public_key().fingerprint(HashAlg::Sha256).to_string();

    Ok(SshGenerateKeypairResponse {
        algorithm: request.algorithm,
        private_key: private_pem.to_string(),
        public_key: public_line,
        fingerprint,
    })
}

pub fn derive_public_key(
    request: SshDerivePublicKeyRequest,
) -> Result<SshDerivePublicKeyResponse, KeyManagerError> {
    let private_key = parse_private_key(request.private_key.as_str())?;
    let public_key = private_key
        .public_key()
        .to_openssh()
        .map_err(|_| KeyManagerError::InvalidPrivateKey)?;
    let fingerprint = private_key.public_key().fingerprint(HashAlg::Sha256).to_string();

    Ok(SshDerivePublicKeyResponse {
        public_key,
        fingerprint,
    })
}

pub fn normalize_public_key(public_key: &str) -> Result<String, KeyManagerError> {
    let trimmed = public_key.trim();
    if trimmed.is_empty() {
        return Err(KeyManagerError::InvalidInput(
            "公钥不能为空。".to_string(),
        ));
    }

    let parsed = PublicKey::from_openssh(trimmed).map_err(|_| KeyManagerError::InvalidPublicKey)?;
    parsed
        .to_openssh()
        .map_err(|_| KeyManagerError::InvalidPublicKey)
}

pub fn build_deploy_command(public_key: &str) -> Result<String, KeyManagerError> {
    let normalized = normalize_public_key(public_key)?;
    let key_literal = shell_single_quote(normalized.as_str());
    Ok(format!(
        "KEY_LINE={key_literal}; \
umask 077; \
mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && \
(grep -qxF \"$KEY_LINE\" ~/.ssh/authorized_keys || printf '%s\\n' \"$KEY_LINE\" >> ~/.ssh/authorized_keys)"
    ))
}

pub async fn export_private_key(
    request: SshExportPrivateKeyRequest,
) -> Result<SshExportPrivateKeyResponse, KeyManagerError> {
    let private_key = parse_private_key(request.private_key.as_str())?;
    let pem = private_key
        .to_openssh(LineEnding::LF)
        .map_err(|_| KeyManagerError::InvalidPrivateKey)?;
    let destination = request.destination_path.trim();
    if destination.is_empty() {
        return Err(KeyManagerError::InvalidInput(
            "请选择私钥导出路径。".to_string(),
        ));
    }

    let destination_path = PathBuf::from(destination);
    atomic_write(&destination_path, pem.as_bytes()).await?;

    Ok(SshExportPrivateKeyResponse {
        path: destination.to_string(),
        bytes: pem.len() as u64,
    })
}

fn parse_private_key(raw: &str) -> Result<PrivateKey, KeyManagerError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(KeyManagerError::InvalidInput(
            "私钥不能为空。".to_string(),
        ));
    }
    PrivateKey::from_openssh(trimmed).map_err(|_| KeyManagerError::InvalidPrivateKey)
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), KeyManagerError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .await
                .map_err(map_export_io_error)?;
        }
    }

    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp_name = format!(".{}.tmp", Uuid::new_v4());
    let tmp_path = dir.join(tmp_name);

    fs::write(&tmp_path, bytes)
        .await
        .map_err(map_export_io_error)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600))
            .await
            .map_err(map_export_io_error)?;
    }

    fs::rename(&tmp_path, path).await.map_err(map_export_io_error)?;
    Ok(())
}

fn map_export_io_error(err: io::Error) -> KeyManagerError {
    KeyManagerError::ExportFailed(err.to_string())
}
