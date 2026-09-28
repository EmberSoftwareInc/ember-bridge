//! Desktop (USB) setup for Ember Link dongles.
//!
//! When a dongle is plugged into *this* computer it exposes a CDC serial
//! port next to its flash-drive volume; over it we can scan WiFi, try
//! credentials live (the dongle only commits them once a join succeeds),
//! name the machine, pre-pair this Bridge, and push firmware — all before
//! the dongle ever meets the embroidery machine.
//!
//! Unlike the rest of the app, this surface is deliberately *not* on the
//! localhost REST API: provisioning handles WiFi passwords and talks to
//! local hardware, neither of which paired browser origins have any
//! business reaching. The React UI calls these Tauri commands directly.
//!
//! The wire protocol lives in the firmware repo (Ember Link,
//! `firmware/main/usb_setup.h`); [`link`] implements the transport.

pub mod link;

use crate::server::state::AppState;
use link::{DongleLink, DongleSummary};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

/// The dongle resolves a provisioning trial in ≤30 s; leave slack on top.
const PROVISION_TIMEOUT: Duration = Duration::from_secs(50);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
/// A scan from a *connected* dongle dwells gently per channel to protect
/// the live connection and can far outlast an idle-radio scan.
const SCAN_TIMEOUT: Duration = Duration::from_secs(25);
/// Between update protocol lines — flash writes make the dongle chatty
/// enough (progress every 64 KiB) that longer silence means it died.
const UPDATE_QUIET_TIMEOUT: Duration = Duration::from_secs(30);

/// One serial conversation at a time, app-wide. The dongle's worker is
/// single-threaded and the port is exclusive; concurrent commands (React
/// re-mounts, an eager user) must queue here instead of failing to open
/// the port or interleaving traffic.
static SESSION: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn session_lock() -> std::sync::MutexGuard<'static, ()> {
    SESSION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupError {
    pub code: String,
    pub message: String,
}

impl SetupError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

pub type SetupResult<T> = Result<T, SetupError>;

/// What the wizard needs after a successful provision.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionOutcome {
    pub ssid: String,
    pub ip: String,
    pub serial: Option<String>,
    /// Whether this Bridge also minted + stored a LAN API token, so the
    /// dongle shows up ready-to-use once it's on the machine.
    pub paired: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub written: u64,
    pub total: u64,
}

/// Commands run blocking serial I/O; keep them off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> SetupResult<T> + Send + 'static,
) -> SetupResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| SetupError::new("task_failed", e.to_string()))?
}

#[tauri::command]
pub async fn dongle_list() -> SetupResult<Vec<DongleSummary>> {
    blocking(|| Ok(link::list())).await
}

#[tauri::command]
pub async fn dongle_info(
    state: tauri::State<'_, Arc<AppState>>,
    port: String,
) -> SetupResult<Value> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| SetupError::new("updating", "An update is in progress"))?;
    read_info(port).await
}
// Internal reader for the guided updater, which already owns the lifecycle lock.
pub async fn read_info(port: String) -> SetupResult<Value> {
    blocking(move || {
        let _session = session_lock();
        DongleLink::open(&port)?.request("info", json!({}), COMMAND_TIMEOUT, |_| {})
    })
    .await
}

#[tauri::command]
pub async fn dongle_set_display(
    state: tauri::State<'_, Arc<AppState>>,
    port: String,
    serial: String,
    enabled: bool,
    rotation: u16,
    led_enabled: Option<bool>,
) -> SetupResult<Value> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| SetupError::new("updating", "An update is in progress"))?;
    if rotation != 0 && rotation != 180 {
        return Err(SetupError::new(
            "invalid_display",
            "Choose normal or upside down",
        ));
    }
    blocking(move || {
        let _session = session_lock();
        let mut link = DongleLink::open(&port)?;
        let info = link.request("info", json!({}), COMMAND_TIMEOUT, |_| {})?;
        if serial.is_empty() || info.get("serial").and_then(Value::as_str) != Some(&serial) {
            return Err(SetupError::new(
                "device_changed",
                "Reconnect the selected Ember Link",
            ));
        }
        if info.get("display").is_none() {
            return Err(SetupError::new(
                "update_required",
                "Update Link firmware to change its screen settings",
            ));
        }
        let mut settings = json!({"enabled": enabled, "rotation": rotation});
        if let Some(led) = led_enabled {
            if info
                .pointer("/display/ledEnabled")
                .and_then(Value::as_bool)
                .is_none()
            {
                return Err(SetupError::new(
                    "update_required",
                    "Update Link firmware to control the status light",
                ));
            }
            settings["ledEnabled"] = json!(led);
        }
        let result = link.request("set_display", settings, COMMAND_TIMEOUT, |_| {})?;
        if result.pointer("/display/enabled").and_then(Value::as_bool) != Some(enabled)
            || result.pointer("/display/rotation").and_then(Value::as_u64) != Some(rotation.into())
            || led_enabled.is_some_and(|led| {
                result
                    .pointer("/display/ledEnabled")
                    .and_then(Value::as_bool)
                    != Some(led)
            })
        {
            return Err(SetupError::new(
                "invalid_response",
                "Reconnect Link to check its screen settings",
            ));
        }
        Ok(result)
    })
    .await
}

