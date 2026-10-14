use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipPlan {
    pub clip_id: String,
    pub track_id: String,
    #[serde(default)]
    pub track_order: i32,
    pub asset_path: String,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    pub source_in_sec: f64,
    pub source_out_sec: f64,
    pub volume: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default = "default_true")]
    pub include_audio: bool,
    pub kind: String,
}

fn default_opacity() -> f64 {
    1.0
}
fn default_speed() -> f64 {
    1.0
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderTextPlan {
    pub clip_id: String,
    pub content: String,
    pub font_family: String,
    pub font_path: Option<String>,
    pub font_size: f64,
    pub color: String,
    pub align: String,
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlan {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub duration_sec: f64,
    #[serde(default = "default_vbitrate")]
    pub video_bitrate: String,
    #[serde(default = "default_abitrate")]
    pub audio_bitrate: String,
    pub clips: Vec<RenderClipPlan>,
    pub texts: Vec<RenderTextPlan>,
    pub missing_asset_ids: Vec<String>,
}

fn default_vbitrate() -> String {
    "6M".into()
}
fn default_abitrate() -> String {
    "192k".into()
}

pub struct BuiltCommand {
    pub program: String,
    pub args: Vec<String>,
    pub temp_output: PathBuf,
}

pub fn build_export_command(plan: &RenderPlan, output: &Path) -> Result<BuiltCommand, String> {
    if !plan.missing_asset_ids.is_empty() {
        return Err("Project has missing media; relink before export".into());
    }
    if plan.duration_sec <= 0.0 {
        return Err("Render duration must be > 0".into());
    }

    let width = plan.width.max(2) & !1;
    let height = plan.height.max(2) & !1;
    let fps = if plan.frame_rate > 0.0 {
        plan.frame_rate
    } else {
        30.0
    };
    let duration = plan.duration_sec;

    // Drop include_audio when the file has no audio stream (avoids `[n:a] matches no streams`).
    let clips: Vec<RenderClipPlan> = plan
        .clips
        .iter()
        .cloned()
        .map(|mut clip| {
            if clip.include_audio
                && (clip.kind == "video" || clip.kind == "audio")
                && !media_has_audio_stream(&clip.asset_path)
            {
                clip.include_audio = false;
            }
            clip
        })
        .collect();
    let plan_view = RenderPlan {
        clips,
        ..plan.clone()
    };

    let mut visuals: Vec<&RenderClipPlan> = plan_view
        .clips
        .iter()
        .filter(|c| c.kind == "video" || c.kind == "image")
        .collect();
    visuals.sort_by(|a, b| {
        a.track_order.cmp(&b.track_order).then(
            a.timeline_start_sec
                .partial_cmp(&b.timeline_start_sec)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });

    let audios: Vec<&RenderClipPlan> = plan_view
        .clips
        .iter()
        .filter(|c| c.include_audio && (c.kind == "audio" || c.kind == "video"))
        .collect();

    for clip in visuals.iter().chain(audios.iter()) {
        if clip.asset_path.starts_with("blob:") {
            return Err("Cannot export browser blob URLs; use desktop import paths".into());
        }
        if !Path::new(&clip.asset_path).is_file() {
            return Err(format!("Media file missing: {}", clip.asset_path));
        }
    }

    let temp_output = output.with_extension("tmp.mp4");
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into()];

    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c=black:s={width}x{height}:d={duration}:r={fps}"),
    ]);

    for clip in &visuals {
        let source_dur = (clip.source_out_sec - clip.source_in_sec).max(0.01);
        if clip.kind == "image" {
            let clip_dur = (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01);
            args.extend([
                "-loop".into(),
                "1".into(),
                "-t".into(),
                format!("{clip_dur:.3}"),
                "-i".into(),
                clip.asset_path.clone(),
            ]);
        } else {
            args.extend([
                "-ss".into(),
                format!("{:.3}", clip.source_in_sec.max(0.0)),
                "-t".into(),
                format!("{source_dur:.3}"),
                "-i".into(),
                clip.asset_path.clone(),
            ]);
        }
    }

    let mut audio_only_offset = 1 + visuals.len();
    let mut audio_only_inputs: Vec<(usize, &RenderClipPlan)> = Vec::new();
    for clip in &audios {
        if clip.kind != "audio" {
            continue;
        }
        let source_dur = (clip.source_out_sec - clip.source_in_sec).max(0.01);
        args.extend([
            "-ss".into(),
            format!("{:.3}", clip.source_in_sec.max(0.0)),
            "-t".into(),
            format!("{source_dur:.3}"),
            "-i".into(),
            clip.asset_path.clone(),
        ]);
        audio_only_inputs.push((audio_only_offset, *clip));
        audio_only_offset += 1;
    }

    let filter = build_filter_complex(&plan_view, &visuals, &audio_only_inputs, width, height)?;
    args.extend(["-filter_complex".into(), filter, "-map".into(), "[outv]".into()]);

    if !audios.is_empty() {
        args.extend([
            "-map".into(),
            "[outa]".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            plan_view.audio_bitrate.clone(),
        ]);
    } else {
        args.push("-an".into());
    }

    args.extend([
        "-c:v".into(),
        "libx264".into(),
        "-b:v".into(),
        plan_view.video_bitrate.clone(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        temp_output.to_string_lossy().to_string(),
    ]);

    Ok(BuiltCommand {
        program: "ffmpeg".into(),
        args,
        temp_output,
    })
}

fn build_filter_complex(
    plan: &RenderPlan,
    visuals: &[&RenderClipPlan],
    audio_only: &[(usize, &RenderClipPlan)],
    width: u32,
    height: u32,
) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current = "[0:v]".to_string();

    for (index, clip) in visuals.iter().enumerate() {
        let input_index = index + 1;
        let start = clip.timeline_start_sec.max(0.0);
        let end = clip.timeline_end_sec.max(start + 0.01);
        let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
        let opacity = clip.opacity.clamp(0.0, 1.0);
        let setpts = if (speed - 1.0).abs() < 0.001 {
            "setpts=PTS-STARTPTS".to_string()
        } else {
            format!("setpts=(PTS-STARTPTS)/{speed}")
        };
        parts.push(format!(
            "[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,{setpts},format=rgba,colorchannelmixer=aa={opacity:.3}[v{index}]"
        ));
        let next = format!("[tmp{index}]");
        parts.push(format!(
            "{current}[v{index}]overlay=0:0:format=auto:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
        ));
        current = next;
    }

    for (ti, text) in plan.texts.iter().enumerate() {
        let start = text.timeline_start_sec.max(0.0);
        let end = text.timeline_end_sec.max(start + 0.01);
        let escaped = escape_drawtext(&text.content);
        let fontfile = text
            .font_path
            .as_ref()
            .filter(|p| Path::new(p).is_file())
            .map(|p| format!(":fontfile={}", escape_filter_path(p)))
            .unwrap_or_default();
        let fontsize = text.font_size.max(8.0);
        let color = normalize_color(&text.color);
        let alpha = text.opacity.clamp(0.0, 1.0);
        let x_expr = match text.align.as_str() {
            "left" => format!("{}", text.x.max(0.0) as i64),
            "right" => format!("{}-text_w", text.x.max(0.0) as i64),
            _ => format!("{}-(text_w/2)", text.x.max(0.0) as i64),
        };
        let y_expr = format!("{}-(text_h/2)", text.y.max(0.0) as i64);
        let next = format!("[txt{ti}]");
        parts.push(format!(
            "{current}drawtext=text='{escaped}'{fontfile}:fontsize={fontsize}:fontcolor={color}@{alpha:.3}:x={x_expr}:y={y_expr}:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
        ));
        current = next;
    }

    if current != "[outv]" {
        parts.push(format!("{current}null[outv]"));
    }

    let mut audio_labels: Vec<String> = Vec::new();
    let mut ai = 0usize;

    for (index, clip) in visuals.iter().enumerate() {
        if clip.kind != "video" || !clip.include_audio {
            continue;
        }
        let input_index = index + 1;
        let start_ms = (clip.timeline_start_sec.max(0.0) * 1000.0).round() as i64;
        let vol = clip.volume.clamp(0.0, 2.0);
        let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
        let atempo = atempo_chain(speed);
        let label = format!("[a{ai}]");
        parts.push(format!(
            "[{input_index}:a]asetpts=PTS-STARTPTS,{atempo}volume={vol},adelay={start_ms}|{start_ms},apad,atrim=0:{:.3}{label}",
            plan.duration_sec
        ));
        audio_labels.push(label);
        ai += 1;
    }

    for (input_index, clip) in audio_only {
        if !clip.include_audio {
            continue;
        }
        let start_ms = (clip.timeline_start_sec.max(0.0) * 1000.0).round() as i64;
        let vol = clip.volume.clamp(0.0, 2.0);
        let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
        let atempo = atempo_chain(speed);
        let label = format!("[a{ai}]");
        parts.push(format!(
            "[{input_index}:a]asetpts=PTS-STARTPTS,{atempo}volume={vol},adelay={start_ms}|{start_ms},apad,atrim=0:{:.3}{label}",
            plan.duration_sec
        ));
        audio_labels.push(label);
        ai += 1;
    }

    if !audio_labels.is_empty() {
        if audio_labels.len() == 1 {
            parts.push(format!("{}anull[outa]", audio_labels[0]));
        } else {
            parts.push(format!(
                "{}amix=inputs={}:dropout_transition=0:normalize=0[outa]",
                audio_labels.join(""),
                audio_labels.len()
            ));
        }
    }

    Ok(parts.join(";"))
}

