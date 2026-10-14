use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipPlan {
    pub clip_id: String,
    pub track_id: String,
    pub asset_path: String,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    pub source_in_sec: f64,
    pub source_out_sec: f64,
    pub volume: f64,
    pub kind: String,
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
    pub clips: Vec<RenderClipPlan>,
    pub texts: Vec<RenderTextPlan>,
    pub missing_asset_ids: Vec<String>,
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

    let visuals: Vec<&RenderClipPlan> = plan
        .clips
        .iter()
        .filter(|c| c.kind == "video" || c.kind == "image")
        .collect();
    let audios: Vec<&RenderClipPlan> = plan
        .clips
        .iter()
        .filter(|c| c.kind == "audio" || c.kind == "video")
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

    // Input 0: black canvas
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c=black:s={width}x{height}:d={duration}:r={fps}"),
    ]);

    // Visual inputs 1..V
    for clip in &visuals {
        let clip_dur = (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01);
        if clip.kind == "image" {
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
                format!("{clip_dur:.3}"),
                "-i".into(),
                clip.asset_path.clone(),
            ]);
        }
    }

    // Dedicated audio-only inputs after visuals (video audio reused from visual inputs)
    let mut audio_only_offset = 1 + visuals.len();
    let mut audio_only_inputs: Vec<(usize, &RenderClipPlan)> = Vec::new();
    for clip in &audios {
        if clip.kind != "audio" {
            continue;
        }
        let clip_dur = (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01);
        args.extend([
            "-ss".into(),
            format!("{:.3}", clip.source_in_sec.max(0.0)),
            "-t".into(),
            format!("{clip_dur:.3}"),
            "-i".into(),
            clip.asset_path.clone(),
        ]);
        audio_only_inputs.push((audio_only_offset, *clip));
        audio_only_offset += 1;
    }

    let filter = build_filter_complex(plan, &visuals, &audio_only_inputs, width, height)?;
    args.extend(["-filter_complex".into(), filter, "-map".into(), "[outv]".into()]);

    if !audios.is_empty() {
        args.extend([
            "-map".into(),
            "[outa]".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    } else {
        args.push("-an".into());
    }

    args.extend([
        "-c:v".into(),
        "libx264".into(),
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
        parts.push(format!(
            "[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v{index}]"
        ));
        let next = format!("[tmp{index}]");
        parts.push(format!(
            "{current}[v{index}]overlay=0:0:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
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
        let x_expr = match text.align.as_str() {
            "left" => format!("{}", text.x.max(0.0) as i64),
            "right" => format!("{}-text_w", text.x.max(0.0) as i64),
            _ => format!("{}-(text_w/2)", text.x.max(0.0) as i64),
        };
        let y_expr = format!("{}-(text_h/2)", text.y.max(0.0) as i64);
        let next = format!("[txt{ti}]");
        parts.push(format!(
            "{current}drawtext=text='{escaped}'{fontfile}:fontsize={fontsize}:fontcolor={color}:x={x_expr}:y={y_expr}:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
        ));
        current = next;
    }

    if current != "[outv]" {
        parts.push(format!("{current}null[outv]"));
    }

    // Audio mix from video visual inputs + dedicated audio inputs
    let mut audio_labels: Vec<String> = Vec::new();
    let mut ai = 0usize;

    for (index, clip) in visuals.iter().enumerate() {
        if clip.kind != "video" {
            continue;
        }
        let input_index = index + 1;
        let start_ms = (clip.timeline_start_sec.max(0.0) * 1000.0).round() as i64;
        let vol = clip.volume.clamp(0.0, 2.0);
        let label = format!("[a{ai}]");
        // adelay pads start; apad+atrim keeps timeline length stable for amix
        parts.push(format!(
            "[{input_index}:a]asetpts=PTS-STARTPTS,volume={vol},adelay={start_ms}|{start_ms},apad,atrim=0:{:.3}{label}",
            plan.duration_sec
        ));
        audio_labels.push(label);
        ai += 1;
    }

    for (input_index, clip) in audio_only {
        let start_ms = (clip.timeline_start_sec.max(0.0) * 1000.0).round() as i64;
        let vol = clip.volume.clamp(0.0, 2.0);
        let label = format!("[a{ai}]");
        parts.push(format!(
            "[{input_index}:a]asetpts=PTS-STARTPTS,volume={vol},adelay={start_ms}|{start_ms},apad,atrim=0:{:.3}{label}",
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
