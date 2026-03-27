use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroizing;

const E2EE_HEADER: &[u8] = b"ORBITTERM_E2EE_V1";
const PASSWORD_PROOF_CTX: &[u8] = b"ORBITTERM_PASSWORD_PROOF";
const PAYLOAD_MAC_CTX: &[u8] = b"ORBITTERM_PAYLOAD_MAC";
const ENC_KEY_LABEL: &[u8] = b"orbitterm-enc-key";
const MAC_KEY_LABEL: &[u8] = b"orbitterm-mac-key";
const LEGACY_E2EE_HEADER: &[u8] = b"\x4c\x4f\x59\x55\x5f\x45\x32\x45\x45\x5f\x56\x31";
const LEGACY_PASSWORD_PROOF_CTX: &[u8] =
    b"\x4c\x4f\x59\x55\x5f\x50\x41\x53\x53\x57\x4f\x52\x44\x5f\x50\x52\x4f\x4f\x46";
const LEGACY_PAYLOAD_MAC_CTX: &[u8] =
    b"\x4c\x4f\x59\x55\x5f\x50\x41\x59\x4c\x4f\x41\x44\x5f\x4d\x41\x43";
const LEGACY_ENC_KEY_LABEL: &[u8] = b"\x6c\x6f\x79\x75\x2d\x65\x6e\x63\x2d\x6b\x65\x79";
const LEGACY_MAC_KEY_LABEL: &[u8] = b"\x6c\x6f\x79\x75\x2d\x6d\x61\x63\x2d\x6b\x65\x79";
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_MEMORY_COST_KIB: u32 = 64 * 1024;
const ARGON2_LANES: u32 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
pub const DERIVED_KEY_LEN: usize = KEY_LEN;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Copy)]
struct CryptoProfile {
    header: &'static [u8],
    password_proof_ctx: &'static [u8],
    payload_mac_ctx: &'static [u8],
    enc_key_label: &'static [u8],
    mac_key_label: &'static [u8],
}

const CURRENT_PROFILE: CryptoProfile = CryptoProfile {
    header: E2EE_HEADER,
    password_proof_ctx: PASSWORD_PROOF_CTX,
    payload_mac_ctx: PAYLOAD_MAC_CTX,
    enc_key_label: ENC_KEY_LABEL,
    mac_key_label: MAC_KEY_LABEL,
};

const LEGACY_PROFILE: CryptoProfile = CryptoProfile {
    header: LEGACY_E2EE_HEADER,
    password_proof_ctx: LEGACY_PASSWORD_PROOF_CTX,
    payload_mac_ctx: LEGACY_PAYLOAD_MAC_CTX,
    enc_key_label: LEGACY_ENC_KEY_LABEL,
    mac_key_label: LEGACY_MAC_KEY_LABEL,
};

