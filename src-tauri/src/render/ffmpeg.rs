use crate::toolchain::{ffmpeg_program, ffprobe_program, silent_command};
use serde::Deserialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

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
    /// Variable-speed curve (None = constant `speed`). Mirrors the TS
    /// `SpeedRamp` ({ points: [{ id, atProgress, speed }] }).
    #[serde(default)]
    pub speed_ramp: Option<SpeedRamp>,
    #[serde(default)]
    pub transform: RenderClipTransform,
    #[serde(default = "default_canvas_dim")]
    pub canvas_width: f64,
    #[serde(default = "default_canvas_dim")]
    pub canvas_height: f64,
    #[serde(default)]
    pub media_width: Option<f64>,
    #[serde(default)]
    pub media_height: Option<f64>,
}

fn default_canvas_dim() -> f64 {
    1920.0
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipTransform {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_one")]
    pub scale_x: f64,
    #[serde(default = "default_one")]
    pub scale_y: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_one")]
    pub opacity: f64,
}

impl Default for RenderClipTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation: 0.0,
            opacity: 1.0,
        }
    }
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

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderTextAnimation {
    #[serde(default)]
    pub r#in: String,
    #[serde(default)]
    pub out: String,
    #[serde(default = "default_half")]
    pub in_duration_sec: f64,
    #[serde(default = "default_half")]
    pub out_duration_sec: f64,
}

