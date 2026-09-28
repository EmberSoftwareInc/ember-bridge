//! Release qualification only: install signed artifacts into a disposable app copy.
//! The production application and its updater configuration are unchanged.
use std::{env, path::PathBuf};
use tauri_plugin_updater::UpdaterExt;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 6 {
        return Err(
            "usage: release_update_probe TARGET EXECUTABLE FEED_URL FROM_VERSION EVIDENCE_DIR"
                .into(),
        );
    }
    let executable = PathBuf::from(&args[2]).canonicalize()?;
    let evidence = PathBuf::from(&args[5]).canonicalize()?;
    // A caller must deliberately mark its disposable destination. Never point at an installed app.
    let marker = evidence.join("ALLOW_DISPOSABLE_UPDATE");
    if !marker.is_file() || !executable.starts_with(&evidence) {
        return Err("executable must be inside a marked disposable evidence directory".into());
    }
    if !args[3].starts_with("http://127.0.0.1:") {
        return Err("qualification feed must be loopback".into());
    }
    let production: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))?;
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = args[4].parse()?;
    context.package_info_mut().name = "Ember Bridge".into();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": production["plugins"]["updater"]["pubkey"],
            "endpoints": [args[3]], "dangerousInsecureTransportProtocol": true,
            "windows": {"installMode": "quiet"}
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)?;
    let builder = app
        .updater_builder()
        .executable_path(&executable)
        .target(&args[1])
        .no_proxy()
        .restart_after_install(false);
    #[cfg(windows)]
    let builder = {
        let path = PathBuf::from(&args[2]);
        let directory = path.parent().unwrap().display();
        if args[1].ends_with("-msi") {
            builder
                .installer_arg(format!("INSTALLDIR=\"{directory}\""))
                .installer_arg("/L*v")
                .installer_arg(format!("\"{}\"", evidence.join("update-msi.log").display()))
        } else {
            builder.installer_arg(format!("/D={directory}"))
        }
    };
    tauri::async_runtime::block_on(async {
        let update = builder
            .build()?
            .check()
            .await?
            .ok_or("expected a newer release")?;
        let bytes = update.download(|_, _| {}, || {}).await?;
        std::fs::write(
            evidence.join("signature-verified.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "from": args[4], "to": update.version, "target": args[1], "bytes": bytes.len(),
                "productionSigningKeyVerified": true
            }))?,
        )?;
        update.install(bytes)?;
        Ok::<(), Box<dyn std::error::Error>>(())
    })
}