fn profile_from_header(header: &[u8]) -> Option<&'static CryptoProfile> {
    if header == CURRENT_PROFILE.header {
        return Some(&CURRENT_PROFILE);
    }
    if header == LEGACY_PROFILE.header {
        return Some(&LEGACY_PROFILE);
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudVault {
    pub version: u64,
    pub updated_at: i64,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedVault {
    pub header: String,
    pub version: u64,
    pub updated_at: i64,
    pub kdf: KdfParams,
    pub salt: Vec<u8>,
    pub nonce: Vec<u8>,
    pub password_proof: Vec<u8>,
    pub payload_hmac: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    pub algorithm: String,
    pub memory_kib: u32,
    pub time_cost: u32,
    pub lanes: u32,
}

#[derive(Debug, Error)]
pub enum E2eeError {
    #[error("主密码不能为空")]
    EmptyPassword,
    #[error("加密包格式无效")]
    InvalidHeader,
    #[error("加密包参数不合法")]
    InvalidPackage,
    #[error("主密码错误")]
    WrongMasterPassword,
    #[error("数据完整性校验失败")]
    IntegrityCheckFailed,
    #[error("KDF 初始化失败")]
    KdfInit,
    #[error("密钥派生失败")]
    KeyDerivation,
    #[error("加密失败")]
    EncryptFailed,
    #[error("解密失败")]
    DecryptFailed,
    #[error("序列化失败")]
    SerializeFailed,
    #[error("反序列化失败")]
    DeserializeFailed,
}

pub fn encrypt_cloud_vault(
    master_password: &str,
    vault: &CloudVault,
) -> Result<EncryptedVault, E2eeError> {
    if master_password.is_empty() {
        return Err(E2eeError::EmptyPassword);
    }

    let mut salt = [0_u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let root_key = derive_root_key(master_password, &salt)?;
    let mut nonce = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    encrypt_with_derived_key_and_nonce(&root_key, &salt, &nonce, vault)
}

pub fn decrypt_cloud_vault(
    master_password: &str,
    encrypted: &EncryptedVault,
) -> Result<CloudVault, E2eeError> {
    if master_password.is_empty() {
        return Err(E2eeError::EmptyPassword);
    }

    let profile = validate_package(encrypted)?;

    let mut salt = [0_u8; SALT_LEN];
    salt.copy_from_slice(&encrypted.salt);

    let root_key = derive_root_key(master_password, &salt)?;
    let (enc_key, mac_key) = derive_subkeys(&root_key, profile);

    verify_password_proof(mac_key.as_ref(), &salt, &encrypted.password_proof, profile)?;

    verify_payload_hmac(
        mac_key.as_ref(),
        encrypted.version,
        encrypted.updated_at,
        &salt,
        &encrypted.nonce,
        &encrypted.ciphertext,
        &encrypted.payload_hmac,
        profile,
    )?;

    let cipher =
        Aes256Gcm::new_from_slice(enc_key.as_ref()).map_err(|_| E2eeError::DecryptFailed)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&encrypted.nonce),
                encrypted.ciphertext.as_ref(),
            )
            .map_err(|_| E2eeError::DecryptFailed)?,
    );

    serde_json::from_slice::<CloudVault>(plaintext.as_ref())
        .map_err(|_| E2eeError::DeserializeFailed)
}

pub fn derive_session_key(
    master_password: &str,
    encrypted: &EncryptedVault,
) -> Result<Zeroizing<[u8; DERIVED_KEY_LEN]>, E2eeError> {
    if master_password.is_empty() {
        return Err(E2eeError::EmptyPassword);
    }

    let profile = validate_package(encrypted)?;

    let mut salt = [0_u8; SALT_LEN];
    salt.copy_from_slice(&encrypted.salt);

    let root_key = derive_root_key(master_password, &salt)?;
    let (_enc_key, mac_key) = derive_subkeys(&root_key, profile);
    verify_password_proof(mac_key.as_ref(), &salt, &encrypted.password_proof, profile)?;

    Ok(root_key)
}

pub fn encrypt_cloud_vault_with_derived_key(
    derived_key: &[u8; DERIVED_KEY_LEN],
    salt: &[u8; 16],
    vault: &CloudVault,
) -> Result<EncryptedVault, E2eeError> {
    let mut nonce = [0_u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    encrypt_with_derived_key_and_nonce(derived_key, salt, &nonce, vault)
}

pub fn resolve_lww(local: &CloudVault, incoming: &CloudVault) -> CloudVault {
    if incoming.version > local.version {
        return incoming.clone();
    }

    if incoming.version < local.version {
        return local.clone();
    }

    if incoming.updated_at > local.updated_at {
        return incoming.clone();
    }

    if incoming.updated_at < local.updated_at {
        return local.clone();
    }

    if incoming.version >= local.version {
        incoming.clone()
    } else {
        local.clone()
    }
}

fn validate_package(encrypted: &EncryptedVault) -> Result<&'static CryptoProfile, E2eeError> {
    let profile = profile_from_header(encrypted.header.as_bytes()).ok_or(E2eeError::InvalidHeader)?;

    if encrypted.salt.len() != SALT_LEN || encrypted.nonce.len() != NONCE_LEN {
        return Err(E2eeError::InvalidPackage);
    }

    if encrypted.password_proof.len() != KEY_LEN || encrypted.payload_hmac.len() != KEY_LEN {
        return Err(E2eeError::InvalidPackage);
    }

    Ok(profile)
}

