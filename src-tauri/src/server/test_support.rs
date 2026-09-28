//! Simulated devices for identity and queue regression tests; no LAN access.
use super::state::AppState;
use crate::{
    config::{ConfigStore, SavedMachine},
    machine::*,
};
use async_trait::async_trait;
use std::{
    net::IpAddr,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
#[derive(Default)]
pub struct Simulated {
    pub devices: Mutex<Vec<(IpAddr, String)>>,
    pub calls: AtomicUsize,
    pub busy: AtomicUsize,
    pub uncertain: std::sync::atomic::AtomicBool,
}
struct Handle {
    ip: IpAddr,
    sim: Arc<Simulated>,
}
struct Backend(Arc<Simulated>);
fn info(ip: IpAddr, serial: &str) -> MachineInfo {
    MachineInfo {
        identity: MachineIdentity {
            ip,
            serial: Some(serial.into()),
            manufacturer: "test".into(),
            model: "test".into(),
            name: None,
            firmware: None,
        },
        capabilities: MachineCapabilities {
            emb_width_mm: None,
            emb_height_mm: None,
            needles: None,
            max_file_bytes: None,
            formats: vec!["pes".into()],
            can_delete_files: true,
            overwrites_by_name: true,
        },
    }
}
#[async_trait]
impl EmbroideryMachine for Handle {
    fn manufacturer(&self) -> &'static str {
        "test"
    }
    fn ip(&self) -> IpAddr {
        self.ip
    }
    async fn info(&self) -> Result<MachineInfo, MachineError> {
        self.sim
            .devices
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.0 == self.ip)
            .map(|d| info(d.0, &d.1))
            .ok_or(MachineError::IdentityChanged)
    }
    async fn storage(&self) -> Result<StorageStatus, MachineError> {
        Ok(StorageStatus {
            total_bytes: 1000,
            free_bytes: 1000,
            used_bytes: 0,
            files: vec!["existing.pes".into()],
        })
    }
    async fn upload(
        &self,
        request: UploadRequest,
        _: ProgressFn,
    ) -> Result<UploadReceipt, MachineError> {
        self.sim.calls.fetch_add(1, Ordering::SeqCst);
        if self
            .sim
            .busy
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| v.checked_sub(1))
            .is_ok()
        {
            return Err(MachineError::Busy);
        }
        if self.sim.uncertain.load(Ordering::SeqCst) {
            return Err(MachineError::DeliveryUnknown);
        }
        Ok(UploadReceipt {
            bytes_sent: request.data.len() as u64,
            stored_as: Some(request.filename),
        })
    }
}
#[async_trait]
impl MachineBackend for Backend {
    fn manufacturer(&self) -> &'static str {
        "test"
    }
    async fn probe(&self, ip: IpAddr) -> Result<Option<MachineInfo>, MachineError> {
        Ok(self
            .0
            .devices
            .lock()
            .unwrap()
            .iter()
            .find(|d| d.0 == ip)
            .map(|d| info(d.0, &d.1)))
    }
    fn connect(&self, ip: IpAddr) -> Arc<dyn EmbroideryMachine> {
        Arc::new(Handle {
            ip,
            sim: self.0.clone(),
        })
    }
    async fn discover(&self, _: ScanProgressFn) -> Vec<DiscoveredMachine> {
        self.0
            .devices
            .lock()
            .unwrap()
            .iter()
            .map(|d| DiscoveredMachine {
                info: info(d.0, &d.1),
            })
            .collect()
    }
}
pub async fn setup() -> (Arc<AppState>, Arc<Simulated>, PathBuf) {
    let dir = std::env::temp_dir().join(format!("bridge-simulation-{:x}", rand::random::<u128>()));
    let config = ConfigStore::load_or_create(dir.clone()).unwrap();
    config
        .update(|c| {
            c.machines.push(SavedMachine {
                ip: "192.168.1.4".parse().unwrap(),
                nickname: Some("Sewing room".into()),
                manufacturer: Some("test".into()),
                serial: Some("intended".into()),
                previous_ips: vec![],
            })
        })
        .await
        .unwrap();
    let sim = Arc::new(Simulated::default());
    sim.devices
        .lock()
        .unwrap()
        .push(("192.168.1.4".parse().unwrap(), "intended".into()));
    let mut state = AppState::new(config, 17831);
    state.registry = BackendRegistry::for_tests(vec![Arc::new(Backend(sim.clone()))]);
    (Arc::new(state), sim, dir)
}
