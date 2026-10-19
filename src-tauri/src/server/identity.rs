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
    let started = std::time::Instant::now();
    let result = resolve_inner(state, ip, expected).await;
    if let Err(error) = &result {
        state.logs.warn(format!(
            "Machine resolution at {ip} failed after {} ms ({}): {error}",
            started.elapsed().as_millis(),
            error.code(),
        ));
    }
    result
}

async fn resolve_inner(
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
    let direct_error = match direct {
        Ok(Some(found)) => {
            if expected
                .is_none_or(|(manufacturer, serial)| same_device(&found.1, manufacturer, serial))
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
            // Only a successful probe with a nonmatching identity is evidence
            // of an identity problem. A timeout says nothing about identity.
            MachineError::IdentityChanged
        }
        Ok(None) => MachineError::Unreachable(format!("No supported machine responds at {target}")),
        Err(error) => error,
    };
    if let Some((manufacturer, serial)) = expected {
        state.logs.warn(format!(
            "Direct probe at {target} failed ({}): {direct_error}; searching for the saved machine",
            direct_error.code(),
        ));
        if let Some(backend) = state.registry.by_manufacturer(manufacturer) {
            let found = backend.discover(Arc::new(|_, _| {})).await;
            let matches: Vec<_> = found
                .iter()
                .filter(|d| same_device(&d.info, manufacturer, serial))
                .collect();
            state.logs.info(format!(
                "Rediscovery for {target}: {} machine(s) found, {} matching saved identity",
                found.len(),
                matches.len(),
            ));
            if matches.len() > 1 {
                return Err(MachineError::IdentityChanged);
            }
            if matches.len() == 1 {
                // Discovery is only a hint: probe again immediately before use.
                let candidate = matches[0].info.identity.ip;
                if let Some(info) = backend.probe(candidate).await? {
                    let machine = backend.connect(candidate);
                    if same_device(&info, manufacturer, serial) {
                        refresh_addresses(state, &found).await?;
                        return Ok((machine, info));
                    }
                    return Err(MachineError::IdentityChanged);
                }
                return Err(MachineError::Unreachable(format!(
                    "No supported machine responds at {candidate}"
                )));
            }
        }
    }
    Err(direct_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::test_support::setup;

    #[tokio::test]
    async fn failed_probes_keep_their_cause_with_or_without_a_saved_identity() {
        for pinned in [true, false] {
            for error in [
                MachineError::Timeout,
                MachineError::Unreachable("connection refused".into()),
                MachineError::Protocol("GET /info answered HTTP 503".into()),
            ] {
                let (state, sim, dir) = setup().await;
                if !pinned {
                    state
                        .config
                        .update(|c| c.machines[0].serial = None)
                        .await
                        .unwrap();
                }
                sim.devices.lock().unwrap().clear();
                let expected_code = error.code();
                let expected_message = error.to_string();
                sim.probe_errors.lock().unwrap().push_back(error);

                let actual = resolve(&state, "192.168.1.4".parse().unwrap(), None)
                    .await
                    .err()
                    .expect("probe must fail");
                assert_eq!(actual.code(), expected_code);
                assert_eq!(actual.to_string(), expected_message);
                assert!(state.logs.since(0).iter().any(|entry| {
                    entry.message.contains("192.168.1.4")
                        && entry.message.contains(expected_code)
                        && entry.message.contains(&expected_message)
                }));
                assert_eq!(
                    state.config.get().await.machines[0].ip.to_string(),
                    "192.168.1.4"
                );
                std::fs::remove_dir_all(dir).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn absent_saved_machine_is_unreachable_not_a_changed_identity() {
        let (state, sim, dir) = setup().await;
        sim.devices.lock().unwrap().clear();
        assert!(matches!(
            resolve(&state, "192.168.1.4".parse().unwrap(), None).await,
            Err(MachineError::Unreachable(_))
        ));
        assert_eq!(sim.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rediscovery_can_recover_after_a_direct_timeout() {
        let (state, sim, dir) = setup().await;
        sim.probe_errors
            .lock()
            .unwrap()
            .push_back(MachineError::Timeout);
        sim.devices.lock().unwrap()[0].0 = "192.168.1.8".parse().unwrap();
        let (_, info) = resolve(&state, "192.168.1.4".parse().unwrap(), None)
            .await
            .unwrap();
        assert_eq!(info.identity.serial.as_deref(), Some("intended"));
        assert_eq!(
            state.config.get().await.machines[0].ip.to_string(),
            "192.168.1.8"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rediscovered_machine_must_still_pass_the_live_probe() {
        let (state, sim, dir) = setup().await;
        sim.probe_errors.lock().unwrap().extend([
            MachineError::Timeout,
            MachineError::Unreachable("connection reset".into()),
        ]);
        sim.devices.lock().unwrap()[0].0 = "192.168.1.8".parse().unwrap();
        let actual = resolve(&state, "192.168.1.4".parse().unwrap(), None)
            .await
            .err()
            .expect("live probe must fail");
        assert!(matches!(actual, MachineError::Unreachable(_)));
        assert!(actual.to_string().contains("connection reset"));
        assert_eq!(
            state.config.get().await.machines[0].ip.to_string(),
            "192.168.1.4"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

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
