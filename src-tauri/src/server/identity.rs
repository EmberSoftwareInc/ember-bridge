//! Resolve saved identities without trusting a stale DHCP address.
use super::state::AppState;
use crate::machine::{DiscoveredMachine, EmbroideryMachine, MachineError, MachineInfo};
use std::{net::IpAddr, sync::Arc};

pub fn same_device(a: &MachineInfo, manufacturer: &str, serial: &str) -> bool {
    crate::machine::net::is_local_network_ip(a.identity.ip)
        && a.identity.manufacturer == manufacturer
        && a.identity.serial.as_deref() == Some(serial)
}

pub async fn refresh_addresses(
    state: &AppState,
    found: &[DiscoveredMachine],
) -> Result<(), MachineError> {
    let config = state.config.get().await;
    let changed = config.machines.iter().any(|m| {
        m.serial.as_deref().is_some_and(|serial| {
            found.iter().any(|d| {
                same_device(&d.info, m.manufacturer.as_deref().unwrap_or(""), serial)
                    && d.info.identity.ip != m.ip
            })
        })
    });
    if !changed {
        return Ok(());
    }
    state
        .config
        .update(|c| {
            for saved in &mut c.machines {
                if let Some(serial) = &saved.serial {
                    let matches: Vec<_> = found
                        .iter()
                        .filter(|d| {
                            same_device(
                                &d.info,
                                saved.manufacturer.as_deref().unwrap_or(""),
                                serial,
                            )
                        })
                        .collect();
                    if matches.len() == 1 && matches[0].info.identity.ip != saved.ip {
                        saved
                            .previous_ips
                            .retain(|ip| *ip != matches[0].info.identity.ip);
                        saved.previous_ips.push(saved.ip);
                        if saved.previous_ips.len() > 8 {
                            saved.previous_ips.remove(0);
                        }
                        saved.ip = matches[0].info.identity.ip;
                    }
                }
            }
        })
        .await
        .map_err(|e| MachineError::Protocol(format!("Could not save device identity: {e}")))?;
    Ok(())
}

pub async fn resolve(
    state: &AppState,
    ip: IpAddr,
    expected: Option<(&str, &str)>,
) -> Result<(Arc<dyn EmbroideryMachine>, MachineInfo), MachineError> {
    let config = state.config.get().await;
    // A current address wins over an old alias reused by another saved device.
    let saved = config.machines.iter().find(|m| m.ip == ip).or_else(|| {
        config
            .machines
            .iter()
            .find(|m| m.previous_ips.contains(&ip))
    });
    let expected = expected
        .or_else(|| saved.and_then(|m| Some((m.manufacturer.as_deref()?, m.serial.as_deref()?))));
    let target = saved.map(|m| m.ip).unwrap_or(ip);
    let direct = if let Some(backend) =
        expected.and_then(|(manufacturer, _)| state.registry.by_manufacturer(manufacturer))
    {
        backend
            .probe(target)
            .await
            .map(|info| info.map(|info| (backend.connect(target), info)))
    } else {
        state.registry.identify(target).await
    };
    if let Ok(Some(found)) = direct {
        if expected.is_none_or(|(manufacturer, serial)| same_device(&found.1, manufacturer, serial))
        {
            if saved.is_some_and(|m| m.serial.is_none()) {
                let identity = &found.1.identity;
                state
                    .config
                    .update(|c| {
                        if let Some(m) = c
                            .machines
                            .iter_mut()
                            .find(|m| m.ip == target && m.serial.is_none())
                        {
                            m.serial = identity.serial.clone();
                            m.manufacturer = Some(identity.manufacturer.clone());
                        }
                    })
                    .await
                    .map_err(|e| MachineError::Protocol(e.to_string()))?;
            }
            return Ok(found);
        }
    }
    if let Some((manufacturer, serial)) = expected {
        if let Some(backend) = state.registry.by_manufacturer(manufacturer) {
            let found = backend.discover(Arc::new(|_, _| {})).await;
            let matches: Vec<_> = found
                .iter()
                .filter(|d| same_device(&d.info, manufacturer, serial))
                .collect();
            if matches.len() == 1 {
                // Discovery is only a hint: probe again immediately before use.
                let candidate = matches[0].info.identity.ip;
                if let Some(info) = backend.probe(candidate).await? {
                    let machine = backend.connect(candidate);
                    if same_device(&info, manufacturer, serial) {
                        refresh_addresses(state, &found).await?;
                        return Ok((machine, info));
                    }
                }
            }
        }
        return Err(MachineError::IdentityChanged);
    }
    Err(MachineError::Unreachable(format!(
        "No supported machine responds at {target}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::test_support::setup;
    #[tokio::test]
    async fn moved_device_is_found_without_trusting_the_old_address() {
        let (state, sim, dir) = setup().await;
        *sim.devices.lock().unwrap() = vec![
            ("192.168.1.4".parse().unwrap(), "stranger".into()),
            ("192.168.1.8".parse().unwrap(), "intended".into()),
        ];
        let (_, info) = resolve(&state, "192.168.1.4".parse().unwrap(), None)
            .await
            .unwrap();
        assert_eq!(info.identity.serial.as_deref(), Some("intended"));
        let saved = state.config.get().await.machines.remove(0);
        assert_eq!(saved.ip.to_string(), "192.168.1.8");
        assert_eq!(saved.nickname.as_deref(), Some("Sewing room"));
        assert_eq!(saved.previous_ips[0].to_string(), "192.168.1.4");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn changed_or_ambiguous_identity_is_refused() {
        let (state, sim, dir) = setup().await;
        sim.devices.lock().unwrap()[0].1 = "stranger".into();
        assert!(matches!(
            resolve(&state, "192.168.1.4".parse().unwrap(), None).await,
            Err(MachineError::IdentityChanged)
        ));
        sim.devices.lock().unwrap().extend([
            ("192.168.1.8".parse().unwrap(), "intended".into()),
            ("192.168.1.9".parse().unwrap(), "intended".into()),
        ]);
        assert!(matches!(
            resolve(&state, "192.168.1.4".parse().unwrap(), None).await,
            Err(MachineError::IdentityChanged)
        ));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