/// Build one or more `atempo` filters (each must be in 0.5..=2.0).
fn atempo_chain(speed: f64) -> String {
    if (speed - 1.0).abs() < 0.001 {
        return String::new();
    }
    let mut remaining = speed;
    let mut filters = Vec::new();
    while remaining > 2.0 + 1e-6 {
        filters.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 - 1e-6 {
        filters.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    filters.push(format!("atempo={remaining:.4}"));
    format!("{},", filters.join(","))
}

fn escape_drawtext(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace(':', "\\:")
        .replace('\'', "\\'")
        .replace('%', "%%")
        .replace('\n', "\\n")
}

fn escape_filter_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    normalized.replace(':', "\\:")
}

fn normalize_color(color: &str) -> String {
    let trimmed = color.trim();
    if trimmed.starts_with('#') && (trimmed.len() == 7 || trimmed.len() == 4) {
        return format!("0x{}", &trimmed[1..]);
    }
    "white".into()
}

pub fn spawn_ffmpeg(program: &str, args: &[String]) -> Result<std::process::Child, String> {
    Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start ffmpeg ({e}). Is FFmpeg on PATH?"))
}

pub fn parse_progress_time(line: &str) -> Option<f64> {
    let idx = line.find("time=")?;
    let raw = line[idx + 5..].split_whitespace().next()?;
    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

fn media_has_audio_stream(path: &str) -> bool {
    if !Path::new(path).is_file() {
        return false;
    }
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            path,
        ])
        .output();
    match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).to_ascii_lowercase().contains("audio")
        }
        _ => false,
    }
}

pub fn validate_output_with_ffprobe(path: &Path) -> Result<String, String> {
    if !path.is_file() {
        return Err("Output file missing after export".into());
    }
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name",
            "-of",
            "json",
            path.to_string_lossy().as_ref(),
        ])
        .output()
        .map_err(|e| format!("ffprobe failed ({e})"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Extract a JPEG thumbnail into `out` at `time_sec` (best-effort).
pub fn generate_thumbnail_file(path: &Path, time_sec: f64, out: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("Media file missing".into());
    }
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{:.3}", time_sec.max(0.0)),
            "-i",
            path.to_string_lossy().as_ref(),
            "-frames:v",
            "1",
            "-q:v",
            "4",
            out.to_string_lossy().as_ref(),
        ])
        .status()
        .map_err(|e| format!("ffmpeg thumbnail failed ({e})"))?;
    if !status.success() {
        return Err("ffmpeg thumbnail exited with error".into());
    }
    if !out.is_file() {
        return Err("Thumbnail was not written".into());
    }
    Ok(())
}
