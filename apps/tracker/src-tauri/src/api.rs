//! HTTP client for the Tacho API (`/api/tracker/*`).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use te_telemetry::upload::{JobUpload, PositionUpdate};

/// API base URL: `TACHO_API_URL` at runtime, then at build time, else the local dev server.
pub fn base_url() -> String {
    std::env::var("TACHO_API_URL")
        .ok()
        .or_else(|| option_env!("TACHO_API_URL").map(str::to_owned))
        .unwrap_or_else(|| "http://localhost:3001".to_owned())
        .trim_end_matches('/')
        .to_owned()
}

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("this tracker isn't linked to an account, or it was unlinked on the website")]
    Unauthorized,
    /// A 4xx other than 401: sending the same request again won't help.
    #[error("the server rejected the request ({0})")]
    Rejected(String),
    #[error("couldn't reach Tacho: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Tacho had a server error ({0})")]
    Server(u16),
}

impl ApiError {
    /// Worth trying again later (offline, timeouts, 5xx).
    pub fn is_retryable(&self) -> bool {
        matches!(self, Self::Network(_) | Self::Server(_))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PairStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PairPoll {
    Pending,
    Expired,
    Approved { token: String, driver_name: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JobAccepted {
    pub id: String,
    /// delivered, cancelled or flagged: the API decides, not the tracker.
    pub status: String,
    pub flag_reasons: Vec<String>,
}

#[derive(Clone)]
pub struct Api {
    http: reqwest::Client,
    base: String,
}

impl Api {
    pub fn new(base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("Tacho/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client config is valid");
        Self { http, base }
    }

    async fn post<B: Serialize>(
        &self,
        path: &str,
        token: Option<&str>,
        body: &B,
    ) -> Result<reqwest::Response, ApiError> {
        let mut req = self.http.post(format!("{}{path}", self.base)).json(body);
        if let Some(token) = token {
            req = req.bearer_auth(token);
        }
        let res = req.send().await?;
        let status = res.status();
        if status.is_success() {
            Ok(res)
        } else if status == reqwest::StatusCode::UNAUTHORIZED {
            Err(ApiError::Unauthorized)
        } else if status.is_client_error() {
            let body = res.text().await.unwrap_or_default();
            Err(ApiError::Rejected(format!(
                "{status}: {}",
                truncate(&body, 300)
            )))
        } else {
            Err(ApiError::Server(status.as_u16()))
        }
    }

    pub async fn pair_start(&self, device_name: &str) -> Result<PairStart, ApiError> {
        let body = serde_json::json!({
            "device_name": device_name,
            "app_version": env!("CARGO_PKG_VERSION"),
        });
        Ok(self
            .post("/api/tracker/pair/start", None, &body)
            .await?
            .json()
            .await?)
    }

    pub async fn pair_poll(&self, device_code: &str) -> Result<PairPoll, ApiError> {
        let body = serde_json::json!({ "device_code": device_code });
        Ok(self
            .post("/api/tracker/pair/poll", None, &body)
            .await?
            .json()
            .await?)
    }

    pub async fn upload_job(&self, token: &str, job: &JobUpload) -> Result<JobAccepted, ApiError> {
        Ok(self
            .post("/api/tracker/jobs", Some(token), job)
            .await?
            .json()
            .await?)
    }

    pub async fn send_position(&self, token: &str, pos: &PositionUpdate) -> Result<(), ApiError> {
        self.post("/api/tracker/position", Some(token), pos).await?;
        Ok(())
    }
}

fn truncate(s: &str, max: usize) -> &str {
    match s.char_indices().nth(max) {
        Some((i, _)) => &s[..i],
        None => s,
    }
}
