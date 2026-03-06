use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResponse {
    pub valid: bool,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    pub organization_id: Option<String>,
    pub reason: Option<String>,
}

/// Validates an API key against the Actium portal.
/// Returns workspace info if valid.
pub async fn validate_api_key(api_key: &str) -> Result<ValidationResponse, AuthError> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.actium.io/v1/tunnel/validate-key")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("X-Tunnel-Version", env!("CARGO_PKG_VERSION"))
        .send()
        .await
        .map_err(|e| AuthError::NetworkError(e.to_string()))?;

    if response.status() == 401 {
        return Err(AuthError::InvalidKey);
    }

    if response.status() == 403 {
        return Err(AuthError::KeyRevoked);
    }

    if !response.status().is_success() {
        return Err(AuthError::ServerError(format!(
            "HTTP {}",
            response.status()
        )));
    }

    let body = response
        .json::<ValidationResponse>()
        .await
        .map_err(|e| AuthError::ParseError(e.to_string()))?;

    if !body.valid {
        return Err(AuthError::InvalidKey);
    }

    Ok(body)
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("Invalid API key")]
    InvalidKey,

    #[error("API key has been revoked")]
    KeyRevoked,

    #[error("Network error: {0}")]
    NetworkError(String),

    #[error("Server error: {0}")]
    ServerError(String),

    #[error("Parse error: {0}")]
    ParseError(String),
}