#[tauri::command]
pub async fn dongle_scan(
    state: tauri::State<'_, Arc<AppState>>,
    port: String,
) -> SetupResult<Value> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| SetupError::new("updating", "An update is in progress"))?;
    blocking(move || {
        let _session = session_lock();
        DongleLink::open(&port)?.request("scan", json!({}), SCAN_TIMEOUT, |_| {})
    })
    .await
}

/// Provision over USB: try the credentials live, and once the dongle is on
/// the network, pair this Bridge with it so the machine is usable the
/// moment it's plugged in. A wrong password comes back as the error code
/// `wrong_password` — the wizard turns that into an inline retry.
#[tauri::command]
pub async fn dongle_provision(
    state: tauri::State<'_, Arc<AppState>>,
    port: String,
    ssid: String,
    password: String,
    name: String,
) -> SetupResult<ProvisionOutcome> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| SetupError::new("updating", "Bridge is installing an update"))?;
    let tokens = state.dongle_tokens.clone();
    blocking(move || {
        let _session = session_lock();
        let mut link = DongleLink::open(&port)?;
        let response = link.request(
            "provision",
            json!({ "ssid": ssid, "password": password, "name": name }),
            PROVISION_TIMEOUT,
            |_| {},
        )?;

        let ip = response
            .get("ip")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        // Pairing failure is not a provisioning failure: the dongle is on
        // the network either way, and LAN pairing (power-on window) can
        // still happen later.
        let mut serial = None;
        let mut paired = false;
        match link.request(
            "pair",
            json!({ "name": "Ember Bridge" }),
            COMMAND_TIMEOUT,
            |_| {},
        ) {
            Ok(pair) => {
                serial = pair
                    .get("serial")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let (Some(s), Some(token)) =
                    (serial.as_deref(), pair.get("token").and_then(Value::as_str))
                {
                    tokens.set(s, token);
                    paired = true;
                }
            }
            Err(e) => tracing::warn!("USB pairing after provision failed: {}", e.message),
        }

        Ok(ProvisionOutcome {
            ssid,
            ip,
            serial,
            paired,
        })
    })
    .await
}

/// Push a signed firmware image from a local file. Progress reaches the UI
/// as `dongle-update-progress` events; the dongle verifies the signature
/// and reboots itself on success (the port will vanish — that's the "done").
#[tauri::command]
pub async fn dongle_update_firmware(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    port: String,
    image_path: String,
) -> SetupResult<Value> {
    let _lifecycle = state
        .lifecycle
        .try_read()
        .map_err(|_| SetupError::new("updating", "Bridge is installing an update"))?;
    blocking(move || {
        let _session = session_lock();
        if std::fs::metadata(&image_path)
            .map_err(|e| SetupError::new("image_unreadable", e.to_string()))?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(SetupError::new(
                "image_too_large",
                "Firmware image exceeds 4 MiB",
            ));
        }
        let image = std::fs::read(&image_path)
            .map_err(|e| SetupError::new("image_unreadable", format!("{image_path}: {e}")))?;
        install_image(app, port, image, None)
    })
    .await
}