fn derive_root_key(
    master_password: &str,
    salt: &[u8; SALT_LEN],
) -> Result<Zeroizing<[u8; KEY_LEN]>, E2eeError> {
    let params = Params::new(
        ARGON2_MEMORY_COST_KIB,
        ARGON2_TIME_COST,
        ARGON2_LANES,
        Some(KEY_LEN),
    )
    .map_err(|_| E2eeError::KdfInit)?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = Zeroizing::new([0_u8; KEY_LEN]);

    argon2
        .hash_password_into(master_password.as_bytes(), salt, output.as_mut())
        .map_err(|_| E2eeError::KeyDerivation)?;

    Ok(output)
}

fn derive_subkeys(
    root_key: &[u8; KEY_LEN],
    profile: &CryptoProfile,
) -> (Zeroizing<[u8; KEY_LEN]>, Zeroizing<[u8; KEY_LEN]>) {
    let mut enc_hasher = Sha256::new();
    enc_hasher.update(root_key);
    enc_hasher.update(profile.enc_key_label);
    let enc_digest = enc_hasher.finalize();

    let mut mac_hasher = Sha256::new();
    mac_hasher.update(root_key);
    mac_hasher.update(profile.mac_key_label);
    let mac_digest = mac_hasher.finalize();

    let mut enc_key = Zeroizing::new([0_u8; KEY_LEN]);
    let mut mac_key = Zeroizing::new([0_u8; KEY_LEN]);
    enc_key.copy_from_slice(&enc_digest);
    mac_key.copy_from_slice(&mac_digest);

    (enc_key, mac_key)
}

fn compute_password_proof(
    mac_key: &[u8],
    salt: &[u8],
    profile: &CryptoProfile,
) -> Result<Vec<u8>, E2eeError> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(mac_key).map_err(|_| E2eeError::KeyDerivation)?;
    mac.update(profile.header);
    mac.update(profile.password_proof_ctx);
    mac.update(salt);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn verify_password_proof(
    mac_key: &[u8],
    salt: &[u8],
    expected: &[u8],
    profile: &CryptoProfile,
) -> Result<(), E2eeError> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(mac_key).map_err(|_| E2eeError::KeyDerivation)?;
    mac.update(profile.header);
    mac.update(profile.password_proof_ctx);
    mac.update(salt);
    mac.verify_slice(expected)
        .map_err(|_| E2eeError::WrongMasterPassword)
}

fn compute_payload_hmac(
    mac_key: &[u8],
    version: u64,
    updated_at: i64,
    salt: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    profile: &CryptoProfile,
) -> Result<Vec<u8>, E2eeError> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(mac_key).map_err(|_| E2eeError::KeyDerivation)?;
    mac.update(profile.header);
    mac.update(profile.payload_mac_ctx);
    mac.update(&version.to_le_bytes());
    mac.update(&updated_at.to_le_bytes());
    mac.update(salt);
    mac.update(nonce);
    mac.update(ciphertext);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn verify_payload_hmac(
    mac_key: &[u8],
    version: u64,
    updated_at: i64,
    salt: &[u8],
    nonce: &[u8],
    ciphertext: &[u8],
    expected: &[u8],
    profile: &CryptoProfile,
) -> Result<(), E2eeError> {
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(mac_key).map_err(|_| E2eeError::KeyDerivation)?;
    mac.update(profile.header);
    mac.update(profile.payload_mac_ctx);
    mac.update(&version.to_le_bytes());
    mac.update(&updated_at.to_le_bytes());
    mac.update(salt);
    mac.update(nonce);
    mac.update(ciphertext);

    mac.verify_slice(expected)
        .map_err(|_| E2eeError::IntegrityCheckFailed)
}

