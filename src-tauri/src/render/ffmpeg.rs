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

    let media: Vec<&RenderClipPlan> = plan
        .clips
        .iter()
        .filter(|c| c.kind == "video" || c.kind == "image")
        .collect();

    for clip in &media {
        if !Path::new(&clip.asset_path).is_file() {
            return Err(format!("Media file missing: {}", clip.asset_path));
        }
        if clip.asset_path.starts_with("blob:") {
            return Err("Cannot export browser blob URLs; use desktop import paths".into());
        }
    }

    let temp_output = output.with_extension("tmp.mp4");
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into()];

    // Base black canvas
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c=black:s={width}x{height}:d={duration}:r={fps}"),
    ]);

    for clip in &media {
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

    let filter = build_filter_complex(plan, &media, width, height)?;
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[outv]".into(),
        "-an".into(),
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
    media: &[&RenderClipPlan],
    width: u32,
    height: u32,
) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    let mut current = "[0:v]".to_string();

    for (index, clip) in media.iter().enumerate() {
        let input_index = index + 1;
        let start = clip.timeline_start_sec.max(0.0);
        let end = clip.timeline_end_sec.max(start + 0.01);
        let scaled = format!(
            "[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS[v{index}]"
        );
        parts.push(scaled);
        let next = format!("[tmp{index}]");
        parts.push(format!(
            "{current}[v{index}]overlay=0:0:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
        ));
        current = next;
    }

    // Apply drawtext filters chained
    for (ti, text) in plan.texts.iter().enumerate() {
        let start = text.timeline_start_sec.max(0.0);
        const EPS: f64 = 0.01;
        let end = text.timeline_end_sec.max(start + EPS);
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
    // FFmpeg filter paths on Windows often need forward slashes and escaped drive colon.
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
    // time=00:00:03.45
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
