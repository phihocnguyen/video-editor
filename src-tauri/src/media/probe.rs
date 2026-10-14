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
    pub kind_hint: String,
}

pub fn guess_media_kind(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp3" | "wav" | "aac" | "m4a" | "flac" | "ogg" => "audio",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" => "image",
        _ => "video",
    }
}

/// Probes a media file with ffprobe when available.
/// Uses an explicit argument array — never a shell command string.
pub fn probe_path(path: &str) -> Result<ProbeResult, String> {
    let file = Path::new(path);
    let kind_hint = guess_media_kind(file).to_string();

    if !file.is_file() {
        return Ok(ProbeResult {
            path: path.to_string(),
            available: false,
            duration_seconds: None,
            width: None,
            height: None,
            message: "File does not exist or is not a regular file".into(),
            kind_hint,
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
                kind_hint,
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
                kind_hint,
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
            kind_hint,
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
