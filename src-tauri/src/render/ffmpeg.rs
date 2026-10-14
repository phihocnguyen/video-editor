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
    #[serde(default)]
    pub effects: RenderClipEffects,
    #[serde(default)]
    pub transition_in: RenderClipTransition,
    #[serde(default)]
    pub transition_overlap_sec: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipTransition {
    #[serde(default = "default_none", rename = "type")]
    pub kind: String,
    #[serde(default = "default_half_sec_ticks")]
    pub duration_ticks: i64,
}

impl Default for RenderClipTransition {
    fn default() -> Self {
        Self {
            kind: "none".into(),
            duration_ticks: 500_000,
        }
    }
}

fn default_none() -> String {
    "none".into()
}
fn default_half_sec_ticks() -> i64 {
    500_000
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipEffects {
    #[serde(default = "default_one")]
    pub brightness: f64,
    #[serde(default = "default_one")]
    pub contrast: f64,
    #[serde(default = "default_one")]
    pub saturation: f64,
    #[serde(default)]
    pub blur: f64,
    #[serde(default)]
    pub grayscale: bool,
    #[serde(default)]
    pub fade_in_sec: f64,
    #[serde(default)]
    pub fade_out_sec: f64,
}

fn default_one() -> f64 {
    1.0
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
        let overlap = clip.transition_overlap_sec.max(0.0);
        let source_dur = (clip.source_out_sec - clip.source_in_sec).max(0.01);
        if clip.kind == "image" {
            let clip_dur =
                (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01) + overlap;
            args.extend([
                "-loop".into(),
                "1".into(),
                "-t".into(),
                format!("{clip_dur:.3}"),
                "-i".into(),
                clip.asset_path.clone(),
            ]);
        } else {
            let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
            let early_source = overlap * speed;
            let ss = (clip.source_in_sec - early_source).max(0.0);
            let trimmed_early = clip.source_in_sec - ss;
            args.extend([
                "-ss".into(),
                format!("{ss:.3}"),
                "-t".into(),
                format!("{:.3}", source_dur + trimmed_early),
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
    // lavfi color is YUV — rgba + overlay format=rgb keeps dissolve alpha.
    parts.push("[0:v]format=rgba[base]".into());
    let mut current = "[base]".to_string();

    for (index, clip) in visuals.iter().enumerate() {
        let input_index = index + 1;
        let start = clip.timeline_start_sec.max(0.0);
        let end = clip.timeline_end_sec.max(start + 0.01);
        let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
        let opacity = clip.opacity.clamp(0.0, 1.0);
        let overlap = clip.transition_overlap_sec.max(0.0);
        let overlay_start = (start - overlap).max(0.0);
        let setpts = if (speed - 1.0).abs() < 0.001 {
            "setpts=PTS-STARTPTS".to_string()
        } else {
            format!("setpts=(PTS-STARTPTS)/{speed}")
        };
        let clip_dur = (end - start).max(0.01);
        let next_sibling = visuals.iter().enumerate().find_map(|(j, c)| {
            if j > index && c.track_id == clip.track_id {
                Some(*c)
            } else {
                None
            }
        });
        let out_half = next_sibling
            .filter(|c| c.transition_in.kind != "none")
            .map(|c| c.transition_overlap_sec.max(0.0))
            .unwrap_or(0.0);
        let out_full = next_sibling
            .filter(|c| c.transition_in.kind != "none")
            .map(|c| (c.transition_in.duration_ticks as f64 / 1_000_000.0).max(0.1))
            .unwrap_or(0.0);
        let in_full = if overlap > 0.001 && clip.transition_in.kind != "none" {
            (clip.transition_in.duration_ticks as f64 / 1_000_000.0).max(0.1)
        } else {
            0.0
        };
        let hold = out_half;
        let fx = ffmpeg_video_effects_chain(&clip.effects, clip_dur, overlap);
        let mut extras: Vec<String> = Vec::new();
        if !fx.is_empty() {
            extras.push(fx);
        }
        let tin = clip.transition_in.kind.as_str();
        if in_full > 0.001 {
            if tin == "fade" {
                extras.push(ffmpeg_smooth_fade_in_alpha(in_full / 2.0, in_full / 2.0));
            } else {
                extras.push(ffmpeg_smooth_fade_in_alpha(in_full, 0.0));
            }
            if tin == "wipeLeft" || tin == "wipeRight" {
                extras.push(ffmpeg_wipe_reveal(tin, in_full, width, height));
            }
        }
        if hold > 0.001 {
            let cut_at = overlap + clip_dur;
            extras.push(format!("tpad=stop_mode=clone:stop_duration={hold:.3}"));
            let next_type = next_sibling.map(|c| c.transition_in.kind.as_str()).unwrap_or("none");
            if next_type == "fade" {
                extras.push(ffmpeg_smooth_fade_out_alpha(
                    (cut_at - out_half).max(0.0),
                    out_full / 2.0,
                ));
            } else {
                extras.push(ffmpeg_smooth_fade_out_alpha(
                    (cut_at - out_half).max(0.0),
                    out_full,
                ));
            }
        }
        let extra_part = if extras.is_empty() {
            String::new()
        } else {
            format!(",{}", extras.join(","))
        };
        parts.push(format!(
            "[{input_index}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,{setpts},format=rgba{extra_part},colorchannelmixer=aa={opacity:.3}[v{index}]"
        ));
        let overlay_end = end + hold;
        let next = format!("[tmp{index}]");
        parts.push(format!(
            "{current}[v{index}]overlay=x=0:y=0:format=rgb:eof_action=pass:enable='between(t\\,{overlay_start:.3}\\,{overlay_end:.3})'{next}"
        ));
        current = next;
    }

    for (ti, text) in plan.texts.iter().enumerate() {
        let start = text.timeline_start_sec.max(0.0);
        let end = text.timeline_end_sec.max(start + 0.01);
        let escaped = escape_drawtext(&text.content);
        let fontfile = resolve_drawtext_font(text.font_path.as_deref())
            .map(|p| format!(":fontfile={}", quote_filter_path(&p)))
            .unwrap_or_default();
        let fontsize = text.font_size.max(8.0).round();
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

fn geq_rgb_alpha(alpha_expr: &str) -> String {
    // Commas in r(X,Y) must be escaped or filter_complex splits the graph.
    format!("geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='{alpha_expr}'")
}

fn clamped_progress(start_sec: f64, duration_sec: f64) -> String {
    format!(
        "min(1\\,max(0\\,((T)-{start_sec:.3})/{duration_sec:.3}))"
    )
}

fn eased01(p_expr: &str) -> String {
    format!("({p_expr})*({p_expr})*(3-2*({p_expr}))")
}

fn ffmpeg_smooth_fade_in_alpha(duration_sec: f64, start_sec: f64) -> String {
    let d = duration_sec.max(0.05);
    let st = start_sec.max(0.0);
    let en = st + d;
    let p = clamped_progress(st, d);
    let ease = eased01(&p);
    geq_rgb_alpha(&format!(
        "if(lt(T\\,{st:.3})\\,0\\,if(gte(T\\,{en:.3})\\,255\\,255*{ease}))"
    ))
}

fn ffmpeg_smooth_fade_out_alpha(start_sec: f64, duration_sec: f64) -> String {
    let d = duration_sec.max(0.05);
    let st = start_sec.max(0.0);
    let en = st + d;
    let p = clamped_progress(st, d);
    let ease = eased01(&p);
    geq_rgb_alpha(&format!(
        "if(lt(T\\,{st:.3})\\,255\\,if(gte(T\\,{en:.3})\\,0\\,255*(1-{ease})))"
    ))
}

fn ffmpeg_wipe_reveal(kind: &str, duration_sec: f64, width: u32, height: u32) -> String {
    let d = duration_sec.max(0.05);
    let p = eased01(&clamped_progress(0.0, d));
    let w = width.max(2);
    let h = height.max(2);
    if kind == "wipeLeft" {
        format!(
            "crop=w='max(2\\,{w}*{p})':h={h}:x='{w}-out_w':y=0,pad={w}:{h}:({w}-ow):0:black@0"
        )
    } else {
        format!("crop=w='max(2\\,{w}*{p})':h={h}:x=0:y=0,pad={w}:{h}:0:0:black@0")
    }
}

fn ffmpeg_video_effects_chain(
    effects: &RenderClipEffects,
    clip_duration_sec: f64,
    delay_sec: f64,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let delay = delay_sec.max(0.0);
    let eq_bright = (effects.brightness - 1.0).clamp(-1.0, 1.0);
    let need_eq = eq_bright.abs() > 0.001
        || (effects.contrast - 1.0).abs() > 0.001
        || (effects.saturation - 1.0).abs() > 0.001;
    if need_eq {
        parts.push(format!(
            "eq=brightness={:.3}:contrast={:.3}:saturation={:.3}",
            eq_bright, effects.contrast, effects.saturation
        ));
    }
    if effects.blur > 0.05 {
        parts.push(format!("gblur=sigma={:.2}", effects.blur.min(40.0)));
    }
    if effects.grayscale {
        parts.push("hue=s=0".into());
    }
    let dur = clip_duration_sec.max(0.01);
    let fade_in = effects.fade_in_sec.min(dur);
    if fade_in > 0.001 {
        parts.push(format!("fade=t=in:st={delay:.3}:d={fade_in:.3}:alpha=1"));
    }
    let fade_out = effects.fade_out_sec.min(dur);
    if fade_out > 0.001 {
        let st = delay + (dur - fade_out).max(0.0);
        parts.push(format!("fade=t=out:st={st:.3}:d={fade_out:.3}:alpha=1"));
    }
    parts.join(",")
}

fn resolve_drawtext_font(font_path: Option<&str>) -> Option<String> {
    if let Some(path) = font_path {
        if Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    const FALLBACKS: &[&str] = &[
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    FALLBACKS
        .iter()
        .find(|p| Path::new(p).is_file())
        .map(|p| (*p).to_string())
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

fn quote_filter_path(path: &str) -> String {
    format!("'{}'", escape_filter_path(path).replace('\'', "\\'"))
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
