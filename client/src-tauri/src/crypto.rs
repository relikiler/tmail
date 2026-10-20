use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};

#[derive(Serialize, Deserialize)]
pub struct Identity {
    pub public_key: String,
    pub address: String,
}

#[derive(Serialize, Deserialize)]
pub struct EncryptedPayload {
    pub ephemeral_pubkey: String,
    pub nonce: String,
    pub ciphertext: String,
}

fn pubkey_from_hex(h: &str) -> Result<PublicKey, String> {
    let bytes = hex::decode(h.trim_start_matches("0x")).map_err(|e| format!("bad hex: {e}"))?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| "bad pubkey length".to_string())?;
    Ok(PublicKey::from(arr))
}

pub fn generate_identity() -> Result<Identity, String> {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    Ok(Identity {
        public_key: format!("0x{}", hex::encode(public.as_bytes())),
        address: "0x...".into(),
    })
}

pub fn encrypt_message(message: String, recipient_pubkey: String) -> Result<EncryptedPayload, String> {
    let recipient_pk = pubkey_from_hex(&recipient_pubkey)?;

    let ephemeral = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_pk = PublicKey::from(&ephemeral);
    let shared = ephemeral.diffie_hellman(&recipient_pk);

    let cipher = Aes256Gcm::new(shared.as_bytes().into());
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, message.as_bytes())
        .map_err(|e| format!("encryption failed: {e}"))?;

    Ok(EncryptedPayload {
        ephemeral_pubkey: hex::encode(ephemeral_pk.as_bytes()),
        nonce: hex::encode(nonce_bytes),
        ciphertext: hex::encode(ciphertext),
    })
}

pub fn decrypt_message(payload: EncryptedPayload, my_secret_key_hex: String) -> Result<String, String> {
    let sk_bytes = hex::decode(my_secret_key_hex.trim_start_matches("0x"))
        .map_err(|e| format!("bad hex: {e}"))?;
    let sk_arr: [u8; 32] = sk_bytes.try_into().map_err(|_| "bad key length")?;
    let my_secret = StaticSecret::from(sk_arr);

    let eph_pk = pubkey_from_hex(&payload.ephemeral_pubkey)?;
    let shared = my_secret.diffie_hellman(&eph_pk);

    let cipher = Aes256Gcm::new(shared.as_bytes().into());
    let nonce_bytes = hex::decode(&payload.nonce).map_err(|e| e.to_string())?;
    let ct = hex::decode(&payload.ciphertext).map_err(|e| e.to_string())?;

    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ct.as_slice())
        .map_err(|_| "decryption failed: wrong key or corrupted data")?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}