// A healthy old slot can be a rollback; never report it as update success.
fn healthy_updated_boot(before: &Value, after: &Value) -> bool {
    let serial = before.get("serial").and_then(Value::as_str);
    let old_slot = before.pointer("/update/slot").and_then(Value::as_str);
    let new_slot = after.pointer("/update/slot").and_then(Value::as_str);
    serial.is_some_and(|s| !s.is_empty())
        && serial == after.get("serial").and_then(Value::as_str)
        && old_slot.is_some()
        && new_slot.is_some()
        && old_slot != new_slot
        && after
            .pointer("/update/pendingVerify")
            .and_then(Value::as_bool)
            == Some(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn update_confirmation_rejects_old_slot_pending_boot_and_swapped_device() {
        let before = json!({"serial":"one","update":{"slot":"ota_0","pendingVerify":false}});
        assert!(!healthy_updated_boot(&before, &before));
        assert!(healthy_updated_boot(
            &before,
            &json!({"serial":"one","update":{"slot":"ota_1","pendingVerify":false}})
        ));
        assert!(!healthy_updated_boot(
            &before,
            &json!({"serial":"one","update":{"slot":"ota_1","pendingVerify":true}})
        ));
        assert!(!healthy_updated_boot(
            &before,
            &json!({"serial":"two","update":{"slot":"ota_1","pendingVerify":false}})
        ));
        assert!(!healthy_updated_boot(
            &before,
            &json!({"serial":"one","update":{"slot":"ota_1"}})
        ));
    }
}

// Called with the application lifecycle exclusively reserved by the guided updater.
pub async fn update_release_image(
    app: tauri::AppHandle,
    port: String,
    image: Vec<u8>,
    serial: String,
    version: String,
) -> SetupResult<Value> {
    blocking(move || {
        let _session = session_lock();
        install_image(app, port, image, Some((serial, version)))
    })
    .await
}
fn install_image(
    app: tauri::AppHandle,
    port: String,
    image: Vec<u8>,
    expected: Option<(String, String)>,
) -> SetupResult<Value> {
    let total = image.len() as u64;

    let mut link = DongleLink::open(&port)?;
    let before = link.request("info", json!({}), COMMAND_TIMEOUT, |_| {})?;
    let serial = before
        .get("serial")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| SetupError::new("missing_identity", "Cannot verify this dongle's identity"))?
        .to_string();
    if let Some((serial, version)) = &expected {
        if before.get("serial").and_then(Value::as_str) != Some(serial.as_str()) {
            return Err(SetupError::new(
                "device_changed",
                "The USB dongle changed. Check again.",
            ));
        }
        if before.get("version").and_then(Value::as_str) == Some(version.as_str()) {
            return Err(SetupError::new(
                "already_installed",
                "This firmware is already installed.",
            ));
        }
    }
    let old_slot = before
        .pointer("/update/slot")
        .and_then(Value::as_str)
        .ok_or_else(|| SetupError::new("missing_slot", "Cannot verify this dongle's boot slot"))?
        .to_string();
    link.request("update", json!({ "size": total }), COMMAND_TIMEOUT, |_| {})?;

    // The dongle said "ready": stream the image, then collect progress
    // events until the final ok/error response line.
    link.write_raw(&image)?;
    loop {
        let Some(line) = link.next_line(UPDATE_QUIET_TIMEOUT)? else {
            return Err(SetupError::new(
                "dongle_timeout",
                "the dongle went quiet mid-update",
            ));
        };
        if line.get("event").and_then(Value::as_str) == Some("update") {
            let _ = app.emit(
                "dongle-update-progress",
                UpdateProgress {
                    written: line.get("written").and_then(Value::as_u64).unwrap_or(0),
                    total: line.get("total").and_then(Value::as_u64).unwrap_or(total),
                },
            );
            continue;
        }
        if line.get("ok").and_then(Value::as_bool) == Some(true) {
            drop(link);
            // Signature acceptance precedes boot confirmation. Reacquire by
            // identity because the OS port name can change after a restart.
            let deadline = std::time::Instant::now() + Duration::from_secs(60);
            while std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_secs(2));
                for candidate in link::list()
                    .into_iter()
                    .filter(|p| p.serial.as_deref() == Some(&serial))
                {
                    let Ok(mut connection) = DongleLink::open(&candidate.port) else {
                        continue;
                    };
                    let Ok(info) = connection.request("info", json!({}), COMMAND_TIMEOUT, |_| {})
                    else {
                        continue;
                    };
                    if healthy_updated_boot(&before, &info)
                        && expected.as_ref().is_none_or(|(_, v)| {
                            info.get("version").and_then(Value::as_str) == Some(v.as_str())
                        })
                    {
                        return Ok(json!({ "bootConfirmed": true, "info": info }));
                    }
                }
            }
            return Ok(json!({ "bootConfirmed": false, "previousSlot": old_slot }));
        }
        if line.get("ok").is_some() {
            let code = line
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("update_failed");
            let message = line
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("the dongle rejected the image");
            return Err(SetupError::new(code, message));
        }
    }
}
