mod crypto;
mod token;

use crypto::{EncryptedPayload, Identity};

#[tauri::command]
fn generate_identity() -> Result<Identity, String> {
    crypto::generate_identity()
}

#[tauri::command]
fn encrypt_message(message: String, recipient_pubkey: String) -> Result<EncryptedPayload, String> {
    crypto::encrypt_message(message, recipient_pubkey)
}

#[tauri::command]
fn decrypt_message(payload: EncryptedPayload, my_secret_key_hex: String) -> Result<String, String> {
    crypto::decrypt_message(payload, my_secret_key_hex)
}

#[tauri::command]
async fn get_tmail_balance(wallet: String) -> Result<String, String> {
    token::get_tmail_balance(wallet).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      generate_identity,
      encrypt_message,
      decrypt_message,
      get_tmail_balance
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}