use serde_json::json;

const POLYGON_RPC: &str = "https://polygon-rpc.com";
const TMAIL_CONTRACT: &str = "0xE683F5Cb2dFB9abb6D0d460B3E49AE760903e4fA";

pub async fn get_tmail_balance(wallet: String) -> Result<String, String> {
    let addr = wallet.trim_start_matches("0x").to_lowercase();
    let calldata = format!("0x70a08231{addr:0>64}");

    let resp = reqwest::Client::new()
        .post(POLYGON_RPC)
        .json(&json!({
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{ "to": TMAIL_CONTRACT, "data": calldata }, "latest"]
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["result"].as_str().unwrap_or("0x0").to_string())
}