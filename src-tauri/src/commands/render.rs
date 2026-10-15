use crate::render::ffmpeg::{
    build_export_command, parse_progress_time, spawn_ffmpeg, validate_output_with_ffprobe,
    RenderPlan,
};
use crate::render::job::{new_job_id, ExportJobStatus, JobState, SharedJobs};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn start_export(
    app: AppHandle,
    plan: RenderPlan,
    output_path: String,
) -> Result<ExportJobStatus, String> {
    let jobs = app.state::<SharedJobs>();
    {
        let guard = jobs
            .inner
            .lock()
            .map_err(|_| "Export job lock poisoned".to_string())?;
        if let Some(active) = guard.as_ref() {
            if matches!(active.state, JobState::Queued | JobState::Running) {
                return Err("An export is already running".into());
            }
        }
    }

    let output = PathBuf::from(&output_path);
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("Cannot create output folder: {e}"))?;
        }
    }

    let built = build_export_command(&plan, &output)?;
    let job_id = new_job_id();
    let duration = plan.duration_sec.max(0.1);

    {
        let mut guard = jobs
            .inner
            .lock()
            .map_err(|_| "Export job lock poisoned".to_string())?;
        *guard = Some(crate::render::job::ActiveJob {
            id: job_id.clone(),
            state: JobState::Running,
            progress: 0.0,
            message: "Starting FFmpeg…".into(),
            output_path: Some(output_path.clone()),
            temp_path: Some(built.temp_output.to_string_lossy().to_string()),
            child_id: None,
        });
    }

    let jobs_thread = Arc::clone(&jobs);
    let program = built.program.clone();
    let args = built.args.clone();
    let temp = built.temp_output.clone();
    let final_path = output.clone();

    thread::spawn(move || {
        let mut child = match spawn_ffmpeg(&program, &args) {
            Ok(child) => child,
            Err(err) => {
                set_job_failed(&jobs_thread, &err);
                return;
            }
        };

        if let Ok(mut guard) = jobs_thread.inner.lock() {
            if let Some(job) = guard.as_mut() {
                job.child_id = Some(child.id());
                job.message = "Encoding…".into();
            }
        }

        let stderr = child.stderr.take();

        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                if let Some(time) = parse_progress_time(&line) {
                    let progress = (time / duration).clamp(0.0, 0.99);
                    if let Ok(mut guard) = jobs_thread.inner.lock() {
                        if let Some(job) = guard.as_mut() {
                            if job.state == JobState::Cancelled {
                                break;
                            }
                            job.progress = progress;
                            job.message = format!("Encoding… {:.0}%", progress * 100.0);
                        }
                    }
                }
            }
        }

        let status = child.wait();
        match status {
            Ok(code) if code.success() => {
                if let Err(err) = fs::rename(&temp, &final_path) {
                    let _ = fs::copy(&temp, &final_path);
                    let _ = fs::remove_file(&temp);
                    if !final_path.is_file() {
                        set_job_failed(&jobs_thread, &format!("Failed to finalize output: {err}"));
                        return;
                    }
                }
                let probe_note = match validate_output_with_ffprobe(&final_path) {
                    Ok(_) => " · ffprobe ok".to_string(),
                    Err(err) => format!(" · ffprobe warn: {err}"),
                };
                if let Ok(mut guard) = jobs_thread.inner.lock() {
                    if let Some(job) = guard.as_mut() {
                        if job.state != JobState::Cancelled {
                            job.state = JobState::Succeeded;
                            job.progress = 1.0;
                            job.message = format!("Export complete{probe_note}");
                            job.temp_path = None;
                        }
                    }
                }
            }
            Ok(code) => {
                let _ = fs::remove_file(&temp);
                set_job_failed(
                    &jobs_thread,
                    &format!("FFmpeg exited with status {code}"),
                );
            }
            Err(err) => {
                let _ = fs::remove_file(&temp);
                set_job_failed(&jobs_thread, &format!("FFmpeg wait failed: {err}"));
            }
        }
    });

    Ok(ExportJobStatus {
        id: job_id,
        state: JobState::Running,
        progress: 0.0,
        message: "Starting FFmpeg…".into(),
        output_path: Some(output_path),
    })
}

#[tauri::command]
pub fn get_export_status(jobs: State<'_, SharedJobs>) -> Result<Option<ExportJobStatus>, String> {
    Ok(jobs.snapshot())
}

#[tauri::command]
pub fn cancel_export(jobs: State<'_, SharedJobs>) -> Result<ExportJobStatus, String> {
    let mut guard = jobs
        .inner
        .lock()
        .map_err(|_| "Export job lock poisoned".to_string())?;
    let job = guard.as_mut().ok_or_else(|| "No active export".to_string())?;
    job.state = JobState::Cancelled;
    job.message = "Cancelling…".into();
    if let Some(pid) = job.child_id {
        // Best-effort terminate on Windows
        let _ = crate::toolchain::silent_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    if let Some(temp) = &job.temp_path {
        let _ = fs::remove_file(temp);
    }
    job.progress = 0.0;
    job.message = "Export cancelled".into();
    Ok(ExportJobStatus {
        id: job.id.clone(),
        state: job.state.clone(),
        progress: job.progress,
        message: job.message.clone(),
        output_path: job.output_path.clone(),
    })
}

fn set_job_failed(jobs: &SharedJobs, message: &str) {
    if let Ok(mut guard) = jobs.inner.lock() {
        if let Some(job) = guard.as_mut() {
            job.state = JobState::Failed;
            job.message = message.to_string();
            if let Some(temp) = &job.temp_path {
                let _ = fs::remove_file(temp);
            }
        }
    }
}
