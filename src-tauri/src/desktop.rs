//! Desktop lifecycle: navigation-only URLs and signature-verified updates.
use crate::server::state::AppState;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
struct Navigation(Mutex<Option<String>>);
fn destination(url: &reqwest::Url) -> Option<&'static str> {
    if url.scheme() != "ember-bridge"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return None;
    }
    match url.host_str()? {
        "open" => Some("machines"),
        "connect" => Some("settings"),
        "setup" => Some("setup"),
        _ => None,
    }
}
fn navigate(app: &tauri::AppHandle, urls: Vec<reqwest::Url>) {
    for url in urls {
        if let Some(page) = destination(&url) {
            *app.state::<Navigation>().0.lock().unwrap() = Some(page.to_string());
            crate::show_main_window(app);
            let _ = app.emit("bridge-navigation", ());
        }
    }
}
pub fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Navigation::default());
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    app.deep_link().register_all()?;
    let handle = app.handle().clone();
    app.deep_link()
        .on_open_url(move |event| navigate(&handle, event.urls()));
    if let Some(urls) = app.deep_link().get_current()? {
        navigate(app.handle(), urls);
    }
    Ok(())
}
#[tauri::command]
pub fn take_navigation(app: tauri::AppHandle) -> Option<String> {
    app.state::<Navigation>().0.lock().unwrap().take()
}
#[derive(serde::Serialize)]
pub struct AvailableUpdate {
    version: String,
    notes: Option<String>,
}
#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Option<AvailableUpdate>, String> {
    app.updater_builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?.check().await.map(|u| u.map(|u| AvailableUpdate { version: u.version, notes: u.body })).map_err(|_| "Could not check for updates. The first signed release may not be published yet; try again later or check GitHub Releases.".into())
}
#[tauri::command]
pub async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    version: String,
) -> Result<(), String> {
    let _lifecycle = state
        .lifecycle
        .try_write()
        .map_err(|_| "Finish the current transfer or USB setup before updating.".to_string())?;
    if state.jobs.pending_count() > 0 {
        return Err("Finish or cancel queued transfers before updating.".into());
    }
    let update = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update is available")?;
    if update.version != version {
        return Err("The available release changed. Check for updates again.".into());
    }
    // The plugin verifies the embedded public key before installing any bytes.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_navigation_only() {
        for (url, page) in [
            ("ember-bridge://open", "machines"),
            ("ember-bridge://connect/", "settings"),
            ("ember-bridge://setup", "setup"),
        ] {
            assert_eq!(destination(&url.parse().unwrap()), Some(page));
        }
        for url in [
            "https://open",
            "ember-bridge://send",
            "ember-bridge://open?token=secret",
            "ember-bridge://setup/file",
            "ember-bridge://user@open",
            "ember-bridge://open:42",
            "ember-bridge://connect#approve",
        ] {
            assert_eq!(destination(&url.parse().unwrap()), None);
        }
    }
}
