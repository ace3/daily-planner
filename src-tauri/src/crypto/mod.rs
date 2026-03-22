use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use anyhow::{Result, anyhow};

const KEY: &[u8; 32] = b"daily-planner-secret-key-32bytes";

pub fn encrypt(plaintext: &str) -> Result<String> {
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(KEY);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("Encrypt error: {}", e))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(combined))
}

pub fn decrypt(encoded: &str) -> Result<String> {
    if encoded.is_empty() {
        return Ok(String::new());
    }
    let combined = B64.decode(encoded).map_err(|e| anyhow!("Base64 decode: {}", e))?;
    if combined.len() < 12 {
        return Err(anyhow!("Invalid ciphertext"));
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = aes_gcm::Key::<Aes256Gcm>::from_slice(KEY);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("Decrypt error: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| anyhow!("UTF8: {}", e))
}
