//! Desktop-only firmware delivery. Public catalogues contain no device credentials.
//! Installation rechecks the approved release and target; neither UI nor browser APIs
//! may supply an arbitrary firmware URL. The dongle verifies the RSA signature.
use crate::{dongle_setup, server::state::AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{net::IpAddr, sync::Arc, time::Duration};
use tauri::Emitter;

const CATALOG: &str =
    "https://github.com/EmberSoftwareInc/ember-link/releases/latest/download/link-releases.json";
const MAX_IMAGE: usize = 3 * 1024 * 1024;
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "transport", rename_all = "lowercase")]
pub enum Target {
    Usb { port: String, serial: String },
    Wifi { ip: IpAddr, serial: String },
}
impl Target {
    fn serial(&self) -> &str {
        match self {
            Self::Usb { serial, .. } | Self::Wifi { serial, .. } => serial,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub schema: u8,
    pub release_id: String,
    pub target_version: String,
    pub board_id: String,
    pub layout_id: String,
    pub signing_key_id: String,
    pub size: usize,
    pub sha256: String,
    pub notes: String,
    pub url: String,
}
#[derive(Deserialize)]
struct Catalog {
    schema: u8,
    releases: Vec<Release>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    firmware_update: u8,
    board_id: String,
    layout_id: String,
    max_image_size: usize,
    trusted_key_ids: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    current_version: String,
    supported: bool,
    release: Option<Release>,
    message: Option<String>,
}
fn hash_valid(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn artifact_url(s: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(s) else {
        return false;
    };
    let parts: Vec<_> = u.path().split('/').collect();
    u.scheme() == "https"
        && u.host_str() == Some("github.com")
        && u.port().is_none()
        && u.username().is_empty()
        && u.password().is_none()
        && u.query().is_none()
        && u.fragment().is_none()
        && parts.len() == 7
        && parts[1] == "EmberSoftwareInc"
        && parts[2] == "ember-link"
        && parts[3] == "releases"
        && parts[4] == "download"
        && !parts[5].is_empty()
        && parts[5] != "latest"
        && parts[6].ends_with(".bin")
}
fn validate_catalog(c: &Catalog) -> Result<(), String> {
    if c.schema != 1 || c.releases.len() > 16 {
        return Err("Unsupported firmware catalogue".into());
    }
    let mut channels = std::collections::HashSet::new();
    for r in &c.releases {
        if r.schema != 1
            || r.release_id.is_empty()
            || r.release_id.len() > 63
            || !r
                .release_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || r.target_version.is_empty()
            || r.target_version.len() > 31
            || !r
                .target_version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            || r.board_id != "lilygo-t-dongle-s3"
            || r.layout_id != "link-v1"
            || !(4096..=MAX_IMAGE).contains(&r.size)
            || !hash_valid(&r.sha256)
            || !hash_valid(&r.signing_key_id)
            || r.notes.len() > 16000
            || !artifact_url(&r.url)
            || !channels.insert((&r.board_id, &r.layout_id, &r.signing_key_id))
        {
            return Err("Invalid or ambiguous firmware catalogue".into());
        }
    }
    Ok(())
}
fn select_release(c: &Catalog, info: &Value) -> Option<Release> {
    let caps: Capabilities = serde_json::from_value(info.get("capabilities")?.clone()).ok()?;
    if caps.firmware_update != 1 || info.pointer("/update/pendingVerify")?.as_bool()? {
        return None;
    }
    // Match the cloud service's trusted-key order and recommendation semantics.
    for key in &caps.trusted_key_ids {
        if let Some(r) = c.releases.iter().find(|r| {
            r.signing_key_id == *key
                && r.board_id == caps.board_id
                && r.layout_id == caps.layout_id
                && r.size <= caps.max_image_size
                && Some(r.target_version.as_str()) != info.get("version").and_then(Value::as_str)
        }) {
            return Some(r.clone());
        }
    }
    None
}
fn public_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Ember-Bridge-firmware-updater")
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if a.previous().len() >= 5 {
                return a.error("Too many release redirects");
            }
            if a.url().scheme() == "https"
                && matches!(
                    a.url().host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                a.follow()
            } else {
                a.error("Unexpected release host")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
async fn bounded(mut response: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!(
            "Firmware server returned HTTP {}",
            response.status()
        ));
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("Firmware response is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > max {
            return Err("Firmware response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn catalog() -> Result<Catalog, String> {
    let response = public_client()?.get(CATALOG).send().await.map_err(|_| {
        "Cannot reach the firmware catalogue. Check your internet connection.".to_string()
    })?;
    if response.status().as_u16() == 404 {
        return Err("No public firmware catalogue has been published yet.".into());
    }
    let c: Catalog = serde_json::from_slice(&bounded(response, 256 * 1024).await?)
        .map_err(|_| "Invalid firmware catalogue".to_string())?;
    validate_catalog(&c)?;
    Ok(c)
}
fn lan_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .pool_max_idle_per_host(0)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}
fn lan_url(ip: IpAddr, path: &str) -> String {
    format!(
        "http://{}{path}",
        match ip {
            IpAddr::V4(_) => ip.to_string(),
            IpAddr::V6(_) => format!("[{ip}]"),
        }
    )
}
async fn lan_info(state: &AppState, ip: IpAddr, serial: &str) -> Result<Value, String> {
    let http = lan_client()?;
    let health: Value = serde_json::from_slice(
        &bounded(
            http.get(lan_url(ip, "/api/health"))
                .send()
                .await
                .map_err(|_| "Link is offline or unreachable")?,
            16384,
        )
        .await?,
    )
    .map_err(|_| "Invalid Link identity")?;
    if health.get("serial").and_then(Value::as_str) != Some(serial)
        || !matches!(
            health.get("name").and_then(Value::as_str),
            Some("Ember Link" | "EmberConnect")
        )
    {
        return Err("Link identity changed. Scan again and select the intended device.".into());
    }
    let token = state.dongle_tokens.get(serial).ok_or(
        "Pair this Link with Bridge before checking firmware over Wi-Fi, or connect it over USB.",
    )?;
    let st: Value = serde_json::from_slice(
        &bounded(
            http.get(lan_url(ip, "/api/update"))
                .bearer_auth(token)
                .send()
                .await
                .map_err(|_| "Could not read Link firmware")?,
            16384,
        )
        .await?,
    )
    .map_err(|_| "Invalid firmware status")?;
    if st.get("serial").is_some() && st.get("serial").and_then(Value::as_str) != Some(serial) {
        return Err("Link identity changed".into());
    }
    Ok(
        json!({"serial":serial,"version":st.get("version"),"update":st,"capabilities":st.get("capabilities")}),
    )
}
async fn device_info(state: &AppState, target: &Target) -> Result<Value, String> {
    if target.serial().is_empty() {
        return Err("Scan and save this Link's identity first, or connect it over USB.".into());
    }
    let i = match target {
        Target::Usb { port, .. } => dongle_setup::read_info(port.clone())
            .await
            .map_err(|e| e.message)?,
        Target::Wifi { ip, serial } => lan_info(state, *ip, serial).await?,
    };
    if i.get("serial").and_then(Value::as_str) != Some(target.serial()) {
        return Err("The selected Link changed. Check again.".into());
    }
    Ok(i)
}
#[tauri::command]
pub async fn link_check_update(
    state: tauri::State<'_, Arc<AppState>>,
    target: Target,
) -> Result<Offer, String> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| "An update is in progress")?;
    let info = device_info(&state, &target).await?;
    let supported = info
        .get("capabilities")
        .cloned()
        .and_then(|v| serde_json::from_value::<Capabilities>(v).ok())
        .is_some_and(|c| c.firmware_update == 1 && !c.trusted_key_ids.is_empty());
    let mut offer = Offer {
        current_version: info
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .into(),
        supported,
        release: None,
        message: None,
    };
    if !supported {
        offer.message = Some("This Link needs a one-time signed USB update before Bridge can discover compatible releases. Use Advanced USB recovery in Ember Link settings.".into());
        return Ok(offer);
    }
    if info
        .pointer("/update/pendingVerify")
        .and_then(Value::as_bool)
        != Some(false)
    {
        offer.message =
            Some("Link is still confirming its current firmware. Check again shortly.".into());
        return Ok(offer);
    }
    offer.release = select_release(&catalog().await?, &info);
    Ok(offer)
}
fn verify_image(image: &[u8], r: &Release) -> Result<(), String> {
    let field = |a, b| {
        std::str::from_utf8(&image[a..b])
            .ok()
            .map(|s| s.split('\0').next().unwrap_or(""))
    };
    if image.len() != r.size
        || image.len() < 4096
        || image[0] != 0xe9
        || image[12..14] != [9, 0]
        || image[32..36] != [0x32, 0x54, 0xcd, 0xab]
        || field(48, 80) != Some(&r.target_version)
        || field(80, 112) != Some("ember-link")
        || format!("{:x}", Sha256::digest(image)) != r.sha256
    {
        return Err(
            "Firmware download failed integrity or compatibility checks; nothing was installed."
                .into(),
        );
    }
    Ok(())
}
fn boot_confirmed(before: &Value, after: &Value, version: &str) -> bool {
    before.get("serial") == after.get("serial")
        && after.get("version").and_then(Value::as_str) == Some(version)
        && before
            .pointer("/update/slot")
            .and_then(Value::as_str)
            .is_some()
        && after
            .pointer("/update/slot")
            .and_then(Value::as_str)
            .is_some()
        && before.pointer("/update/slot") != after.pointer("/update/slot")
        && after
            .pointer("/update/pendingVerify")
            .and_then(Value::as_bool)
            == Some(false)
}
#[tauri::command]
pub async fn link_install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    target: Target,
    release_id: String,
    sha256: String,
    confirmed: bool,
) -> Result<Value, String> {
    if !confirmed {
        return Err("Confirm the machine is idle and Link may restart.".into());
    }
    let _lifecycle = state
        .lifecycle
        .try_write()
        .map_err(|_| "Finish transfers and USB operations before updating.")?;
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Another device operation is running")?;
    if state.jobs.pending_count() > 0 {
        return Err("Finish or cancel queued transfers before updating.".into());
    }
    let before = device_info(&state, &target).await?;
    let release = select_release(&catalog().await?, &before)
        .filter(|r| r.release_id == release_id && r.sha256 == sha256)
        .ok_or("The recommended release changed or is incompatible. Check again.")?;
    let phase = |s: &str| {
        let _ = app.emit("link-firmware-progress", s);
    };
    phase("Downloading and checking firmware…");
    let bytes = bounded(
        public_client()?
            .get(&release.url)
            .send()
            .await
            .map_err(|_| "Firmware download failed")?,
        release.size,
    )
    .await?;
    verify_image(&bytes, &release)?;
    let fresh = device_info(&state, &target).await?;
    if before.get("version") != fresh.get("version")
        || before.pointer("/update/slot") != fresh.pointer("/update/slot")
        || select_release(
            &Catalog {
                schema: 1,
                releases: vec![release.clone()],
            },
            &fresh,
        )
        .is_none()
    {
        return Err("Link changed during download. Check again before updating.".into());
    }
    phase("Installing firmware. Keep Link powered on…");
    match &target {
        Target::Usb { port, serial } => {
            let result = dongle_setup::update_release_image(
                app.clone(),
                port.clone(),
                bytes,
                serial.clone(),
                release.target_version.clone(),
            )
            .await
            .map_err(|e| e.message)?;
            if result.get("bootConfirmed").and_then(Value::as_bool) != Some(true) {
                return Err("The update could not be confirmed. Reconnect Link and check its version before trying again.".into());
            }
        }
        Target::Wifi { ip, serial } => {
            let token = state
                .dongle_tokens
                .get(serial)
                .ok_or("Link pairing is missing")?;
            // Exactly one POST. A lost response might follow a successful flash.
            upload_once(&lan_client()?, &lan_url(*ip, "/api/update"), &token, bytes).await?;
            phase("Waiting for Link to restart and confirm the update…");
            let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
            let mut installed = false;
            while tokio::time::Instant::now() < deadline {
                tokio::time::sleep(Duration::from_secs(3)).await;
                if let Ok(after) = lan_info(&state, *ip, serial).await {
                    if boot_confirmed(&before, &after, &release.target_version) {
                        installed = true;
                        break;
                    }
                }
            }
            if !installed {
                return Err("Installation could not be confirmed. Link may have restarted, rolled back, or changed its IP. Scan again or connect over USB and check its version before retrying.".into());
            }
        }
    }
    phase("Firmware updated successfully.");
    Ok(json!({"version":release.target_version,"bootConfirmed":true}))
}

// A lost response may follow a successful flash: callers must observe boot state.
async fn upload_once(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let response = http
        .post(url)
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .timeout(Duration::from_secs(180))
        .body(bytes)
        .send()
        .await;
    if let Ok(response) = response {
        if response.status().is_client_error() {
            return Err(format!(
                "Link rejected the update (HTTP {}). Check that it is idle and paired.",
                response.status()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release() -> Release {
        Release { schema:1, release_id:"test-035".into(), target_version:"0.3.5".into(), board_id:"lilygo-t-dongle-s3".into(), layout_id:"link-v1".into(), signing_key_id:"a".repeat(64), size:4096, sha256:"b".repeat(64), notes:"Notes".into(), url:"https://github.com/EmberSoftwareInc/ember-link/releases/download/v0.3.5/ember-link.bin".into() }
    }
    fn info() -> Value {
        json!({"serial":"one","version":"0.3.4","update":{"slot":"ota_0","pendingVerify":false},"capabilities":{"firmwareUpdate":1,"boardId":"lilygo-t-dongle-s3","layoutId":"link-v1","maxImageSize":3145728,"trustedKeyIds":["a".repeat(64)]}})
    }
    #[test]
    fn catalog_rejects_foreign_urls_and_duplicate_channels() {
        let r = release();
        assert!(artifact_url(&r.url));
        for url in [
            "http://github.com/EmberSoftwareInc/ember-link/releases/download/v1/f.bin",
            "https://github.com/other/ember-link/releases/download/v1/f.bin",
            "https://github.com/EmberSoftwareInc/ember-link/releases/latest/download/f.bin",
        ] {
            assert!(!artifact_url(url));
        }
        assert!(validate_catalog(&Catalog {
            schema: 1,
            releases: vec![r.clone(), r]
        })
        .is_err());
    }
    #[test]
    fn selection_requires_reported_capabilities_key_size_and_healthy_boot() {
        let c = Catalog {
            schema: 1,
            releases: vec![release()],
        };
        let base = info();
        assert!(select_release(&c, &base).is_some());
        for (pointer, value) in [
            ("/capabilities/trustedKeyIds", json!(["b".repeat(64)])),
            ("/capabilities/maxImageSize", json!(4000)),
            ("/capabilities/layoutId", json!("other")),
            ("/update/pendingVerify", json!(true)),
            ("/version", json!("0.3.5")),
        ] {
            let mut v = base.clone();
            *v.pointer_mut(pointer).unwrap() = value;
            assert!(select_release(&c, &v).is_none());
        }
        assert!(select_release(&c, &json!({"version":"0.3.4"})).is_none());
    }
    #[test]
    fn image_checks_actual_bytes_not_just_manifest() {
        let mut r = release();
        let mut b = vec![0u8; r.size];
        b[0] = 0xe9;
        b[12] = 9;
        b[32..36].copy_from_slice(&[0x32, 0x54, 0xcd, 0xab]);
        b[48..53].copy_from_slice(b"0.3.5");
        b[80..90].copy_from_slice(b"ember-link");
        r.sha256 = format!("{:x}", Sha256::digest(&b));
        assert!(verify_image(&b, &r).is_ok());
        b[500] ^= 1;
        assert!(verify_image(&b, &r).is_err());
    }
    #[test]
    fn success_requires_requested_version_new_slot_identity_and_confirmation() {
        let before = info();
        let mut after = before.clone();
        after["version"] = json!("0.3.5");
        after["update"]["slot"] = json!("ota_1");
        assert!(boot_confirmed(&before, &after, "0.3.5"));
        for (p, v) in [
            ("/serial", json!("other")),
            ("/version", json!("0.3.4")),
            ("/update/slot", json!("ota_0")),
            ("/update/pendingVerify", json!(true)),
        ] {
            let mut bad = after.clone();
            *bad.pointer_mut(p).unwrap() = v;
            assert!(!boot_confirmed(&before, &bad, "0.3.5"));
        }
    }
    #[tokio::test]
    async fn wifi_post_never_replays_ambiguous_responses_or_follows_redirects() {
        use axum::{routing::post, Router};
        use std::sync::atomic::{AtomicUsize, Ordering};
        for status in [500, 400, 302, 200] {
            let calls = Arc::new(AtomicUsize::new(0));
            let redirects = Arc::new(AtomicUsize::new(0));
            let count = calls.clone();
            let redirected = redirects.clone();
            let app = Router::new()
                .route(
                    "/api/update",
                    post(move |headers: axum::http::HeaderMap, body: bytes::Bytes| {
                        let count = count.clone();
                        async move {
                            count.fetch_add(1, Ordering::SeqCst);
                            assert_eq!(
                                headers.get("authorization").unwrap(),
                                "Bearer disposable-test-token"
                            );
                            assert_eq!(headers.get("content-length").unwrap(), "4");
                            assert_eq!(&body[..], b"test");
                            (
                                axum::http::StatusCode::from_u16(status).unwrap(),
                                [("location", "/redirect")],
                                "result",
                            )
                        }
                    }),
                )
                .route(
                    "/redirect",
                    post(move || {
                        let count = redirected.clone();
                        async move {
                            count.fetch_add(1, Ordering::SeqCst);
                            "unexpected"
                        }
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/api/update", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                axum::serve(listener, app).await.unwrap();
            });
            let result = upload_once(
                &lan_client().unwrap(),
                &url,
                "disposable-test-token",
                b"test".to_vec(),
            )
            .await;
            assert_eq!(result.is_err(), status == 400);
            assert_eq!(calls.load(Ordering::SeqCst), 1);
            assert_eq!(redirects.load(Ordering::SeqCst), 0);
            server.abort();
        }
    }
}
