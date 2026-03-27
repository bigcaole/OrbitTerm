use std::io;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SshBackendError {
    #[error("输入参数不完整")]
    InvalidInput,
    #[error("SSH 认证失败")]
    AuthFailure,
    #[error("连接超时")]
    Timeout,
    #[error("DNS 解析失败")]
    DnsError,
    #[error("无法连接到目标主机")]
    ConnectionRefused,
    #[error("SSH 会话不存在")]
    SessionNotFound,
    #[error("SSH 通道已关闭")]
    ChannelClosed,
    #[error("SFTP 路径不存在")]
    SftpNotFound,
    #[error("SFTP 权限不足")]
    SftpPermissionDenied,
    #[error("SFTP 路径已存在")]
    SftpAlreadyExists,
    #[error("SFTP 操作不支持")]
    SftpUnsupported,
    #[error("SFTP 操作失败: {0}")]
    SftpOperation(String),
    #[error("AI 配置缺失: {0}")]
    AiConfigMissing(String),
    #[error("AI 服务调用失败: {0}")]
    AiService(String),
    #[error("AI 返回内容无效")]
    AiInvalidResponse,
    #[error("PTY 创建失败: {0}")]
    Pty(String),
    #[error("远程命令执行失败: {0}")]
    RemoteCommand(String),
    #[error("网络或系统错误: {0}")]
    Network(String),
    #[error("SSH 协议错误: {0}")]
    Protocol(String),
}

pub type SshResult<T> = Result<T, SshBackendError>;

impl SshBackendError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput => "INVALID_INPUT",
            Self::AuthFailure => "AUTH_FAILURE",
            Self::Timeout => "TIMEOUT",
            Self::DnsError => "DNS_ERROR",
            Self::ConnectionRefused => "CONNECTION_REFUSED",
            Self::SessionNotFound => "SESSION_NOT_FOUND",
            Self::ChannelClosed => "CHANNEL_CLOSED",
            Self::SftpNotFound => "SFTP_NOT_FOUND",
            Self::SftpPermissionDenied => "SFTP_PERMISSION_DENIED",
            Self::SftpAlreadyExists => "SFTP_ALREADY_EXISTS",
            Self::SftpUnsupported => "SFTP_UNSUPPORTED",
            Self::SftpOperation(_) => "SFTP_OPERATION_FAILED",
            Self::AiConfigMissing(_) => "AI_CONFIG_MISSING",
            Self::AiService(_) => "AI_SERVICE_ERROR",
            Self::AiInvalidResponse => "AI_INVALID_RESPONSE",
            Self::Pty(_) => "PTY_ERROR",
            Self::RemoteCommand(_) => "REMOTE_COMMAND_FAILED",
            Self::Network(_) => "NETWORK_ERROR",
            Self::Protocol(_) => "SSH_PROTOCOL_ERROR",
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            Self::InvalidInput => "连接参数不完整，请检查主机地址、用户名和认证信息。".to_string(),
            Self::AuthFailure => "认证失败：请确认用户名、密码或私钥是否正确。".to_string(),
            Self::Timeout => "连接超时：目标主机响应过慢或网络不可达。".to_string(),
            Self::DnsError => {
                "域名解析失败：请检查主机地址是否正确，或 DNS 配置是否可用。".to_string()
            }
            Self::ConnectionRefused => {
                "连接被拒绝：目标主机未开放 SSH 端口或防火墙拦截。".to_string()
            }
            Self::SessionNotFound => "会话不存在：可能已断开，请重新连接。".to_string(),
            Self::ChannelClosed => "会话通道已关闭，请重新建立 SSH 连接。".to_string(),
            Self::SftpNotFound => "找不到指定的文件或目录，请检查路径是否正确。".to_string(),
            Self::SftpPermissionDenied => "操作被拒绝：当前账号没有足够的文件权限。".to_string(),
            Self::SftpAlreadyExists => "目标路径已存在，请更换名称后重试。".to_string(),
            Self::SftpUnsupported => "当前服务器不支持该 SFTP 操作。".to_string(),
            Self::SftpOperation(detail) => format!("SFTP 操作失败：{detail}"),
            Self::AiConfigMissing(detail) => format!("Orbit AI 未正确配置：{detail}"),
            Self::AiService(detail) => format!("Orbit AI 服务暂不可用：{detail}"),
            Self::AiInvalidResponse => {
                "Orbit AI 返回的内容无法识别为命令，请重试或换一种说法。".to_string()
            }
            Self::Pty(detail) => format!("终端初始化失败：{detail}"),
            Self::RemoteCommand(detail) => format!("远程命令执行失败：{detail}"),
            Self::Network(detail) => format!("网络异常：{detail}"),
            Self::Protocol(detail) => format!("SSH 协议异常：{detail}"),
        }
    }
}

pub fn map_io_error(err: &io::Error) -> SshBackendError {
    if matches!(err.kind(), io::ErrorKind::TimedOut) {
        return SshBackendError::Timeout;
    }

    if matches!(err.kind(), io::ErrorKind::ConnectionRefused) {
        return SshBackendError::ConnectionRefused;
    }

    let msg = err.to_string().to_lowercase();
    if msg.contains("dns")
        || msg.contains("lookup")
        || msg.contains("resolve")
        || matches!(
            err.kind(),
            io::ErrorKind::AddrNotAvailable | io::ErrorKind::NotFound
        )
    {
        return SshBackendError::DnsError;
    }

    SshBackendError::Network(err.to_string())
}

pub fn map_russh_error(err: &russh::Error) -> SshBackendError {
    match err {
        russh::Error::NoAuthMethod
        | russh::Error::NotAuthenticated
        | russh::Error::DecryptionError
        | russh::Error::RequestDenied => SshBackendError::AuthFailure,
        russh::Error::ConnectionTimeout
        | russh::Error::KeepaliveTimeout
        | russh::Error::InactivityTimeout
        | russh::Error::Elapsed(_) => SshBackendError::Timeout,
        russh::Error::IO(io_err) => map_io_error(io_err),
        other => SshBackendError::Protocol(other.to_string()),
    }
}
