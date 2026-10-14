use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportJobStatus {
    pub id: String,
    pub state: JobState,
    pub progress: f64,
    pub message: String,
    pub output_path: Option<String>,
}

#[derive(Default)]
pub struct ExportJobStore {
    pub inner: Mutex<Option<ActiveJob>>,
}

pub struct ActiveJob {
    pub id: String,
    pub state: JobState,
    pub progress: f64,
    pub message: String,
    pub output_path: Option<String>,
    pub temp_path: Option<String>,
    pub child_id: Option<u32>,
}

impl ExportJobStore {
    pub fn snapshot(&self) -> Option<ExportJobStatus> {
        let guard = self.inner.lock().ok()?;
        let job = guard.as_ref()?;
        Some(ExportJobStatus {
            id: job.id.clone(),
            state: job.state.clone(),
            progress: job.progress,
            message: job.message.clone(),
            output_path: job.output_path.clone(),
        })
    }
}

pub fn new_job_id() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("export-{ms}")
}

pub type SharedJobs = Arc<ExportJobStore>;