fn encrypt_with_derived_key_and_nonce(
    derived_key: &[u8; DERIVED_KEY_LEN],
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
    vault: &CloudVault,
) -> Result<EncryptedVault, E2eeError> {
    let profile = &CURRENT_PROFILE;
    let (enc_key, mac_key) = derive_subkeys(derived_key, profile);

    let plaintext =
        Zeroizing::new(serde_json::to_vec(vault).map_err(|_| E2eeError::SerializeFailed)?);

    let cipher =
        Aes256Gcm::new_from_slice(enc_key.as_ref()).map_err(|_| E2eeError::EncryptFailed)?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(nonce), plaintext.as_ref())
        .map_err(|_| E2eeError::EncryptFailed)?;

    let password_proof = compute_password_proof(mac_key.as_ref(), salt, profile)?;
    let payload_hmac = compute_payload_hmac(
        mac_key.as_ref(),
        vault.version,
        vault.updated_at,
        salt,
        nonce,
        &ciphertext,
        profile,
    )?;

    Ok(EncryptedVault {
        header: String::from_utf8_lossy(profile.header).to_string(),
        version: vault.version,
        updated_at: vault.updated_at,
        kdf: KdfParams {
            algorithm: "argon2id".to_string(),
            memory_kib: ARGON2_MEMORY_COST_KIB,
            time_cost: ARGON2_TIME_COST,
            lanes: ARGON2_LANES,
        },
        salt: salt.to_vec(),
        nonce: nonce.to_vec(),
        password_proof,
        payload_hmac,
        ciphertext,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{decrypt_cloud_vault, encrypt_cloud_vault, resolve_lww, CloudVault, E2eeError};

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let vault = CloudVault {
            version: 1,
            updated_at: 1_746_000_001,
            data: json!({"hosts": [{"name": "prod", "secret": "abcd"}]}),
        };

        let encrypted = match encrypt_cloud_vault("correct horse battery staple", &vault) {
            Ok(v) => v,
            Err(err) => panic!("encrypt should work: {err}"),
        };
        let decrypted = match decrypt_cloud_vault("correct horse battery staple", &encrypted) {
            Ok(v) => v,
            Err(err) => panic!("decrypt should work: {err}"),
        };

        assert_eq!(decrypted.version, vault.version);
        assert_eq!(decrypted.updated_at, vault.updated_at);
        assert_eq!(decrypted.data, vault.data);
    }

    #[test]
    fn wrong_password_rejected_before_decrypt() {
        let vault = CloudVault {
            version: 1,
            updated_at: 1_746_000_001,
            data: json!({"token": "secret"}),
        };

        let encrypted = match encrypt_cloud_vault("right-password", &vault) {
            Ok(v) => v,
            Err(err) => panic!("encrypt should work: {err}"),
        };
        let result = decrypt_cloud_vault("wrong-password", &encrypted);

        assert!(matches!(result, Err(E2eeError::WrongMasterPassword)));
    }

    #[test]
    fn lww_should_prefer_higher_version_even_if_timestamp_is_older() {
        let local = CloudVault {
            version: 4,
            updated_at: 1_746_000_100,
            data: json!({"source": "local"}),
        };

        let incoming = CloudVault {
            version: 5,
            updated_at: 1_746_000_020,
            data: json!({"source": "remote"}),
        };

        let merged = resolve_lww(&local, &incoming);
        assert_eq!(merged.version, incoming.version);
        assert_eq!(merged.data, incoming.data);
    }

    #[test]
    fn lww_should_use_timestamp_when_versions_are_equal() {
        let local = CloudVault {
            version: 4,
            updated_at: 1_746_000_100,
            data: json!({"source": "local"}),
        };

        let incoming = CloudVault {
            version: 4,
            updated_at: 1_746_000_120,
            data: json!({"source": "remote"}),
        };

        let merged = resolve_lww(&local, &incoming);
        assert_eq!(merged.updated_at, incoming.updated_at);
    }
}