fn default_half() -> f64 {
    0.5
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
    #[serde(default)]
    pub fade_in_sec: f64,
    #[serde(default)]
    pub fade_out_sec: f64,
    #[serde(default)]
    pub text_animation: RenderTextAnimation,
    /// Paint stacking: lower order paints above (same convention as preview
    /// layerStackZ and the TS builder). Defaults to 0 for older plans.
    #[serde(default)]
    pub track_order: i32,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlan {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    #[serde(default = "default_bg_color")]
    pub background_color: String,
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
fn default_bg_color() -> String {
    "#000000".into()
}

// ---------------- speed ramp (mirrors src/domain/speedRamp.ts) ----------------
// A ramp maps source progress s ∈ [0,1] to playback speed v(s) via a monotone
// cubic Hermite spline. Timeline duration = span · ∫₀¹ ds/v(s). Export
// discretises u → T(u) = ∫₀ᵘ dτ/v(τ) into piecewise quadratics (32 for
// video setpts, 24 for audio slices), exactly like the TS builder.

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpeedPoint {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub at_progress: f64,
    #[serde(default = "default_one")]
    pub speed: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpeedRamp {
    #[serde(default)]
    pub points: Vec<SpeedPoint>,
}

fn clamp_ramp_speed(v: f64) -> f64 {
    if !v.is_finite() {
        1.0
    } else {
        v.clamp(0.1, 8.0)
    }
}

#[derive(Clone)]
struct HermiteSegment {
    x0: f64,
    x1: f64,
    width: f64,
    a: f64,
    b: f64,
    c: f64,
    d: f64,
}

fn mono_tangents(xs: &[f64], ys: &[f64]) -> Vec<f64> {
    let n = xs.len();
    let mut slopes = Vec::with_capacity(n - 1);
    for i in 0..n - 1 {
        slopes.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    }
    let mut m = vec![0.0; n];
    m[0] = slopes[0];
    m[n - 1] = slopes[n - 2];
    for i in 1..n - 1 {
        m[i] = (slopes[i - 1] + slopes[i]) / 2.0;
    }
    for i in 0..n - 1 {
        let d = slopes[i];
        if d == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let a = m[i] / d;
        let b = m[i + 1] / d;
        let s = a * a + b * b;
        if s > 9.0 {
            let tau = 3.0 / s.sqrt();
            m[i] = tau * a * d;
            m[i + 1] = tau * b * d;
        }
    }
    m
}

fn build_hermite(points: &[(f64, f64)]) -> Vec<HermiteSegment> {
    let xs: Vec<f64> = points.iter().map(|p| p.0).collect();
    let ys: Vec<f64> = points.iter().map(|p| p.1).collect();
    let m = mono_tangents(&xs, &ys);
    let mut segments = Vec::with_capacity(points.len().saturating_sub(1));
    for i in 0..points.len() - 1 {
        let x0 = xs[i];
        let x1 = xs[i + 1];
        let width = (x1 - x0).max(1e-9);
        let h = width;
        let y0 = ys[i];
        let y1 = ys[i + 1];
        segments.push(HermiteSegment {
            x0,
            x1,
            width,
            a: 2.0 * y0 - 2.0 * y1 + h * (m[i] + m[i + 1]),
            b: -3.0 * y0 + 3.0 * y1 - h * (2.0 * m[i] + m[i + 1]),
            c: h * m[i],
            d: y0,
        });
    }
    segments
}

fn eval_hermite(seg: &HermiteSegment, t: f64) -> f64 {
    clamp_ramp_speed(((seg.a * t + seg.b) * t + seg.c) * t + seg.d)
}

const GL_X: [f64; 8] = [
    -0.9602898564975363,
    -0.7966664774136267,
    -0.525532409916329,
    -0.1834346424956498,
    0.1834346424956498,
    0.525532409916329,
    0.7966664774136267,
    0.9602898564975363,
];
const GL_W: [f64; 8] = [
    0.1012285362903763,
    0.2223810344533745,
    0.3137066458778873,
    0.362683783378362,
    0.362683783378362,
    0.3137066458778873,
    0.2223810344533745,
    0.1012285362903763,
];

fn integrate_hermite(seg: &HermiteSegment, t: f64) -> f64 {
    if t <= 0.0 {
        return 0.0;
    }
    let half = t / 2.0;
    let mut sum = 0.0;
    for i in 0..GL_X.len() {
        let tau = half * (GL_X[i] + 1.0);
        sum += GL_W[i] / eval_hermite(seg, tau);
    }
    half * sum
}

struct RampProfile {
    user: Vec<HermiteSegment>,
    cumulative: Vec<f64>,
    lo: f64,
    hi: f64,
}

impl RampProfile {
    fn duration_factor(&self) -> f64 {
        self.cumulative.last().copied().unwrap_or(1.0)
    }

    fn speed_at_progress(&self, progress: f64) -> f64 {
        let p = progress.clamp(0.0, 1.0);
        if p < self.lo || p > self.hi {
            return 1.0;
        }
        let last = self.user.len() - 1;
        for (i, seg) in self.user.iter().enumerate() {
            if p <= seg.x1 || i == last {
                let t = ((p - seg.x0) / seg.width).clamp(0.0, 1.0);
                return eval_hermite(seg, t);
            }
        }
        1.0
    }
}

/// Normalize anchors (sort, clamp, de-dupe) and build the profile.
/// Returns None for missing, degenerate, or all-flat (≈1×) ramps.
fn ramp_profile(ramp: &SpeedRamp) -> Option<RampProfile> {
    let mut pts: Vec<(f64, f64)> = ramp
        .points
        .iter()
        .filter(|p| p.at_progress.is_finite() && p.speed.is_finite())
        .map(|p| {
            (
                p.at_progress.clamp(0.0, 1.0),
                clamp_ramp_speed(p.speed),
            )
        })
        .collect();
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
    let mut spaced: Vec<(f64, f64)> = Vec::with_capacity(pts.len());
    for p in pts {
        if let Some(prev) = spaced.last() {
            if p.0 - prev.0 < 0.005 {
                continue;
            }
        }
        spaced.push(p);
    }
    if spaced.len() < 2 {
        return None;
    }
    if spaced.iter().all(|p| (p.1 - 1.0).abs() < 0.001) {
        return None;
    }
    let lo = spaced[0].0;
    let hi = spaced[spaced.len() - 1].0;
    let user = build_hermite(&spaced);
    let mut segments: Vec<HermiteSegment> = Vec::new();
    if lo > 0.0 {
        segments.push(HermiteSegment {
            x0: 0.0,
            x1: lo,
            width: (lo - 0.0).max(1e-9),
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
        });
    }
    segments.extend(user.clone());
    if hi < 1.0 {
        segments.push(HermiteSegment {
            x0: hi,
            x1: 1.0,
            width: (1.0 - hi).max(1e-9),
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
        });
    }
    let mut cumulative = vec![0.0];
    for seg in &segments {
        let prev = *cumulative.last().unwrap_or(&0.0);
        cumulative.push(prev + seg.width * integrate_hermite(seg, 1.0));
    }
    Some(RampProfile {
        user,
        cumulative,
        lo,
        hi,
    })
}

fn clip_ramp_profile(clip: &RenderClipPlan) -> Option<RampProfile> {
    clip.speed_ramp.as_ref().and_then(ramp_profile)
}

struct RampExprSegment {
    u_start: f64,
    u_end: f64,
    t_start: f64,
    a: f64,
    b: f64,
}

fn ramp_time_map_segments(
    profile: &RampProfile,
    source_span_sec: f64,
    segment_count: usize,
) -> Vec<RampExprSegment> {
    let span = source_span_sec.max(1e-6);
    let n = segment_count.clamp(2, 64);
    let mut segments = Vec::with_capacity(n);
    let mut t_start = 0.0;
    for j in 0..n {
        let s0 = j as f64 / n as f64;
        let s1 = (j + 1) as f64 / n as f64;
        let u_start = s0 * span;
        let u_end = s1 * span;
        let hu = (u_end - u_start).max(1e-9);
        let w0 = 1.0 / profile.speed_at_progress(s0).max(1e-6);
        let w1 = 1.0 / profile.speed_at_progress(s1).max(1e-6);
        segments.push(RampExprSegment {
            u_start,
            u_end,
            t_start,
            a: w0,
            b: (w1 - w0) / (2.0 * hu),
        });
        t_start += hu * ((w0 + w1) / 2.0);
    }
    let analytic = span * profile.duration_factor();
    let scale = if t_start > 0.0 { analytic / t_start } else { 1.0 };
    for seg in &mut segments {
        seg.a *= scale;
        seg.b *= scale;
        seg.t_start *= scale;
    }
    segments
}

/// TS `formatNum`: finite, 6 decimals, trailing zeros trimmed.
fn fmt_num(v: f64) -> String {
    if !v.is_finite() {
        return "0".into();
    }
    let s = format!("{v:.6}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s.is_empty() || s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

fn signed_mul(coef: f64, term: &str) -> String {
    if !coef.is_finite() || coef == 0.0 {
        return format!("+0*{term}");
    }
    if coef < 0.0 {
        format!("-{}*{term}", fmt_num(-coef))
    } else {
        format!("+{}*{term}", fmt_num(coef))
    }
}

/// `setpts` for a ramped clip: piecewise-quadratic forward map
/// u (source seconds) → t (timeline seconds), same shape as the TS builder.
fn ramp_setpts(profile: &RampProfile, source_span_sec: f64) -> String {
    let segments = ramp_time_map_segments(profile, source_span_sec, 32);
    if segments.is_empty() {
        return "setpts=PTS-STARTPTS".into();
    }
    let u = "((PTS-STARTPTS)*TB)";
    let mut expr = "0".to_string();
    for seg in segments.iter().rev() {
        let du = format!("({u}-{})", fmt_num(seg.u_start));
        let e = format!(
            "({}{}{})",
            fmt_num(seg.t_start),
            signed_mul(seg.a, &du),
            signed_mul(seg.b, &format!("{du}*{du}"))
        );
        expr = format!("if(gte({u}\\,{})\\,{e}\\,{expr})", fmt_num(seg.u_start));
    }
    format!("setpts=({expr})/TB")
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

    let base_color = ffmpeg_color_literal(&plan_view.background_color);
    args.extend([
        "-f".into(),
        "lavfi".into(),
        "-i".into(),
        format!("color=c={base_color}:s={width}x{height}:d={duration}:r={fps}"),
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
            // Ramped clips skip transition pre-roll so the setpts curve maps
            // cleanly from sourceIn (u = 0) — same as the TS builder.
            let ramped = clip_ramp_profile(clip).is_some();
            let early_source = if ramped { 0.0 } else { overlap * speed };
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

    let filter = build_filter_complex(&plan_view, &visuals, &audio_only_inputs, width, height, fps)?;
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
        "-r".into(),
        format_fps(fps),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-movflags".into(),
        "+faststart".into(),
        temp_output.to_string_lossy().to_string(),
    ]);

    Ok(BuiltCommand {
        program: ffmpeg_program().to_string_lossy().to_string(),
        args,
        temp_output,
    })
}

/// fps filter / `-r` value: integer when whole, else 3 decimals.
fn format_fps(fps: f64) -> String {
    let safe = if fps.is_finite() && fps > 0.0 { fps } else { 30.0 };
    if (safe - safe.round()).abs() < 0.001 {
        format!("{}", safe.round() as i64)
    } else {
        format!("{safe:.3}")
    }
}

fn ffmpeg_color_literal(color: &str) -> String {
    let trimmed = color.trim();
    if trimmed.len() == 7 && trimmed.starts_with('#') {
        return format!("0x{}", &trimmed[1..]);
    }
    if trimmed.len() == 4 && trimmed.starts_with('#') {
        let chars: Vec<char> = trimmed[1..].chars().collect();
        return format!(
            "0x{0}{0}{1}{1}{2}{2}",
            chars[0], chars[1], chars[2]
        );
    }
    "black".into()
}

fn clamp_scale(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        1.0
    } else {
        value.abs().clamp(0.02, 20.0)
    }
}

/// Scale/rotate/pad a media clip into the output frame honouring its transform.
///
/// Mirrors preview (`mediaGeometry` + CSS): contain-fit, then scale/flip/
/// rotate, centred at transform.x/y. Always lands on an exact `width x height`
/// canvas (pad), so no trailing resample softens the frame — `setsar=1` keeps
/// geometry exact like the preview stage.
fn media_placement_filters(clip: &RenderClipPlan, width: u32, height: u32) -> String {
    let tr = &clip.transform;
    let cw = clip.canvas_width.max(1.0);
    let chh = clip.canvas_height.max(1.0);
    let mw = clip.media_width.filter(|v| *v > 0.0).unwrap_or(cw);
    let mh = clip.media_height.filter(|v| *v > 0.0).unwrap_or(chh);
    let fit_scale = (cw / mw).min(chh / mh);
    let fit_w = mw * fit_scale;
    let fit_h = mh * fit_scale;
    let sx = clamp_scale(tr.scale_x);
    let sy = clamp_scale(tr.scale_y);

    let out_scale_x = width as f64 / cw;
    let out_scale_y = height as f64 / chh;
    let box_w = ((fit_w * sx * out_scale_x).round().max(2.0) as i64 & !1).max(2) as f64;
    let box_h = ((fit_h * sy * out_scale_y).round().max(2.0) as i64 & !1).max(2) as f64;

    let legacy = tr.x == 0.0 && tr.y == 0.0;
    let center_x = if legacy { width as f64 / 2.0 } else { tr.x * out_scale_x };
    let center_y = if legacy { height as f64 / 2.0 } else { tr.y * out_scale_y };

    let mut parts: Vec<String> = vec![format!(
        "scale={box_w:.0}:{box_h:.0}:force_original_aspect_ratio=decrease:flags=lanczos"
    )];
    // Negative scale = mirror (preview CSS scale(-1, …)); clamp_scale keeps magnitude.
    if tr.scale_x < 0.0 {
        parts.push("hflip".into());
    }
    if tr.scale_y < 0.0 {
        parts.push("vflip".into());
    }
    if tr.rotation.abs() > 0.01 {
        let rad = tr.rotation.abs() * std::f64::consts::PI / 180.0;
        let rw = (box_w * rad.cos() + box_h * rad.sin()).abs().round().max(box_w);
        let rh = (box_w * rad.sin() + box_h * rad.cos()).abs().round().max(box_h);
        let angle = (tr.rotation % 360.0) * std::f64::consts::PI / 180.0;
        parts.push(format!(
            "rotate={angle:.6}:ow={rw:.0}:oh={rh:.0}:c=black@0"
        ));
    }
    let off_x = (center_x - box_w / 2.0).round().max(0.0);
    let off_y = (center_y - box_h / 2.0).round().max(0.0);
    parts.push(format!("pad={width}:{height}:{off_x:.0}:{off_y:.0}:black@0"));
    parts.push("setsar=1".into());
    parts.join(",")
}

fn build_filter_complex(
    plan: &RenderPlan,
    visuals: &[&RenderClipPlan],
    audio_only: &[(usize, &RenderClipPlan)],
    width: u32,
    height: u32,
    fps: f64,
) -> Result<String, String> {
    let mut parts: Vec<String> = Vec::new();
    // lavfi color is YUV — rgba + overlay format=rgb keeps dissolve alpha.
    parts.push("[0:v]format=rgba[base]".into());

    // Phase 1: prepare each visual stream (placement, retime, effects,
    // transition fades, opacity). Order here follows `visuals` (track, start)
    // so same-track transition pairing stays intact; painting happens in
    // phase 2 in preview stacking order.
    struct Prepared {
        vlabel: String,
        track_order: i32,
        start: f64,
        overlay_start: f64,
        overlay_end: f64,
    }
    let mut prepared: Vec<Prepared> = Vec::with_capacity(visuals.len());

    for (index, clip) in visuals.iter().enumerate() {
        let input_index = index + 1;
        let start = clip.timeline_start_sec.max(0.0);
        let end = clip.timeline_end_sec.max(start + 0.01);
        let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
        let opacity = clip.opacity.clamp(0.0, 1.0);
        let overlap = clip.transition_overlap_sec.max(0.0);
        let overlay_start = (start - overlap).max(0.0);
        let setpts = match clip_ramp_profile(clip) {
            Some(profile) => ramp_setpts(
                &profile,
                (clip.source_out_sec - clip.source_in_sec).max(0.01),
            ),
            None => {
                if (speed - 1.0).abs() < 0.001 {
                    "setpts=PTS-STARTPTS".to_string()
                } else {
                    format!("setpts=(PTS-STARTPTS)/{speed}")
                }
            }
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
            if tin == "fade" || tin == "fadeWhite" {
                extras.push(ffmpeg_smooth_fade_in_alpha(in_full / 2.0, in_full / 2.0));
            } else {
                // dissolve (crossfade): full-window eased alpha
                extras.push(ffmpeg_smooth_fade_in_alpha(in_full, 0.0));
            }
        }
        if hold > 0.001 {
            let cut_at = overlap + clip_dur;
            extras.push(format!("tpad=stop_mode=clone:stop_duration={hold:.3}"));
            let next_type = next_sibling.map(|c| c.transition_in.kind.as_str()).unwrap_or("none");
            if next_type == "fade" || next_type == "fadeWhite" {
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
        let placement = media_placement_filters(clip, width, height);
        parts.push(format!(
            "[{input_index}:v]{placement},{setpts},format=rgba{extra_part},colorchannelmixer=aa={opacity:.3}[v{index}]"
        ));
        prepared.push(Prepared {
            vlabel: format!("[v{index}]"),
            track_order: clip.track_order,
            start,
            overlay_start,
            overlay_end: end + hold,
        });
    }

    // Phase 2: paint in preview stacking order — lower `track_order` paints
    // above (same as layerStackZ / the TS builder); same-track text sits above
    // that track's media. Matches `buildFilterComplex` paint steps in
    // src/domain/ffmpegArgs.ts.
    #[derive(Clone, Copy)]
    enum PaintStep {
        Clip(usize),
        Text(usize),
    }
    struct PaintKey {
        track_order: i32,
        kind_rank: u8, // media (0) before text (1) on the same track
        start: f64,
        step: PaintStep,
    }
    let mut steps: Vec<PaintKey> = Vec::with_capacity(prepared.len() + plan.texts.len());
    for (i, p) in prepared.iter().enumerate() {
        steps.push(PaintKey {
            track_order: p.track_order,
            kind_rank: 0,
            start: p.start,
            step: PaintStep::Clip(i),
        });
    }
    for (ti, text) in plan.texts.iter().enumerate() {
        steps.push(PaintKey {
            track_order: text.track_order,
            kind_rank: 1,
            start: text.timeline_start_sec.max(0.0),
            step: PaintStep::Text(ti),
        });
    }
    steps.sort_by(|a, b| {
        b.track_order
            .cmp(&a.track_order)
            .then(a.kind_rank.cmp(&b.kind_rank))
            .then(
                a.start
                    .partial_cmp(&b.start)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });

    let mut current = "[base]".to_string();
    let mut mix_count = 0usize;
    for key in &steps {
        match key.step {
            PaintStep::Clip(i) => {
                let p = &prepared[i];
                let next = format!("[mix{mix_count}]");
                mix_count += 1;
                parts.push(format!(
                    "{current}{}overlay=x=0:y=0:format=rgb:eof_action=pass:enable='between(t\\,{:.3}\\,{:.3})'{next}",
                    p.vlabel, p.overlay_start, p.overlay_end
                ));
                current = next;
            }
            PaintStep::Text(ti) => {
                let text = &plan.texts[ti];
                let part = drawtext_filter(text, &current, format!("[txt{ti}]"));
                parts.push(part);
                current = format!("[txt{ti}]");
            }
        }
    }

    if current != "[outv]" {
        // Force constant frame rate = canvas fps so motion matches preview
        // (sources may be VFR or a different fps; the lavfi base alone
        // doesn't normalize them).
        parts.push(format!("{current}fps={}[outv]", format_fps(fps)));
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
        let label = format!("[a{ai}]");
        append_audio_chain(
            &mut parts,
            input_index,
            clip,
            plan.duration_sec,
            start_ms,
            vol,
            &label,
        );
        audio_labels.push(label);
        ai += 1;
    }

    for (input_index, clip) in audio_only {
        if !clip.include_audio {
            continue;
        }
        let start_ms = (clip.timeline_start_sec.max(0.0) * 1000.0).round() as i64;
        let vol = clip.volume.clamp(0.0, 2.0);
        let label = format!("[a{ai}]");
        append_audio_chain(
            &mut parts,
            *input_index,
            clip,
            plan.duration_sec,
            start_ms,
            vol,
            &label,
        );
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

/// Append a clip's audio chain: constant speed → one `atempo` chain;
/// ramped → the source is split into short constant-speed slices, each
/// retimed with a slice-local `atempo` and `concat`-ed (FFmpeg's `atempo`
/// cannot take an expression). 24 slices keep per-slice drift small and the
/// graph bounded. Mirrors the TS builder's `appendAudioChain`.
#[allow(clippy::too_many_arguments)]
fn append_audio_chain(
    parts: &mut Vec<String>,
    input_index: usize,
    clip: &RenderClipPlan,
    plan_duration_sec: f64,
    start_ms: i64,
    vol: f64,
    label: &str,
) {
    let tail = format!(
        "volume={vol},adelay={start_ms}|{start_ms},apad,atrim=0:{plan_duration_sec:.3}"
    );
    if let Some(profile) = clip_ramp_profile(clip) {
        let span = (clip.source_out_sec - clip.source_in_sec).max(0.01);
        let segments = ramp_time_map_segments(&profile, span, 24);
        let n = segments.len();
        let total = span * profile.duration_factor();
        let slice_dur = span / n as f64;
        let mut slice_labels = String::new();
        for (i, seg) in segments.iter().enumerate() {
            let out_end = if i + 1 < n {
                segments[i + 1].t_start
            } else {
                total
            };
            let out_dur = (out_end - seg.t_start).max(0.02);
            let speed = (slice_dur / out_dur).max(0.01);
            let atempo = atempo_chain(speed);
            parts.push(format!(
                "[{input_index}:a]atrim={:.3}:{:.3},asetpts=PTS-STARTPTS,{atempo}asetpts=PTS-STARTPTS[ras{input_index}_{i}]",
                seg.u_start, seg.u_end
            ));
            slice_labels.push_str(&format!("[ras{input_index}_{i}]"));
        }
        parts.push(format!(
            "{slice_labels}concat=n={n}:v=0:a=1,{tail}{label}"
        ));
        return;
    }
    let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
    let atempo = atempo_chain(speed);
    parts.push(format!(
        "[{input_index}:a]asetpts=PTS-STARTPTS,{atempo}{tail}{label}"
    ));
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

fn drawtext_filter(text: &RenderTextPlan, current: &str, next: String) -> String {
    let start = text.timeline_start_sec.max(0.0);
    let end = text.timeline_end_sec.max(start + 0.01);
    let dur = (end - start).max(0.01);
    let escaped = escape_drawtext(&text.content);
    let fontfile = resolve_drawtext_font(text.font_path.as_deref())
        .map(|p| format!(":fontfile={}", quote_filter_path(&p)))
        .unwrap_or_default();
    let base_size = text.font_size.max(8.0).round();
    let color = normalize_color(&text.color);
    let base_alpha = text.opacity.clamp(0.0, 1.0);
    let x_expr = drawtext_x_expr(&text.align, text.x, start, dur, &text.text_animation);
    let y_expr = drawtext_y_expr(text.y, start, dur, &text.text_animation);
    let alpha_expr = drawtext_alpha_expr(
        base_alpha,
        start,
        end,
        text.fade_in_sec,
        text.fade_out_sec,
        &text.text_animation,
    );
    format!(
        "{current}drawtext=text='{escaped}'{fontfile}:fontsize={base_size}:fontcolor={color}@1:x='{x_expr}':y='{y_expr}':alpha='{alpha_expr}':enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
    )
}

fn slide_axis_offset(
    anim: &str,
    axis: char,
    start: f64,
    dur: f64,
    out_start: f64,
    out_dur: f64,
) -> Option<String> {
    let wants = (axis == 'x' && (anim == "slideLeft" || anim == "slideRight"))
        || (axis == 'y' && (anim == "slideUp" || anim == "slideDown"));
    if !wants {
        return None;
    }
    let sign = if anim == "slideLeft" || anim == "slideUp" {
        1.0
    } else {
        -1.0
    };
    let mut terms: Vec<String> = Vec::new();
    if dur > 0.001 {
        terms.push(format!(
            "{:.1}*(1-min(1\\,max(0\\,(t-{start:.3})/{dur:.3})))",
            sign * 48.0
        ));
    }
    if out_dur > 0.001 {
        terms.push(format!(
            "{:.1}*(min(1\\,max(0\\,(t-{out_start:.3})/{out_dur:.3})))",
            sign * 48.0
        ));
    }
    if terms.is_empty() {
        None
    } else {
        Some(format!("({})", terms.join("+")))
    }
}

fn drawtext_x_expr(
    align: &str,
    x: f64,
    start: f64,
    dur: f64,
    anim: &RenderTextAnimation,
) -> String {
    let base = match align {
        "left" => format!("{}", x.max(0.0) as i64),
        "right" => format!("{}-text_w", x.max(0.0) as i64),
        _ => format!("{}-(text_w/2)", x.max(0.0) as i64),
    };
    let in_dur = anim.in_duration_sec.min(dur);
    let out_dur = anim.out_duration_sec.min(dur);
    let out_start = start + (dur - out_dur).max(0.0);
    let mut off: Vec<String> = Vec::new();
    if let Some(e) = slide_axis_offset(&anim.r#in, 'x', start, in_dur, out_start, 0.0) {
        off.push(e);
    }
    if let Some(e) = slide_axis_offset(&anim.out, 'x', start, 0.0, out_start, out_dur) {
        off.push(e);
    }
    if off.is_empty() {
        base
    } else {
        format!("({base}+{})", off.join("+"))
    }
}

fn drawtext_y_expr(y: f64, start: f64, dur: f64, anim: &RenderTextAnimation) -> String {
    let base = format!("{}-(text_h/2)", y.max(0.0) as i64);
    let in_dur = anim.in_duration_sec.min(dur);
    let out_dur = anim.out_duration_sec.min(dur);
    let out_start = start + (dur - out_dur).max(0.0);
    let mut off: Vec<String> = Vec::new();
    if let Some(e) = slide_axis_offset(&anim.r#in, 'y', start, in_dur, out_start, 0.0) {
        off.push(e);
    }
    if let Some(e) = slide_axis_offset(&anim.out, 'y', start, 0.0, out_start, out_dur) {
        off.push(e);
    }
    if off.is_empty() {
        base
    } else {
        format!("({base}+{})", off.join("+"))
    }
}

fn drawtext_alpha_expr(
    base_alpha: f64,
    start: f64,
    end: f64,
    fade_in: f64,
    fade_out: f64,
    anim: &RenderTextAnimation,
) -> String {
    let dur = (end - start).max(0.01);
    let mut terms: Vec<String> = vec![format!("{base_alpha:.3}")];
    let fi = fade_in.min(dur);
    if fi > 0.001 {
        terms.push(format!("min(1\\,max(0\\,(t-{start:.3})/{fi:.3}))"));
    }
    let fo = fade_out.min(dur);
    if fo > 0.001 {
        terms.push(format!("min(1\\,max(0\\,({end:.3}-t)/{fo:.3}))"));
    }
    let in_dur = anim.in_duration_sec.min(dur);
    if anim.r#in != "none" && in_dur > 0.001 {
        if anim.r#in == "fade" || anim.r#in == "scalePop" {
            terms.push(format!("min(1\\,max(0\\,(t-{start:.3})/{in_dur:.3}))"));
        } else {
            terms.push(format!(
                "(0.15+0.85*min(1\\,max(0\\,(t-{start:.3})/{in_dur:.3})))"
            ));
        }
    }
    let out_dur = anim.out_duration_sec.min(dur);
    if anim.out != "none" && out_dur > 0.001 {
        if anim.out == "fade" || anim.out == "scalePop" {
            terms.push(format!("min(1\\,max(0\\,({end:.3}-t)/{out_dur:.3}))"));
        } else {
            terms.push(format!(
                "(0.15+0.85*min(1\\,max(0\\,({end:.3}-t)/{out_dur:.3})))"
            ));
        }
    }
    terms.join("*")
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
    silent_command(program)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to start ffmpeg ({e}). No working FFmpeg found — ship the bundled sidecar (see src-tauri/binaries/README.md) or install FFmpeg."
            )
        })
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
    let output = silent_command(ffprobe_program())
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
    let output = silent_command(ffprobe_program())
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
    let status = silent_command(ffmpeg_program())
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
