//! Bounded, serialized uploads. History survives restart; file bodies never do.
use super::{error::ApiError, identity, state::AppState};
use crate::machine::{MachineError, UploadProgress, UploadRequest};
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Waiting,
    Uploading,
    Done,
    Failed,
    Cancelled,
    NeedsReconciliation,
}
impl JobState {
    fn pending(self) -> bool {
        matches!(self, Self::Queued | Self::Waiting | Self::Uploading)
    }
    fn finished(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Cancelled)
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub filename: String,
    pub ip: IpAddr,
    pub state: JobState,
    pub sent_bytes: u64,
    pub total_bytes: u64,
    pub stored_as: Option<String>,
    pub error_code: Option<String>,
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub finished_at_ms: Option<u64>,
    #[serde(default)]
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub serial: Option<String>,
}
struct QueuedUpload {
    id: String,
    data: bytes::Bytes,
    overwrite: bool,
    _budget: OwnedSemaphorePermit,
}
pub struct JobQueue {
    records: Mutex<Vec<JobRecord>>,
    path: PathBuf,
    tx: mpsc::Sender<QueuedUpload>,
    rx: Mutex<Option<mpsc::Receiver<QueuedUpload>>>,
    budget: Arc<Semaphore>,
}
const MAX_BYTES: usize = 128 * 1024 * 1024;
impl JobQueue {
    pub fn load(dir: &std::path::Path) -> std::io::Result<Self> {
        let path = dir.join("transfer-history.json");
        let mut records: Vec<JobRecord> = match std::fs::read(&path) {
            Ok(raw) => serde_json::from_slice(&raw).map_err(std::io::Error::other)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(e) => return Err(e),
        };
        for record in &mut records {
            if record.state.pending() {
                record.state = if record.state == JobState::Uploading {
                    JobState::NeedsReconciliation
                } else {
                    JobState::Failed
                };
                record.error_code = Some("interrupted".into());
                record.error = Some("Bridge stopped before this transfer finished. Check the device before sending again.".into());
                record.finished_at_ms = Some(now_ms());
            }
        }
        prune_finished(&mut records);
        let (tx, rx) = mpsc::channel(32);
        let queue = Self {
            records: Mutex::new(records),
            path,
            tx,
            rx: Mutex::new(Some(rx)),
            budget: Arc::new(Semaphore::new(MAX_BYTES)),
        };
        queue.persist(&queue.records.lock().unwrap())?;
        Ok(queue)
    }
    fn persist(&self, records: &[JobRecord]) -> std::io::Result<()> {
        use std::io::Write;
        let tmp = self.path.with_extension("tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(&serde_json::to_vec(records)?)?;
        file.sync_all()?;
        std::fs::rename(tmp, &self.path)
    }
    fn change(
        &self,
        id: &str,
        f: impl FnOnce(&mut JobRecord) -> Result<(), ApiError>,
    ) -> Result<JobRecord, ApiError> {
        let mut records = self.records.lock().unwrap();
        let mut next = records.clone();
        let record = next
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| ApiError::not_found("Unknown transfer"))?;
        f(record)?;
        let result = record.clone();
        prune_finished(&mut next);
        self.persist(&next)
            .map_err(|e| ApiError::internal(format!("Could not save transfer history: {e}")))?;
        *records = next;
        Ok(result)
    }
    pub fn enqueue(
        &self,
        ip: IpAddr,
        filename: String,
        data: bytes::Bytes,
        expected: Option<(String, String)>,
        overwrite: bool,
    ) -> Result<JobRecord, ApiError> {
        let full = || {
            ApiError::conflict(
                "queue_full",
                "The transfer queue is full. Wait for transfers to finish.",
            )
        };
        let permit = self.tx.try_reserve().map_err(|_| full())?;
        let budget = self
            .budget
            .clone()
            .try_acquire_many_owned(data.len().try_into().map_err(|_| full())?)
            .map_err(|_| full())?;
        let mut records = self.records.lock().unwrap();
        // Unresolved outcomes are never silently pruned.
        if records.iter().filter(|r| !r.state.finished()).count() >= 128 {
            return Err(full());
        }
        let record = JobRecord {
            id: format!("{:032x}", rand::random::<u128>()),
            filename,
            ip,
            state: JobState::Queued,
            sent_bytes: 0,
            total_bytes: data.len() as u64,
            stored_as: None,
            error_code: None,
            error: None,
            created_at_ms: now_ms(),
            finished_at_ms: None,
            manufacturer: expected.as_ref().map(|e| e.0.clone()),
            serial: expected.map(|e| e.1),
        };
        let mut next = records.clone();
        next.push(record.clone());
        self.persist(&next)
            .map_err(|e| ApiError::internal(e.to_string()))?;
        *records = next;
        permit.send(QueuedUpload {
            id: record.id.clone(),
            data,
            overwrite,
            _budget: budget,
        });
        Ok(record)
    }
    pub fn get(&self, id: &str) -> Option<JobRecord> {
        self.records
            .lock()
            .unwrap()
            .iter()
            .find(|r| r.id == id)
            .cloned()
    }
    pub fn list(&self) -> Vec<JobRecord> {
        self.records.lock().unwrap().iter().rev().cloned().collect()
    }
    pub fn pending_count(&self) -> usize {
        self.records
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.state.pending())
            .count()
    }
    pub fn cancel(&self, id: &str) -> Result<JobRecord, ApiError> {
        self.change(id, |r| {
            if !matches!(r.state, JobState::Queued | JobState::Waiting) {
                return Err(ApiError::conflict(
                    "not_cancellable",
                    "Only queued or waiting transfers can be cancelled.",
                ));
            }
            r.state = JobState::Cancelled;
            r.finished_at_ms = Some(now_ms());
            Ok(())
        })
    }
    pub fn resolve(&self, id: &str, delivered: bool) -> Result<JobRecord, ApiError> {
        self.change(id, |r| {
            if r.state != JobState::NeedsReconciliation {
                return Err(ApiError::conflict(
                    "not_uncertain",
                    "This transfer does not need confirmation.",
                ));
            }
            r.state = if delivered {
                JobState::Done
            } else {
                JobState::Failed
            };
            r.error_code = Some("user_confirmed".into());
            r.error = Some(
                if delivered {
                    "Delivery confirmed by user"
                } else {
                    "User checked the device; file was not delivered"
                }
                .into(),
            );
            r.finished_at_ms = Some(now_ms());
            Ok(())
        })
    }
    pub fn start_worker(state: Arc<AppState>) {
        let mut rx = state.jobs.rx.lock().unwrap().take().expect("one worker");
        tokio::spawn(async move {
            while let Some(job) = rx.recv().await {
                if let Err(e) = run_upload(&state, &job).await {
                    if state
                        .jobs
                        .get(&job.id)
                        .is_some_and(|r| r.state == JobState::Cancelled)
                    {
                        continue;
                    }
                    let result = state.jobs.change(&job.id, |r| {
                        r.state = if e.code == "delivery_unknown" {
                            JobState::NeedsReconciliation
                        } else {
                            JobState::Failed
                        };
                        r.error_code = Some(e.code.into());
                        r.error = Some(e.message.clone());
                        r.finished_at_ms = Some(now_ms());
                        Ok(())
                    });
                    if result.is_err() {
                        // Fail closed in memory too; the durable Uploading marker protects restart.
                        if let Some(r) = state
                            .jobs
                            .records
                            .lock()
                            .unwrap()
                            .iter_mut()
                            .find(|r| r.id == job.id)
                        {
                            if r.state == JobState::Uploading {
                                r.state = JobState::NeedsReconciliation;
                                r.error =
                                    Some("Could not save the outcome. Check the device.".into());
                            }
                        }
                        state.logs.error("Could not persist transfer outcome; restart will require checking the device.");
                    }
                    state
                        .logs
                        .error(format!("Transfer {}: {}", job.id, e.message));
                }
            }
        });
    }
}
async fn run_upload(state: &Arc<AppState>, job: &QueuedUpload) -> Result<(), ApiError> {
    let _lifecycle = state.lifecycle.read().await;
    let started = std::time::Instant::now();
    loop {
        let Some(record) = state.jobs.get(&job.id) else {
            return Ok(());
        };
        if record.state == JobState::Cancelled {
            return Ok(());
        }
        let _operation = state.operation.lock().await;
        let expected = record.manufacturer.as_deref().zip(record.serial.as_deref());
        let (machine, info) = identity::resolve(state, record.ip, expected).await?;
        let blocked = state.jobs.list().iter().any(|r| {
            r.state == JobState::NeedsReconciliation
                && ((r.serial.is_some()
                    && r.serial == info.identity.serial
                    && r.manufacturer.as_deref() == Some(&info.identity.manufacturer))
                    || r.ip == info.identity.ip)
        });
        if blocked {
            return Err(ApiError::conflict(
                "previous_delivery_unknown",
                "Check and resolve the earlier uncertain transfer on this device first.",
            ));
        }
        // Explicit busy means the dongle accepted no write. Reads can be busy too.
        if info.capabilities.overwrites_by_name && !job.overwrite {
            match machine.storage().await {
                Ok(storage)
                    if storage
                        .files
                        .iter()
                        .any(|f| f.eq_ignore_ascii_case(&record.filename)) =>
                {
                    return Err(MachineError::FileExists.into())
                }
                Ok(_) => {}
                Err(MachineError::Busy) if started.elapsed().as_secs() < 60 => {
                    state.jobs.change(&job.id, |r| {
                        if r.state != JobState::Cancelled {
                            r.state = JobState::Waiting;
                        }
                        Ok(())
                    })?;
                    drop(_operation);
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                }
                Err(e) => return Err(e.into()),
            }
        }
        // Cancellation and the durable 'uploading' marker are committed under one lock.
        state.jobs.change(&job.id, |r| {
            if r.state == JobState::Cancelled {
                return Err(ApiError::conflict("cancelled", "Transfer cancelled"));
            }
            r.state = JobState::Uploading;
            r.ip = info.identity.ip;
            r.serial = info.identity.serial.clone();
            r.manufacturer = Some(info.identity.manufacturer.clone());
            Ok(())
        })?;
        let progress = {
            let state = state.clone();
            let id = job.id.clone();
            Arc::new(move |p: UploadProgress| {
                if let Some(r) = state
                    .jobs
                    .records
                    .lock()
                    .unwrap()
                    .iter_mut()
                    .find(|r| r.id == id)
                {
                    r.sent_bytes = p.sent_bytes;
                }
            }) as crate::machine::ProgressFn
        };
        match machine
            .upload(
                UploadRequest {
                    filename: record.filename.clone(),
                    data: job.data.clone(),
                },
                progress,
            )
            .await
        {
            Ok(receipt) => {
                state
                    .jobs
                    .change(&job.id, |r| {
                        r.state = JobState::Done;
                        r.sent_bytes = receipt.bytes_sent;
                        r.stored_as = receipt.stored_as;
                        r.finished_at_ms = Some(now_ms());
                        Ok(())
                    })
                    .map_err(|_| ApiError::from(MachineError::DeliveryUnknown))?;
                state
                    .logs
                    .info(format!("Sent {} to {}", record.filename, info.identity.ip));
                return Ok(());
            }
            Err(MachineError::Busy) if started.elapsed().as_secs() < 60 => {
                state.jobs.change(&job.id, |r| {
                    r.state = JobState::Waiting;
                    Ok(())
                })?;
                drop(_operation);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
}
fn prune_finished(records: &mut Vec<JobRecord>) {
    let mut excess = records
        .iter()
        .filter(|r| r.state.finished())
        .count()
        .saturating_sub(100);
    records.retain(|r| {
        if excess > 0 && r.state.finished() {
            excess -= 1;
            false
        } else {
            true
        }
    });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let p = std::env::temp_dir().join(format!("bridge-queue-{:x}", rand::random::<u128>()));
        std::fs::create_dir(&p).unwrap();
        p
    }
    fn enqueue(q: &JobQueue) -> JobRecord {
        q.enqueue(
            "192.168.1.4".parse().unwrap(),
            "design.pes".into(),
            bytes::Bytes::from_static(b"design bytes"),
            Some(("emberconnect".into(), "serial-a".into())),
            false,
        )
        .unwrap()
    }
    #[test]
    fn restart_preserves_outcomes_without_replaying_payloads() {
        let dir = directory();
        let q = JobQueue::load(&dir).unwrap();
        let queued = enqueue(&q);
        let uploading = enqueue(&q);
        let done = enqueue(&q);
        q.change(&uploading.id, |r| {
            r.state = JobState::Uploading;
            Ok(())
        })
        .unwrap();
        q.change(&done.id, |r| {
            r.state = JobState::Done;
            Ok(())
        })
        .unwrap();
        drop(q);
        let q = JobQueue::load(&dir).unwrap();
        assert_eq!(q.get(&queued.id).unwrap().state, JobState::Failed);
        assert_eq!(
            q.get(&uploading.id).unwrap().state,
            JobState::NeedsReconciliation
        );
        assert_eq!(q.get(&done.id).unwrap().state, JobState::Done);
        assert_eq!(q.pending_count(), 0);
        assert!(!std::fs::read_to_string(dir.join("transfer-history.json"))
            .unwrap()
            .contains("design bytes"));
        q.resolve(&uploading.id, true).unwrap();
        assert_eq!(
            JobQueue::load(&dir)
                .unwrap()
                .get(&uploading.id)
                .unwrap()
                .state,
            JobState::Done
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn bounded_queue_and_cancellation_are_durable() {
        let dir = directory();
        let q = JobQueue::load(&dir).unwrap();
        let first = enqueue(&q);
        q.cancel(&first.id).unwrap();
        for _ in 1..32 {
            enqueue(&q);
        }
        assert_eq!(
            q.enqueue(
                first.ip,
                "extra.pes".into(),
                bytes::Bytes::from_static(b"x"),
                None,
                false
            )
            .unwrap_err()
            .code,
            "queue_full"
        );
        assert_eq!(
            JobQueue::load(&dir).unwrap().get(&first.id).unwrap().state,
            JobState::Cancelled
        );
        let second = q.list()[0].clone();
        q.change(&second.id, |r| {
            r.state = JobState::Uploading;
            Ok(())
        })
        .unwrap();
        assert_eq!(q.cancel(&second.id).unwrap_err().code, "not_cancellable");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn byte_budget_and_disk_errors_prevent_admission() {
        let dir = directory();
        let q = JobQueue::load(&dir).unwrap();
        let body = bytes::Bytes::from(vec![0; 32 * 1024 * 1024]);
        for _ in 0..4 {
            q.enqueue(
                "192.168.1.4".parse().unwrap(),
                "big.pes".into(),
                body.clone(),
                None,
                false,
            )
            .unwrap();
        }
        assert_eq!(
            q.enqueue(
                "192.168.1.4".parse().unwrap(),
                "tiny.pes".into(),
                bytes::Bytes::from_static(b"x"),
                None,
                false
            )
            .unwrap_err()
            .code,
            "queue_full"
        );
        std::fs::remove_dir_all(dir).unwrap();
        let dir = directory();
        let q = JobQueue::load(&dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
        assert!(q
            .enqueue(
                "192.168.1.4".parse().unwrap(),
                "x.pes".into(),
                body,
                None,
                false
            )
            .is_err());
        assert!(q.list().is_empty());
    }
}

#[cfg(test)]
mod worker_tests {
    use super::*;
    use crate::server::test_support::setup;
    use std::sync::atomic::Ordering;
    async fn queued(
        state: &Arc<AppState>,
        filename: &str,
        overwrite: bool,
    ) -> (JobRecord, QueuedUpload) {
        let record = state
            .jobs
            .enqueue(
                "192.168.1.4".parse().unwrap(),
                filename.into(),
                bytes::Bytes::from_static(b"design"),
                Some(("test".into(), "intended".into())),
                overwrite,
            )
            .unwrap();
        let job = state
            .jobs
            .rx
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .try_recv()
            .unwrap();
        (record, job)
    }
    #[tokio::test]
    async fn busy_retries_but_uncertain_delivery_does_not() {
        let (state, sim, dir) = setup().await;
        sim.busy.store(1, Ordering::SeqCst);
        let (record, job) = queued(&state, "new.pes", false).await;
        run_upload(&state, &job).await.unwrap();
        assert_eq!(state.jobs.get(&record.id).unwrap().state, JobState::Done);
        assert_eq!(sim.calls.load(Ordering::SeqCst), 2);
        sim.uncertain.store(true, Ordering::SeqCst);
        let (record, job) = queued(&state, "uncertain.pes", false).await;
        assert_eq!(
            run_upload(&state, &job).await.unwrap_err().code,
            "delivery_unknown"
        );
        assert_eq!(sim.calls.load(Ordering::SeqCst), 3);
        state
            .jobs
            .change(&record.id, |r| {
                r.state = JobState::NeedsReconciliation;
                Ok(())
            })
            .unwrap();
        let (_, next) = queued(&state, "another.pes", false).await;
        assert_eq!(
            run_upload(&state, &next).await.unwrap_err().code,
            "previous_delivery_unknown"
        );
        assert_eq!(sim.calls.load(Ordering::SeqCst), 3);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn cancelled_and_unconfirmed_replacements_never_upload() {
        let (state, sim, dir) = setup().await;
        let (record, job) = queued(&state, "new.pes", false).await;
        state.jobs.cancel(&record.id).unwrap();
        run_upload(&state, &job).await.unwrap();
        let (_, job) = queued(&state, "EXISTING.pes", false).await;
        assert_eq!(
            run_upload(&state, &job).await.unwrap_err().code,
            "file_exists"
        );
        assert_eq!(sim.calls.load(Ordering::SeqCst), 0);
        let (_, job) = queued(&state, "existing.pes", true).await;
        run_upload(&state, &job).await.unwrap();
        assert_eq!(sim.calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn retention_keeps_uncertain_outcomes_and_skips_pruned_cancelled_payloads() {
        let (state, sim, dir) = setup().await;
        let (cancelled, payload) = queued(&state, "cancelled.pes", false).await;
        state.jobs.cancel(&cancelled.id).unwrap();
        let (uncertain, _) = queued(&state, "unknown.pes", false).await;
        state
            .jobs
            .change(&uncertain.id, |r| {
                r.state = JobState::NeedsReconciliation;
                Ok(())
            })
            .unwrap();
        for _ in 0..105 {
            let (record, _) = queued(&state, "finished.pes", false).await;
            state
                .jobs
                .change(&record.id, |r| {
                    r.state = JobState::Done;
                    Ok(())
                })
                .unwrap();
        }
        assert_eq!(state.jobs.list().len(), 101);
        assert!(state.jobs.get(&cancelled.id).is_none());
        assert_eq!(
            state.jobs.get(&uncertain.id).unwrap().state,
            JobState::NeedsReconciliation
        );
        run_upload(&state, &payload).await.unwrap();
        assert_eq!(sim.calls.load(Ordering::SeqCst), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn queued_identity_cannot_be_replaced_before_upload() {
        let (state, sim, dir) = setup().await;
        let (_, job) = queued(&state, "new.pes", false).await;
        sim.devices.lock().unwrap()[0].1 = "different".into();
        assert_eq!(
            run_upload(&state, &job).await.unwrap_err().code,
            "identity_changed"
        );
        assert_eq!(sim.calls.load(Ordering::SeqCst), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
