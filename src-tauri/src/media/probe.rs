use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub path: String,
    pub available: bool,
    pub duration_seconds: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub message: String,
}

/// Probes a media file with ffprobe when available.
/// Uses an explicit argument array — never a shell command string.
pub fn probe_path(path: &str) -> Result<ProbeResult, String> {
    let file = Path::new(path);
    if !file.is_file() {
        return Ok(ProbeResult {
            path: path.to_string(),
            available: false,
            duration_seconds: None,
            width: None,
            height: None,
            message: "File does not exist or is not a regular file".into(),
        });
    }

    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=width,height",
            "-of",
            "json",
            path,
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let (duration, width, height) = parse_ffprobe_json(&stdout);
            Ok(ProbeResult {
                path: path.to_string(),
                available: true,
                duration_seconds: duration,
                width,
                height,
                message: "Probed with ffprobe".into(),
            })
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            Ok(ProbeResult {
                path: path.to_string(),
                available: true,
                duration_seconds: None,
                width: None,
                height: None,
                message: format!("ffprobe failed: {stderr}"),
            })
        }
        Err(err) => Ok(ProbeResult {
            path: path.to_string(),
            available: true,
            duration_seconds: None,
            width: None,
            height: None,
            message: format!(
                "ffprobe not available ({err}). Install FFmpeg and ensure ffprobe is on PATH."
            ),
        }),
    }
}

fn parse_ffprobe_json(json: &str) -> (Option<f64>, Option<u32>, Option<u32>) {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return (None, None, None),
    };

    let duration = value
        .pointer("/format/duration")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            value
                .pointer("/format/duration")
                .and_then(|v| v.as_f64())
        });

    let mut width = None;
    let mut height = None;
    if let Some(streams) = value.get("streams").and_then(|s| s.as_array()) {
        for stream in streams {
            if width.is_none() {
                width = stream.get("width").and_then(|v| v.as_u64()).map(|v| v as u32);
            }
            if height.is_none() {
                height = stream
                    .get("height")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32);
            }
        }
    }

    (duration, width, height)
}
