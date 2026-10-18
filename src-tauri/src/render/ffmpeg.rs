use crate::toolchain::{ffmpeg_program, ffprobe_program, silent_command};
use serde::Deserialize;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipPlan {
    /// Wire-format id (debugging / future selective re-render).
    #[allow(dead_code)]
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
    pub effect_keyframes: Option<EffectKeyframes>,
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
    #[serde(default)]
    pub transform_keyframes: Option<EffectKeyframes>,
    /// Strip cell hard crop, normalized 0…1 (None = no crop).
    #[serde(default)]
    pub crop: Option<RenderClipCrop>,
}

#[derive(Debug, Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderClipCrop {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
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
    /// Present on the plan; compositing uses clip-level `RenderClipPlan.opacity`.
    #[allow(dead_code)]
    #[serde(default = "default_one")]
    pub opacity: f64,
    #[serde(default = "default_blend_normal")]
    pub blend_mode: String,
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
            blend_mode: "normal".into(),
        }
    }
}

fn default_blend_normal() -> String {
    "normal".into()
}

/// Map CapCut-style blend ids to FFmpeg `blend=all_mode=`. None → plain overlay.
fn ffmpeg_blend_mode(mode: &str) -> Option<&'static str> {
    match mode {
        "darken" => Some("darken"),
        "multiply" => Some("multiply"),
        "colorBurn" | "linearBurn" => Some("burn"),
        "lighten" => Some("lighten"),
        "screen" => Some("screen"),
        "colorDodge" => Some("dodge"),
        "linearDodge" => Some("addition"),
        "overlay" => Some("overlay"),
        "softLight" => Some("softlight"),
        "hardLight" => Some("hardlight"),
        "difference" => Some("difference"),
        "exclusion" => Some("exclusion"),
        _ => None,
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
    pub vignette: f64,
    #[serde(default)]
    pub sharpen: f64,
    #[serde(default)]
    pub sepia: f64,
    #[serde(default)]
    pub hue_rotate: f64,
    #[serde(default = "default_tint_color")]
    pub tint_color: String,
    #[serde(default)]
    pub tint_gradient: Vec<String>,
    #[serde(default)]
    pub tint_amount: f64,
    #[serde(default = "default_tint_blend")]
    pub tint_blend: String,
    #[serde(default)]
    pub strobe_frames: f64,
    #[serde(default = "default_strobe_color")]
    pub strobe_color: String,
    #[serde(default)]
    pub fade_in_sec: f64,
    #[serde(default)]
    pub fade_out_sec: f64,
}

fn default_strobe_color() -> String {
    "#000000".into()
}

fn default_tint_color() -> String {
    "#000000".into()
}

fn default_tint_blend() -> String {
    "soft-light".into()
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

fn default_slide_dist() -> f64 {
    48.0
}

fn default_font_weight() -> f64 {
    700.0
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectKeyframePoint {
    #[allow(dead_code)]
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub at_progress: f64,
    #[serde(default)]
    pub value: f64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectParamTrack {
    #[serde(default)]
    pub param: String,
    #[serde(default)]
    pub tracks: Vec<EffectKeyframePoint>,
    #[serde(default)]
    pub points: Vec<EffectKeyframePoint>,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffectKeyframes {
    #[serde(default)]
    pub tracks: Vec<EffectParamTrack>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderTextPlan {
    #[allow(dead_code)]
    pub clip_id: String,
    pub content: String,
    pub font_family: String,
    pub font_path: Option<String>,
    pub font_size: f64,
    /// 100…900 (see TS TextStyle). Export snaps to the closest bundled face.
    #[serde(default = "default_font_weight")]
    pub font_weight: f64,
    pub color: String,
    pub align: String,
    pub x: f64,
    pub y: f64,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
    #[serde(default = "default_blend_normal")]
    pub blend_mode: String,
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
    /// Instagram-style highlight behind glyphs (None = no background).
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub background_padding: f64,
    #[serde(default = "default_slide_dist")]
    pub slide_dist: f64,
    #[serde(default)]
    pub transform_keyframes: Option<EffectKeyframes>,
    #[serde(default)]
    pub base_font_size: f64,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlan {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    #[serde(default = "default_bg_color")]
    pub background_color: String,
    #[serde(default)]
    pub letterbox: RenderLetterbox,
    pub duration_sec: f64,
    #[serde(default = "default_vbitrate")]
    pub video_bitrate: String,
    #[serde(default = "default_abitrate")]
    pub audio_bitrate: String,
    pub clips: Vec<RenderClipPlan>,
    pub texts: Vec<RenderTextPlan>,
    /// Filter-track washes. Missing on older plans.
    #[serde(default)]
    pub washes: Vec<RenderWashPlan>,
    pub missing_asset_ids: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderWashPlan {
    pub clip_id: String,
    pub track_id: String,
    pub track_order: i32,
    pub timeline_start_sec: f64,
    pub timeline_end_sec: f64,
    #[serde(default = "default_one")]
    pub opacity: f64,
    pub effects: RenderClipEffects,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderLetterbox {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub top_pct: f64,
    #[serde(default)]
    pub bottom_pct: f64,
    #[serde(default)]
    pub left_pct: f64,
    #[serde(default)]
    pub right_pct: f64,
    #[serde(default = "default_bar_color")]
    pub color: String,
}

fn default_bar_color() -> String {
    "#000000".into()
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
// cubic Hermite spline. Timeline duration = span · ∫₀¹ ds/v(s). Outside the
// user anchors the nearest anchor's speed is held to the clip edge. Export
// discretises u → T(u) = ∫₀ᵘ dτ/v(τ) into piecewise quadratics (32 for
// video setpts, 24 for audio slices), exactly like the TS builder.

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpeedPoint {
    #[allow(dead_code)]
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
        // Match TS MAX_RAMP_SPEED (Premiere-like ceiling).
        v.clamp(0.1, 3.0)
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

/// Smoothstep between two speeds (Hermite m0=m1=0): t'=t²(3−2t), v=v0+(v1−v0)t'.
fn ease_segment(x0: f64, y0: f64, x1: f64, y1: f64) -> HermiteSegment {
    let width = (x1 - x0).max(1e-9);
    let v0 = clamp_ramp_speed(y0);
    let v1 = clamp_ramp_speed(y1);
    HermiteSegment {
        x0,
        x1,
        width,
        a: 2.0 * v0 - 2.0 * v1,
        b: -3.0 * v0 + 3.0 * v1,
        c: 0.0,
        d: v0,
    }
}

fn build_hermite(points: &[(f64, f64)]) -> Vec<HermiteSegment> {
    let mut segments = Vec::with_capacity(points.len().saturating_sub(1));
    for i in 0..points.len().saturating_sub(1) {
        segments.push(ease_segment(
            points[i].0,
            points[i].1,
            points[i + 1].0,
            points[i + 1].1,
        ));
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
    segments: Vec<HermiteSegment>,
    cumulative: Vec<f64>,
}

impl RampProfile {
    fn duration_factor(&self) -> f64 {
        self.cumulative.last().copied().unwrap_or(1.0)
    }

    fn speed_at_progress(&self, progress: f64) -> f64 {
        let p = progress.clamp(0.0, 1.0);
        if self.segments.is_empty() {
            return 1.0;
        }
        let last = self.segments.len() - 1;
        for (i, seg) in self.segments.iter().enumerate() {
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
    let lead_speed = spaced[0].1;
    let trail_speed = spaced[spaced.len() - 1].1;
    let mut segments: Vec<HermiteSegment> = Vec::new();
    // Hold the first anchor's speed from the clip start to that anchor (mirrors
    // the TS model: an all-slow curve stays slow over the whole clip).
    if lo > 0.0 {
        segments.push(HermiteSegment {
            x0: 0.0,
            x1: lo,
            width: lo.max(1e-9),
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: lead_speed,
        });
    }
    segments.extend(build_hermite(&spaced));
    if hi < 1.0 {
        segments.push(HermiteSegment {
            x0: hi,
            x1: 1.0,
            width: (1.0 - hi).max(1e-9),
            a: 0.0,
            b: 0.0,
            c: 0.0,
            d: trail_speed,
        });
    }
    let mut cumulative = vec![0.0];
    for seg in &segments {
        let prev = *cumulative.last().unwrap_or(&0.0);
        cumulative.push(prev + seg.width * integrate_hermite(seg, 1.0));
    }
    Some(RampProfile {
        segments,
        cumulative,
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

/// SVG stickers preview fine in the browser but most FFmpeg builds ship
/// without an SVG decoder. Pre-rasterize `.svg` inputs to a cached PNG with
/// the bundled ffmpeg so export never goes black on shapes/logo overlays.
/// Returns the replacement path, or the original when conversion fails
/// (caller keeps the original input as a best-effort fallback).
fn rasterized_svg_path(source: &str) -> String {
    if !source.to_lowercase().ends_with(".svg") {
        return source.to_string();
    }
    if !Path::new(source).is_file() {
        return source.to_string();
    }
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in source.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    if let Ok(meta) = std::fs::metadata(source) {
        hash ^= meta.len().wrapping_add(meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0));
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let out = std::env::temp_dir().join(format!("klipcut-svg-{hash:x}.png"));
    if out.is_file() {
        return out.to_string_lossy().to_string();
    }
    let status = silent_command(ffmpeg_program())
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            source,
            "-frames:v",
            "1",
            out.to_string_lossy().as_ref(),
        ])
        .status();
    match status {
        Ok(s) if s.success() && out.is_file() => out.to_string_lossy().to_string(),
        _ => source.to_string(),
    }
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
    // Pre-rasterize SVG stickers/logo (ffmpeg often lacks an SVG decoder).
    let clips: Vec<RenderClipPlan> = plan
        .clips
        .iter()
        .cloned()
        .map(|mut clip| {
            if clip.kind == "image" && clip.asset_path.to_lowercase().ends_with(".svg") {
                clip.asset_path = rasterized_svg_path(&clip.asset_path);
            }
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

fn track_points(kf: &Option<EffectKeyframes>, param: &str) -> Vec<(f64, f64)> {
    let Some(kf) = kf else {
        return Vec::new();
    };
    let Some(track) = kf.tracks.iter().find(|t| t.param == param) else {
        return Vec::new();
    };
    let pts = if track.points.is_empty() {
        &track.tracks
    } else {
        &track.points
    };
    pts.iter().map(|p| (p.at_progress, p.value)).collect()
}

fn has_geometry_keyframes(kf: &Option<EffectKeyframes>) -> bool {
    ["x", "y", "scaleX", "scaleY", "rotation"]
        .iter()
        .any(|param| !track_points(kf, param).is_empty())
}

fn linear_track_expr(
    kf: &Option<EffectKeyframes>,
    param: &str,
    dur: f64,
    before: f64,
    origin: f64,
    time_var: &str,
) -> Option<String> {
    let points = track_points(kf, param);
    if points.is_empty() {
        return None;
    }
    Some(linear_expr(&points, dur.max(0.01), before, origin, time_var))
}

fn linear_expr(points: &[(f64, f64)], dur: f64, before: f64, origin: f64, time_var: &str) -> String {
    let mut mapped: Vec<(f64, f64)> = points
        .iter()
        .map(|(progress, value)| (origin + progress.clamp(0.0, 1.0) * dur, *value))
        .collect();
    mapped.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    if mapped.len() == 1 {
        let (t, v) = mapped[0];
        if (before - v).abs() < 1e-6 {
            return format!("{v:.4}");
        }
        return format!("if(lt({time_var}\\,{t:.4})\\,{before:.4}\\,{v:.4})");
    }
    let mut expr = format!("{:.4}", mapped.last().unwrap().1);
    for i in (0..mapped.len() - 1).rev() {
        let (ta, va) = mapped[i];
        let (tb, vb) = mapped[i + 1];
        let span = (tb - ta).max(0.0001);
        let blend = format!("{va:.4}+({vb:.4}-{va:.4})*({time_var}-{ta:.4})/{span:.4}");
        expr = format!("if(lt({time_var}\\,{tb:.4})\\,{blend}\\,{expr})");
    }
    let (t0, _) = mapped[0];
    format!("if(lt({time_var}\\,{t0:.4})\\,{before:.4}\\,{expr})")
}

fn even_expr(inner: &str) -> String {
    format!("max(2\\,2*trunc(({inner})/2))")
}

/// Time-varying scale / rotate / pad. Full frame so later overlay stays aligned.
fn animated_placement_filters(clip: &RenderClipPlan, width: u32, height: u32) -> String {
    let tr = &clip.transform;
    let cw = clip.canvas_width.max(1.0);
    let chh = clip.canvas_height.max(1.0);
    let mw = clip.media_width.filter(|v| *v > 0.0).unwrap_or(cw);
    let mh = clip.media_height.filter(|v| *v > 0.0).unwrap_or(chh);
    let fit_scale = (cw / mw).min(chh / mh);
    let out_sx = width as f64 / cw;
    let out_sy = height as f64 / chh;
    let fit_w = mw * fit_scale * out_sx;
    let fit_h = mh * fit_scale * out_sy;
    let dur = (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01);
    let legacy = tr.x == 0.0 && tr.y == 0.0 && track_points(&clip.transform_keyframes, "x").is_empty()
        && track_points(&clip.transform_keyframes, "y").is_empty();
    let x_before = if legacy { cw / 2.0 } else { tr.x };
    let y_before = if legacy { chh / 2.0 } else { tr.y };

    let box_w = match linear_track_expr(&clip.transform_keyframes, "scaleX", dur, tr.scale_x, 0.0, "t") {
        Some(expr) => even_expr(&format!("{fit_w:.4}*abs({expr})")),
        None => {
            let even = ((fit_w * clamp_scale(tr.scale_x)).round().max(2.0) as i64 & !1).max(2);
            even.to_string()
        }
    };
    let box_h = match linear_track_expr(&clip.transform_keyframes, "scaleY", dur, tr.scale_y, 0.0, "t") {
        Some(expr) => even_expr(&format!("{fit_h:.4}*abs({expr})")),
        None => {
            let even = ((fit_h * clamp_scale(tr.scale_y)).round().max(2.0) as i64 & !1).max(2);
            even.to_string()
        }
    };
    let center_x = match linear_track_expr(&clip.transform_keyframes, "x", dur, x_before, 0.0, "t") {
        Some(expr) => format!("({expr})*{out_sx:.6}"),
        None => {
            let x = if track_points(&clip.transform_keyframes, "x").is_empty() && legacy {
                width as f64 / 2.0
            } else {
                x_before * out_sx
            };
            format!("{x:.3}")
        }
    };
    let center_y = match linear_track_expr(&clip.transform_keyframes, "y", dur, y_before, 0.0, "t") {
        Some(expr) => format!("({expr})*{out_sy:.6}"),
        None => {
            let y = if track_points(&clip.transform_keyframes, "y").is_empty() && legacy {
                height as f64 / 2.0
            } else {
                y_before * out_sy
            };
            format!("{y:.3}")
        }
    };
    let mut parts = vec![format!(
        "scale=w='{box_w}':h='{box_h}':eval=frame:flags=lanczos"
    )];
    if tr.scale_x < 0.0 {
        parts.push("hflip".into());
    }
    if tr.scale_y < 0.0 {
        parts.push("vflip".into());
    }
    let rot_pts = track_points(&clip.transform_keyframes, "rotation");
    let mut pad_w = box_w.clone();
    let mut pad_h = box_h.clone();
    if !rot_pts.is_empty() || tr.rotation.abs() > 0.01 {
        let rot = linear_track_expr(&clip.transform_keyframes, "rotation", dur, tr.rotation, 0.0, "t")
            .unwrap_or_else(|| format!("{:.4}", tr.rotation));
        let rad = format!("({rot})*0.0174533");
        let ow = format!("abs(({box_w})*cos(abs({rad})))+abs(({box_h})*sin(abs({rad})))");
        let oh = format!("abs(({box_w})*sin(abs({rad})))+abs(({box_h})*cos(abs({rad})))");
        parts.push(format!(
            "rotate={rad}:ow='{ow}':oh='{oh}':c=black@0:eval=frame"
        ));
        pad_w = ow;
        pad_h = oh;
    }
    parts.push(format!(
        "pad={width}:{height}:x='({center_x})-({pad_w})/2':y='({center_y})-({pad_h})/2':color=black@0:eval=frame"
    ));
    parts.push("setsar=1".into());
    if let Some(crop) = clip.crop {
        if crop.w > 0.001 && crop.h > 0.001 {
            let cx = (crop.x * width as f64).round().max(0.0);
            let cy = (crop.y * height as f64).round().max(0.0);
            let cw = ((crop.w * width as f64).round().max(2.0) as i64 & !1).max(2) as f64;
            let ch = ((crop.h * height as f64).round().max(2.0) as i64 & !1).max(2) as f64;
            parts.push(format!("crop={cw:.0}:{ch:.0}:{cx:.0}:{cy:.0}"));
            parts.push(format!("pad={width}:{height}:{cx:.0}:{cy:.0}:black@0"));
            parts.push("setsar=1".into());
        }
    }
    parts.join(",")
}

fn even_px(value: f64) -> f64 {
    ((value.round().max(2.0) as i64) & !1i64).max(2) as f64
}

/// Rotated layer: local crop, then rotate, then pad. Mirrors the TS booth path
/// so a tilted strip matches preview (clip, then CSS rotate).
fn rotated_placement_filters(
    clip: &RenderClipPlan,
    width: u32,
    height: u32,
    box_w: f64,
    box_h: f64,
    center_x: f64,
    center_y: f64,
    tr: &RenderClipTransform,
) -> String {
    let mut parts = vec![format!(
        "scale={box_w:.0}:{box_h:.0}:force_original_aspect_ratio=decrease:flags=lanczos"
    )];
    if tr.scale_x < 0.0 {
        parts.push("hflip".into());
    }
    if tr.scale_y < 0.0 {
        parts.push("vflip".into());
    }
    let mut src_w = box_w;
    let mut src_h = box_h;
    if let Some(crop) = clip.crop {
        if crop.w > 0.001 && crop.h > 0.001 {
            let cell_w = even_px(crop.w * width as f64);
            let cell_h = even_px(crop.h * height as f64);
            let cell_x = crop.x * width as f64;
            let cell_y = crop.y * height as f64;
            let mut local_x = (cell_x - (center_x - box_w / 2.0)).round();
            let mut local_y = (cell_y - (center_y - box_h / 2.0)).round();
            local_x = local_x.clamp(0.0, box_w - 2.0);
            local_y = local_y.clamp(0.0, box_h - 2.0);
            let cw = even_px(cell_w.min(box_w - local_x));
            let ch = even_px(cell_h.min(box_h - local_y));
            parts.push(format!("crop={cw:.0}:{ch:.0}:{local_x:.0}:{local_y:.0}"));
            src_w = cw;
            src_h = ch;
        }
    }
    let rad = tr.rotation.abs() * std::f64::consts::PI / 180.0;
    let rot_w = even_px((src_w * rad.cos()).abs() + (src_h * rad.sin()).abs());
    let rot_h = even_px((src_w * rad.sin()).abs() + (src_h * rad.cos()).abs());
    let angle = (tr.rotation % 360.0) * std::f64::consts::PI / 180.0;
    parts.push(format!(
        "rotate={angle:.6}:ow={rot_w:.0}:oh={rot_h:.0}:c=black@0"
    ));
    let off_x = center_x - rot_w / 2.0;
    let off_y = center_y - rot_h / 2.0;
    let src_x = (-off_x).round().max(0.0);
    let src_y = (-off_y).round().max(0.0);
    let dst_x = off_x.round().max(0.0);
    let dst_y = off_y.round().max(0.0);
    let mut vis_w = even_px((rot_w - src_x).min(width as f64 - dst_x).floor());
    let mut vis_h = even_px((rot_h - src_y).min(height as f64 - dst_y).floor());
    if dst_x + vis_w > width as f64 {
        vis_w = even_px(width as f64 - dst_x);
    }
    if dst_y + vis_h > height as f64 {
        vis_h = even_px(height as f64 - dst_y);
    }
    if src_x + vis_w > rot_w {
        vis_w = even_px(rot_w - src_x);
    }
    if src_y + vis_h > rot_h {
        vis_h = even_px(rot_h - src_y);
    }
    if src_x != 0.0 || src_y != 0.0 || vis_w < rot_w || vis_h < rot_h {
        parts.push(format!(
            "crop={vis_w:.0}:{vis_h:.0}:{src_x:.0}:{src_y:.0}"
        ));
    }
    parts.push(format!(
        "pad={width}:{height}:{dst_x:.0}:{dst_y:.0}:black@0"
    ));
    parts.push("setsar=1".into());
    parts.join(",")
}

/// Scale/rotate/pad a media clip into the output frame honouring its transform.
///
/// Mirrors preview (`mediaGeometry` + CSS): contain-fit, then scale/flip/
/// rotate, centred at transform.x/y. Always lands on an exact `width x height`
/// canvas (pad), so no trailing resample softens the frame — `setsar=1` keeps
/// geometry exact like the preview stage.
fn media_placement_filters(clip: &RenderClipPlan, width: u32, height: u32) -> String {
    if has_geometry_keyframes(&clip.transform_keyframes) {
        return animated_placement_filters(clip, width, height);
    }
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

    if tr.rotation.abs() > 0.01 {
        return rotated_placement_filters(
            clip, width, height, box_w, box_h, center_x, center_y, tr,
        );
    }

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
    let off_x = (center_x - box_w / 2.0).round().max(0.0);
    let off_y = (center_y - box_h / 2.0).round().max(0.0);
    parts.push(format!("pad={width}:{height}:{off_x:.0}:{off_y:.0}:black@0"));
    parts.push("setsar=1".into());
    // Strip cell hard crop (mirrors TS export): isolate the cell, re-pad.
    if let Some(crop) = clip.crop {
        if crop.w > 0.001 && crop.h > 0.001 {
            let cx = (crop.x * width as f64).round().max(0.0);
            let cy = (crop.y * height as f64).round().max(0.0);
            let cw = ((crop.w * width as f64).round().max(2.0) as i64 & !1).max(2) as f64;
            let ch = ((crop.h * height as f64).round().max(2.0) as i64 & !1).max(2) as f64;
            parts.push(format!("crop={cw:.0}:{ch:.0}:{cx:.0}:{cy:.0}"));
            parts.push(format!("pad={width}:{height}:{cx:.0}:{cy:.0}:black@0"));
            parts.push("setsar=1".into());
        }
    }
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
    // Base must be rgba so clip fades (alpha) can composite. Overlay uses
    // format=auto — format=rgb disables alpha blending and kills fade in/out.
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
        blend_mode: String,
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
        let fx = ffmpeg_video_effects_chain_animated(&clip.effects, &clip.effect_keyframes, clip_dur, overlap);
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
            // Short video in a longer slot (strip cells): hold last frame.
            if clip.kind == "video" && clip_ramp_profile(clip).is_none() {
                let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
                let stream_len = ((clip.source_out_sec - clip.source_in_sec) / speed).max(0.01);
                let need = clip_dur + hold - stream_len;
                if need > 0.05 {
                    extras.push(format!("tpad=stop_mode=clone:stop_duration={need:.3}"));
                }
            }
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
        } else if clip.kind == "video" && clip_ramp_profile(clip).is_none() {
            // No transition hold, but source is shorter than the slot.
            let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
            let stream_len = ((clip.source_out_sec - clip.source_in_sec) / speed).max(0.01);
            let need = clip_dur - stream_len;
            if need > 0.05 {
                extras.push(format!("tpad=stop_mode=clone:stop_duration={need:.3}"));
            }
        }
        let extra_part = if extras.is_empty() {
            String::new()
        } else {
            format!(",{}", extras.join(","))
        };
        let placement = media_placement_filters(clip, width, height);
        let animated = has_geometry_keyframes(&clip.transform_keyframes);
        // Shift PTS so stream local 0 lands at timeline `overlay_start`.
        // Without this, `overlay` syncs by PTS: clip 2 (start 5s) would be
        // sampled at PTS 5s (near EOF) during the transition -> black/frozen.
        // The delay goes AFTER fades/tpad so geq `T` windows stay local.
        let delay_part = if overlay_start > 0.0005 {
            format!(",setpts=PTS-STARTPTS+{overlay_start:.3}/TB")
        } else {
            String::new()
        };
        let opacity_part = match linear_track_expr(
            &clip.transform_keyframes,
            "opacity",
            clip_dur,
            opacity,
            0.0,
            "T",
        ) {
            Some(expr) => format!(
                ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({expr})'"
            ),
            None => format!(",colorchannelmixer=aa={opacity:.3}"),
        };
        let head = if animated {
            format!("[{input_index}:v]{setpts},{placement},format=rgba{extra_part}")
        } else {
            format!("[{input_index}:v]{placement},{setpts},format=rgba{extra_part}")
        };
        parts.push(format!("{head}{opacity_part}{delay_part}[v{index}]"));
        prepared.push(Prepared {
            vlabel: format!("[v{index}]"),
            track_order: clip.track_order,
            start,
            overlay_start,
            overlay_end: end + hold,
            blend_mode: clip.transform.blend_mode.clone(),
        });
    }

    // Phase 2: paint in preview stacking order — lower `track_order` paints
    // above (same as layerStackZ / the TS builder); same-track text sits above
    // that track's media. Matches `buildFilterComplex` paint steps in
    // src/domain/ffmpegArgs.ts.
    #[derive(Clone, Copy)]
    enum PaintStep {
        Clip(usize),
        Wash(usize),
        Text(usize),
    }
    struct PaintKey {
        track_order: i32,
        kind_rank: u8, // media (0), wash (1), text (2) on the same track
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
    for (wi, wash) in plan.washes.iter().enumerate() {
        steps.push(PaintKey {
            track_order: wash.track_order,
            kind_rank: 1,
            start: wash.timeline_start_sec.max(0.0),
            step: PaintStep::Wash(wi),
        });
    }
    for (ti, text) in plan.texts.iter().enumerate() {
        steps.push(PaintKey {
            track_order: text.track_order,
            kind_rank: 2,
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
                if let Some(mode) = ffmpeg_blend_mode(&p.blend_mode) {
                    parts.push(format!(
                        "{current}{}blend=all_mode={mode}:all_opacity=1:enable='between(t\\,{:.3}\\,{:.3})'{next}",
                        p.vlabel, p.overlay_start, p.overlay_end
                    ));
                } else {
                    parts.push(format!(
                        "{current}{}overlay=x=0:y=0:format=auto:eof_action=pass:enable='between(t\\,{:.3}\\,{:.3})'{next}",
                        p.vlabel, p.overlay_start, p.overlay_end
                    ));
                }
                current = next;
            }
            PaintStep::Wash(wi) => {
                let wash = &plan.washes[wi];
                let start = wash.timeline_start_sec.max(0.0);
                let end = wash.timeline_end_sec.max(start + 0.01);
                let Some(plate) = wash_plate(
                    &wash.effects,
                    width,
                    height,
                    end.max(plan.duration_sec),
                    fps,
                ) else {
                    continue;
                };
                let opacity = wash.opacity.clamp(0.0, 1.0);
                let alpha = if opacity < 0.999 {
                    format!(",colorchannelmixer=aa={opacity:.3}")
                } else {
                    String::new()
                };
                let layer = format!("[wash{wi}]");
                let next = format!("[wmix{wi}]");
                parts.push(format!("{plate}{alpha}{layer}"));
                parts.push(format!(
                    "{current}{layer}overlay=x=0:y=0:format=auto:eof_action=pass:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
                ));
                current = next;
            }
            PaintStep::Text(ti) => {
                let text = &plan.texts[ti];
                let next = format!("[txt{ti}]");
                if let Some(mode) = ffmpeg_blend_mode(&text.blend_mode) {
                    let start = text.timeline_start_sec.max(0.0);
                    let end = text.timeline_end_sec.max(start + 0.01);
                    let layer = format!("[txtL{ti}]");
                    parts.push(drawtext_on_transparent(text, width, height, &layer));
                    parts.push(format!(
                        "{current}{layer}blend=all_mode={mode}:all_opacity=1:enable='between(t\\,{start:.3}\\,{end:.3})'{next}"
                    ));
                } else {
                    parts.push(drawtext_filter(text, &current, next.clone()));
                }
                current = next;
            }
        }
    }

    if current != "[outv]" {
        // Cinematic bars last (mirrors TS builder + preview overlay %).
        if plan.letterbox.enabled {
            let bar = ffmpeg_color_literal(&plan.letterbox.color);
            let clamp = |v: f64| v.clamp(0.0, 45.0);
            let top = ((clamp(plan.letterbox.top_pct) / 100.0) * height as f64).round() as i64;
            let bottom = ((clamp(plan.letterbox.bottom_pct) / 100.0) * height as f64).round() as i64;
            let left = ((clamp(plan.letterbox.left_pct) / 100.0) * width as f64).round() as i64;
            let right = ((clamp(plan.letterbox.right_pct) / 100.0) * width as f64).round() as i64;
            // Side bars sit *between* top/bottom (same as preview overlay) so
            // corners belong to top/bottom.
            let side_y = top.min(height as i64);
            let side_h = (height as i64 - top - bottom).max(0);
            let mut li = 0usize;
            if top > 0 {
                let next = format!("[lb{li}]");
                li += 1;
                parts.push(format!("{current}drawbox=x=0:y=0:w=iw:h={top}:c={bar}:t=fill{next}"));
                current = next;
            }
            if bottom > 0 {
                let next = format!("[lb{li}]");
                li += 1;
                parts.push(format!("{current}drawbox=x=0:y=ih-{bottom}:w=iw:h={bottom}:c={bar}:t=fill{next}"));
                current = next;
            }
            if left > 0 && side_h > 0 {
                let next = format!("[lb{li}]");
                li += 1;
                parts.push(format!("{current}drawbox=x=0:y={side_y}:w={left}:h={side_h}:c={bar}:t=fill{next}"));
                current = next;
            }
            if right > 0 && side_h > 0 {
                let next = format!("[lb{li}]");
                li += 1;
                parts.push(format!("{current}drawbox=x=iw-{right}:y={side_y}:w={right}:h={side_h}:c={bar}:t=fill{next}"));
                current = next;
            }
        }
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
    // Stream-local pre-roll mirrors the video input construction (constant-
    // speed video inputs fetch `overlap` of early source), so audio fades
    // start after it — same `delay` convention as the video fade chain.
    let overlap = clip.transition_overlap_sec.max(0.0);
    let ramped = clip_ramp_profile(clip).is_some();
    let pre_roll = if clip.kind == "video" && !ramped {
        overlap
    } else {
        0.0
    };
    let clip_dur = (clip.timeline_end_sec - clip.timeline_start_sec).max(0.01);
    let fade = audio_fade_chain(&clip.effects, clip_dur, pre_roll);
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
            "{slice_labels}concat=n={n}:v=0:a=1,{fade}{tail}{label}"
        ));
        return;
    }
    let speed = if clip.speed > 0.0 { clip.speed } else { 1.0 };
    let atempo = atempo_chain(speed);
    parts.push(format!(
        "[{input_index}:a]asetpts=PTS-STARTPTS,{atempo}{fade}{tail}{label}"
    ));
}

/// `afade` pair matching the video fade semantics (same durations, same
/// pre-roll delay). Empty when both fades are ~0.
fn audio_fade_chain(effects: &RenderClipEffects, clip_duration_sec: f64, pre_roll_sec: f64) -> String {
    let dur = clip_duration_sec.max(0.01);
    let pre = pre_roll_sec.max(0.0);
    let mut parts: Vec<String> = Vec::new();
    let fade_in = effects.fade_in_sec.min(dur);
    if fade_in > 0.001 {
        parts.push(format!("afade=t=in:st={pre:.3}:d={fade_in:.3}"));
    }
    let fade_out = effects.fade_out_sec.min(dur);
    if fade_out > 0.001 {
        let st = pre + (dur - fade_out).max(0.0);
        parts.push(format!("afade=t=out:st={st:.3}:d={fade_out:.3}"));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("{},", parts.join(","))
    }
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

/// Resolve a hold-style value at clip-local time `t` from keyframe points
/// (progress 0..1 mapped onto [delay, delay+dur]). Before the first keyframe
/// falls back to `before`.
fn kf_hold_at(points: &[EffectKeyframePoint], delay: f64, dur: f64, t: f64, before: f64) -> f64 {
    let mut sorted: Vec<(f64, f64)> = points
        .iter()
        .filter(|p| p.at_progress.is_finite() && p.value.is_finite())
        .map(|p| {
            (
                delay + p.at_progress.clamp(0.0, 1.0) * dur,
                p.value,
            )
        })
        .collect();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
    let mut v = before;
    for (pt, pv) in sorted {
        if t >= pt {
            v = pv;
        } else {
            break;
        }
    }
    v
}

fn kf_track<'a>(kf: &'a Option<EffectKeyframes>, param: &str) -> Option<Vec<EffectKeyframePoint>> {
    let tracks = kf.as_ref()?.tracks.as_slice();
    for t in tracks {
        if t.param == param {
            let pts = if !t.points.is_empty() { &t.points } else { &t.tracks };
            if !pts.is_empty() {
                return Some(pts.to_vec());
            }
        }
    }
    None
}

/// Step windows where a hold-style param exceeds `threshold`, for filters
/// (gblur/hue/unsharp/vignette/strobe) that cannot take per-frame exprs.
/// `before` is the base effect value applied before the first keyframe
/// (mirrors TS `interpolateParam` fallback).
fn kf_windows(
    points: &[EffectKeyframePoint],
    delay: f64,
    dur: f64,
    threshold: f64,
    before: f64,
) -> Vec<(f64, f64, f64)> {
    let mut sorted: Vec<(f64, f64)> = points
        .iter()
        .filter(|p| p.at_progress.is_finite() && p.value.is_finite())
        .map(|p| (delay + p.at_progress.clamp(0.0, 1.0) * dur, p.value))
        .collect();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
    if sorted.is_empty() {
        return Vec::new();
    }
    let mut edge: Vec<(f64, f64)> = Vec::with_capacity(sorted.len() + 2);
    edge.push((delay, before));
    edge.extend(sorted);
    edge.push((delay + dur, edge.last().map(|e| e.1).unwrap_or(0.0)));
    let mut windows: Vec<(f64, f64, f64)> = Vec::new();
    for w in edge.windows(2) {
        let (a_t, a_v) = w[0];
        let (b_t, _) = w[1];
        if a_v <= threshold || b_t - a_t < 0.005 {
            continue;
        }
        if let Some(last) = windows.last_mut() {
            if (last.2 - a_v).abs() < 0.05 && (last.1 - a_t).abs() < 0.02 {
                last.1 = b_t;
                continue;
            }
        }
        windows.push((a_t, b_t, a_v));
    }
    windows
}

/// Sepia, hue, and tint wash. Mirrors `ffmpegColorGradeChain` in TypeScript.
fn append_color_grade(parts: &mut Vec<String>, effects: &RenderClipEffects) {
    if effects.sepia > 0.02 {
        let t = effects.sepia.clamp(0.0, 1.0);
        let mix = |identity: f64, sepia: f64| identity * (1.0 - t) + sepia * t;
        parts.push(format!(
            "colorchannelmixer=rr={:.3}:rg={:.3}:rb={:.3}:gr={:.3}:gg={:.3}:gb={:.3}:br={:.3}:bg={:.3}:bb={:.3}",
            mix(1.0, 0.393),
            mix(0.0, 0.769),
            mix(0.0, 0.189),
            mix(0.0, 0.349),
            mix(1.0, 0.686),
            mix(0.0, 0.168),
            mix(0.0, 0.272),
            mix(0.0, 0.534),
            mix(1.0, 0.131),
        ));
    }
    if effects.hue_rotate.abs() > 0.5 {
        parts.push(format!(
            "hue=h={:.1}",
            effects.hue_rotate.clamp(-180.0, 180.0)
        ));
    }
    if effects.tint_amount >= 0.02 {
        if let Some(geq) = tint_geq(effects) {
            parts.push(geq);
        }
    }
}

fn tint_geq(effects: &RenderClipEffects) -> Option<String> {
    let amount = effects.tint_amount.clamp(0.0, 1.0);
    let blend = effects.tint_blend.as_str();
    let gradient: Vec<(f64, f64, f64)> = effects
        .tint_gradient
        .iter()
        .filter_map(|stop| parse_hex_rgb(stop))
        .take(6)
        .collect();
    let solid = parse_hex_rgb(&effects.tint_color);
    if gradient.len() < 2 && solid.is_none() {
        return None;
    }
    let expr = |channel: usize, name: &str| {
        let cb = format!("{name}(X,Y)");
        let cs = if gradient.len() >= 2 {
            gradient_channel_expr(&gradient, channel)
        } else {
            let (r, g, b) = solid.unwrap_or((0.0, 0.0, 0.0));
            format!("{:.2}", [r, g, b][channel])
        };
        let a = format!("{amount:.3}");
        let blended = match blend {
            "normal" => format!("({cs})"),
            "multiply" => format!("({cb})*({cs})/255"),
            "screen" => format!("255-(255-{cb})*(255-{cs})/255"),
            "overlay" => format!(
                "if(lt({cb},128),2*({cb})*({cs})/255,255-2*(255-{cb})*(255-{cs})/255)"
            ),
            _ => format!("((255-2*({cs}))*({cb})*({cb})/65025+2*({cs})*({cb})/255)"),
        };
        format!("clip(({cb})*(1-{a})+({blended})*{a},0,255)").replace(',', "\\,")
    };
    Some(format!(
        "geq=r='{}':g='{}':b='{}':a='alpha(X\\,Y)'",
        expr(0, "r"),
        expr(1, "g"),
        expr(2, "b"),
    ))
}

/// Top-to-bottom mix. `Y/H` is 0 at the top stop and 1 at the bottom stop.
fn gradient_channel_expr(stops: &[(f64, f64, f64)], channel: usize) -> String {
    let n = stops.len();
    let span = 1.0 / (n - 1) as f64;
    let sample = |rgb: (f64, f64, f64)| [rgb.0, rgb.1, rgb.2][channel];
    let mut expr = format!("{:.2}", sample(stops[n - 1]));
    for i in (0..n - 1).rev() {
        let t0 = i as f64 * span;
        let t1 = (i + 1) as f64 * span;
        let c0 = sample(stops[i]);
        let c1 = sample(stops[i + 1]);
        let lerp = format!("({c0:.2}+({c1:.2}-{c0:.2})*((Y/H)-{t0:.4})/{span:.4})");
        expr = format!("if(lt((Y/H),{t1:.4}),{lerp},{expr})");
    }
    expr
}

/// Full-frame wash plate. Alpha is the tint amount. None when the wash is off.
fn wash_plate(
    effects: &RenderClipEffects,
    width: u32,
    height: u32,
    dur: f64,
    fps: f64,
) -> Option<String> {
    if effects.tint_amount < 0.02 {
        return None;
    }
    let alpha = (effects.tint_amount.clamp(0.0, 1.0) * 255.0).round();
    let gradient: Vec<(f64, f64, f64)> = effects
        .tint_gradient
        .iter()
        .filter_map(|stop| parse_hex_rgb(stop))
        .take(6)
        .collect();
    let channel = |index: usize| {
        if gradient.len() >= 2 {
            gradient_channel_expr(&gradient, index).replace(',', "\\,")
        } else {
            let (r, g, b) = parse_hex_rgb(&effects.tint_color).unwrap_or((0.0, 0.0, 0.0));
            format!("{:.2}", [r, g, b][index])
        }
    };
    let duration = dur.max(0.01);
    Some(format!(
        "color=c=black:s={width}x{height}:r={}:d={duration:.3},format=rgba,geq=r='{}':g='{}':b='{}':a='{alpha:.0}'",
        format_fps(fps),
        channel(0),
        channel(1),
        channel(2),
    ))
}

fn parse_hex_rgb(color: &str) -> Option<(f64, f64, f64)> {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(hex, 16).ok()?;
    Some((
        ((n >> 16) & 255) as f64,
        ((n >> 8) & 255) as f64,
        (n & 255) as f64,
    ))
}

fn ffmpeg_video_effects_chain_animated(
    effects: &RenderClipEffects,
    keyframes: &Option<EffectKeyframes>,
    clip_duration_sec: f64,
    delay_sec: f64,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let delay = delay_sec.max(0.0);
    let dur = clip_duration_sec.max(0.01);
    let eq_bright = (effects.brightness - 1.0).clamp(-1.0, 1.0);
    // eq supports per-frame expressions; keyframed brightness/contrast/
    // saturation glide via a hold-style `if(lt(t,...))` ladder like TS.
    let b_track = kf_track(keyframes, "brightness");
    let c_track = kf_track(keyframes, "contrast");
    let s_track = kf_track(keyframes, "saturation");
    if b_track.is_some() || c_track.is_some() || s_track.is_some() {
        let b = b_track
            .as_deref()
            .map(|p| kf_hold_at(p, delay, dur, 0.0, 0.0))
            .map(|_| kf_expr_ladder(b_track.as_deref().unwrap(), delay, dur, |v| (v - 1.0).clamp(-1.0, 1.0), eq_bright))
            .unwrap_or_else(|| format!("{eq_bright:.3}"));
        let c = c_track
            .as_deref()
            .map(|p| kf_expr_ladder(p, delay, dur, |v| v, effects.contrast))
            .unwrap_or_else(|| format!("{:.3}", effects.contrast));
        let s = s_track
            .as_deref()
            .map(|p| kf_expr_ladder(p, delay, dur, |v| v, effects.saturation))
            .unwrap_or_else(|| format!("{:.3}", effects.saturation));
        parts.push(format!("eq=brightness='{b}':contrast='{c}':saturation='{s}':eval=frame"));
    } else {
        let need_eq = eq_bright.abs() > 0.001
            || (effects.contrast - 1.0).abs() > 0.001
            || (effects.saturation - 1.0).abs() > 0.001;
        if need_eq {
            parts.push(format!(
                "eq=brightness={eq_bright:.3}:contrast={:.3}:saturation={:.3}",
                effects.contrast, effects.saturation
            ));
        }
    }
    append_color_grade(&mut parts, effects);
    if let Some(p) = kf_track(keyframes, "blur") {
        for (t0, t1, sigma) in kf_windows(&p, delay, dur, 0.05, effects.blur) {
            parts.push(format!(
                "gblur=sigma={:.2}:enable='between(t\\,{t0:.3}\\,{t1:.3})'",
                sigma.min(40.0)
            ));
        }
    } else if effects.blur > 0.05 {
        parts.push(format!("gblur=sigma={:.2}", effects.blur.min(40.0)));
    }
    if let Some(p) = kf_track(keyframes, "grayscale") {
        for (t0, t1, _) in kf_windows(&p, delay, dur, 0.5, if effects.grayscale { 1.0 } else { 0.0 }) {
            parts.push(format!("hue=s=0:enable='between(t\\,{t0:.3}\\,{t1:.3})'"));
        }
    } else if effects.grayscale {
        parts.push("hue=s=0".into());
    }
    if let Some(p) = kf_track(keyframes, "sharpen") {
        for (t0, t1, sigma) in kf_windows(&p, delay, dur, 0.02, effects.sharpen) {
            let amount = (0.5 + sigma).clamp(0.5, 2.5);
            parts.push(format!(
                "unsharp=5:5:{amount:.2}:5:5:0.0:enable='between(t\\,{t0:.3}\\,{t1:.3})'"
            ));
        }
    } else if effects.sharpen > 0.02 {
        let amount = (0.5 + effects.sharpen).clamp(0.5, 2.5);
        parts.push(format!("unsharp=5:5:{amount:.2}:5:5:0.0"));
    }
    if let Some(p) = kf_track(keyframes, "vignette") {
        for (t0, t1, sigma) in kf_windows(&p, delay, dur, 0.02, effects.vignette) {
            let angle = std::f64::consts::PI / 5.0 + (1.0 - sigma.clamp(0.0, 1.0)) * (std::f64::consts::PI / 4.0);
            parts.push(format!(
                "vignette=angle={angle:.4}:mode=backward:enable='between(t\\,{t0:.3}\\,{t1:.3})'"
            ));
        }
    } else if effects.vignette > 0.02 {
        let angle = std::f64::consts::PI / 5.0 + (1.0 - effects.vignette) * (std::f64::consts::PI / 4.0);
        parts.push(format!("vignette=angle={angle:.4}:mode=backward"));
    }
    let strobe_color = effects.strobe_color.trim_start_matches('#');
    if let Some(p) = kf_track(keyframes, "strobeFrames") {
        for (t0, t1, sigma) in kf_windows(&p, delay, dur, 0.5, effects.strobe_frames) {
            let period = (sigma.round() as i64).max(1);
            parts.push(format!(
                "drawbox=x=0:y=0:w=iw:h=ih:color={strobe_color}@1:t=fill:enable='between(t\\,{t0:.3}\\,{t1:.3})*eq(mod(n\\,{period})\\,{})'",
                period - 1
            ));
        }
    } else if effects.strobe_frames.round() > 0.0 {
        let period = (effects.strobe_frames.round() as i64).max(1);
        parts.push(format!(
            "drawbox=x=0:y=0:w=iw:h=ih:color={strobe_color}@1:t=fill:enable='eq(mod(n\\,{period})\\,{})'",
            period - 1
        ));
    }
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

/// Hold-style `if(lt(t,...))` ladder for eq params (mirrors TS ffmpegKeyframeExpr).
fn kf_expr_ladder(
    points: &[EffectKeyframePoint],
    delay: f64,
    dur: f64,
    map: fn(f64) -> f64,
    before: f64,
) -> String {
    let mut mapped: Vec<(f64, f64)> = points
        .iter()
        .filter(|p| p.at_progress.is_finite() && p.value.is_finite())
        .map(|p| (delay + p.at_progress.clamp(0.0, 1.0) * dur, map(p.value)))
        .collect();
    mapped.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal));
    if mapped.is_empty() {
        return format!("{before:.4}");
    }
    if mapped.len() == 1 {
        let (t, v) = mapped[0];
        if (before - v).abs() < 1e-6 {
            return format!("{v:.4}");
        }
        return format!("if(lt(t\\,{t:.4})\\,{before:.4}\\,{v:.4})");
    }
    let mut expr = format!("{:.4}", mapped.last().unwrap().1);
    for w in mapped.windows(2).rev() {
        let (bt, _) = w[1];
        let (at, av) = w[0];
        let _ = at;
        expr = format!("if(lt(t\\,{bt:.4})\\,{av:.4}\\,{expr})");
    }
    let (first_t, _) = mapped[0];
    format!("if(lt(t\\,{first_t:.4})\\,{before:.4}\\,{expr})")
}

fn drawtext_core(text: &RenderTextPlan) -> (String, f64, f64) {
    let start = text.timeline_start_sec.max(0.0);
    let end = text.timeline_end_sec.max(start + 0.01);
    let dur = (end - start).max(0.01);
    let escaped = escape_drawtext(&text.content);
    let fontfile = resolve_drawtext_font(
        text.font_path.as_deref(),
        &text.font_family,
        text.font_weight,
        None,
    )
    .map(|p| format!(":fontfile={}", quote_filter_path(&p)))
    .unwrap_or_default();
    let base_size = if let Some(expr) = linear_track_expr(
        &text.transform_keyframes,
        "scaleX",
        dur,
        1.0,
        start,
        "t",
    ) {
        let size = if text.base_font_size > 0.0 {
            text.base_font_size
        } else {
            text.font_size
        };
        format!("'({size:.3})*abs({expr})'")
    } else {
        format!("{}", text.font_size.max(8.0).round() as i64)
    };
    let color = normalize_color(&text.color);
    let base_alpha = match linear_track_expr(
        &text.transform_keyframes,
        "opacity",
        dur,
        text.opacity.clamp(0.0, 1.0),
        start,
        "t",
    ) {
        Some(expr) => expr,
        None => format!("{:.3}", text.opacity.clamp(0.0, 1.0)),
    };
    let x_base = linear_track_expr(&text.transform_keyframes, "x", dur, text.x, start, "t")
        .unwrap_or_else(|| format!("{}", text.x.max(0.0) as i64));
    let y_base = linear_track_expr(&text.transform_keyframes, "y", dur, text.y, start, "t")
        .unwrap_or_else(|| format!("{}", text.y.max(0.0) as i64));
    let x_expr = drawtext_x_expr(
        &text.align,
        &x_base,
        start,
        dur,
        text.slide_dist,
        &text.text_animation,
    );
    let y_expr = drawtext_y_expr(&y_base, start, dur, text.slide_dist, &text.text_animation);
    let alpha_expr = drawtext_alpha_expr(
        &base_alpha,
        start,
        end,
        text.fade_in_sec,
        text.fade_out_sec,
        &text.text_animation,
    );
    let background = match text.background_color.as_deref() {
        Some(c) if !c.trim().is_empty() => {
            let bw = (text.background_padding.max(0.0).round() as i64).max(2);
            format!(":box=1:boxcolor={}@1:boxborderw={bw}", normalize_color(c))
        }
        _ => String::new(),
    };
    let filter = format!(
        "drawtext=text='{escaped}'{fontfile}:fontsize={base_size}:fontcolor={color}@1:x='{x_expr}':y='{y_expr}':alpha='{alpha_expr}'{background}:enable='between(t\\,{start:.3}\\,{end:.3})'"
    );
    (filter, start, end)
}

fn drawtext_filter(text: &RenderTextPlan, current: &str, next: String) -> String {
    let (filter, _, _) = drawtext_core(text);
    format!("{current}{filter}{next}")
}

/// Transparent full-frame layer with text drawn on it (for non-normal blend modes).
fn drawtext_on_transparent(
    text: &RenderTextPlan,
    width: u32,
    height: u32,
    next: &str,
) -> String {
    let (filter, _, end) = drawtext_core(text);
    let dur = end.max(0.01);
    format!(
        "color=c=black@0:s={width}x{height}:d={dur:.3},format=rgba,{filter}{next}"
    )
}

fn slide_axis_offset(
    anim: &str,
    axis: char,
    start: f64,
    dur: f64,
    out_start: f64,
    out_dur: f64,
    dist: f64,
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
    let d = if dist.is_finite() && dist > 0.0 { dist } else { 48.0 };
    let mut terms: Vec<String> = Vec::new();
    if dur > 0.001 {
        terms.push(format!(
            "{:.1}*(1-min(1\\,max(0\\,(t-{start:.3})/{dur:.3})))",
            sign * d
        ));
    }
    if out_dur > 0.001 {
        terms.push(format!(
            "{:.1}*(min(1\\,max(0\\,(t-{out_start:.3})/{out_dur:.3})))",
            sign * d
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
    x_base: &str,
    start: f64,
    dur: f64,
    slide_dist: f64,
    anim: &RenderTextAnimation,
) -> String {
    let base = match align {
        "left" => x_base.to_string(),
        "right" => format!("({x_base})-text_w"),
        _ => format!("({x_base})-(text_w/2)"),
    };
    let in_dur = anim.in_duration_sec.min(dur);
    let out_dur = anim.out_duration_sec.min(dur);
    let out_start = start + (dur - out_dur).max(0.0);
    let mut off: Vec<String> = Vec::new();
    if let Some(e) = slide_axis_offset(&anim.r#in, 'x', start, in_dur, out_start, 0.0, slide_dist) {
        off.push(e);
    }
    if let Some(e) = slide_axis_offset(&anim.out, 'x', start, 0.0, out_start, out_dur, slide_dist) {
        off.push(e);
    }
    if off.is_empty() {
        base
    } else {
        format!("({base}+{})", off.join("+"))
    }
}

fn drawtext_y_expr(y_base: &str, start: f64, dur: f64, slide_dist: f64, anim: &RenderTextAnimation) -> String {
    let base = format!("({y_base})-(text_h/2)");
    let in_dur = anim.in_duration_sec.min(dur);
    let out_dur = anim.out_duration_sec.min(dur);
    let out_start = start + (dur - out_dur).max(0.0);
    let mut off: Vec<String> = Vec::new();
    if let Some(e) = slide_axis_offset(&anim.r#in, 'y', start, in_dur, out_start, 0.0, slide_dist) {
        off.push(e);
    }
    if let Some(e) = slide_axis_offset(&anim.out, 'y', start, 0.0, out_start, out_dur, slide_dist) {
        off.push(e);
    }
    if off.is_empty() {
        base
    } else {
        format!("({base}+{})", off.join("+"))
    }
}

fn drawtext_alpha_expr(
    base_alpha: &str,
    start: f64,
    end: f64,
    fade_in: f64,
    fade_out: f64,
    anim: &RenderTextAnimation,
) -> String {
    let dur = (end - start).max(0.01);
    let mut terms: Vec<String> = vec![base_alpha.to_string()];
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

fn resolve_drawtext_font(
    font_path: Option<&str>,
    family: &str,
    weight: f64,
    resource_dir: Option<&Path>,
) -> Option<String> {
    if let Some(path) = font_path {
        if Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    // 1) Bundled app fonts (Manrope / JetBrains) — same faces as preview.
    if let Some(file) = bundled_font_file(family, weight) {
        if let Some(resolved) = resolve_bundled_font_path(file, resource_dir) {
            return Some(resolved);
        }
    }
    // 2) System fonts matched by family + weight (Windows / macOS / Linux).
    if let Some(resolved) = resolve_system_font(family, weight) {
        return Some(resolved);
    }
    // 3) Last-resort readable face (still honor bold when possible).
    resolve_system_font("Arial", weight)
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

/// Bundled OFL faces shipped in `public/fonts/` (Tauri `resources`).
/// Same files the frontend lists in `src/lib/fonts.ts` — matched by family
/// name so builtin text never falls back to Arial on export. Weight snaps
/// to the closest shipped face: Bold (700) at ≥ 650, else Regular.
fn bundled_font_file(family: &str, weight: f64) -> Option<&'static str> {
    let f = family.to_lowercase();
    let bold = weight >= 650.0;
    if f.contains("manrope") {
        Some(if bold { "Manrope-Bold.ttf" } else { "Manrope-Variable.ttf" })
    } else if f.contains("jetbrains") {
        Some(if bold {
            "JetBrainsMono-Bold.ttf"
        } else {
            "JetBrainsMono-Variable.ttf"
        })
    } else {
        None
    }
}

/// Map UI font-family names → concrete system TTF paths (regular / bold).
fn system_font_candidates(family: &str, weight: f64) -> Vec<&'static str> {
    let f = family.to_lowercase();
    let bold = weight >= 650.0;
    // Order matters: first existing file wins.
    if f.contains("arial black") {
        return vec![
            "C:/Windows/Fonts/ariblk.ttf",
            "C:/Windows/Fonts/Arial Black.ttf",
        ];
    }
    if f.contains("arial") {
        return if bold {
            vec![
                "C:/Windows/Fonts/arialbd.ttf",
                "C:/Windows/Fonts/Arial Bold.ttf",
                "C:/Windows/Fonts/arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
            ]
        } else {
            vec![
                "C:/Windows/Fonts/arial.ttf",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
            ]
        };
    }
    if f.contains("segoe") {
        return if bold {
            vec![
                "C:/Windows/Fonts/segoeuib.ttf",
                "C:/Windows/Fonts/segoeui.ttf",
            ]
        } else {
            vec!["C:/Windows/Fonts/segoeui.ttf"]
        };
    }
    if f.contains("verdana") {
        return if bold {
            vec![
                "C:/Windows/Fonts/verdanab.ttf",
                "C:/Windows/Fonts/verdana.ttf",
            ]
        } else {
            vec!["C:/Windows/Fonts/verdana.ttf"]
        };
    }
    if f.contains("georgia") {
        return if bold {
            vec![
                "C:/Windows/Fonts/georgiab.ttf",
                "C:/Windows/Fonts/georgia.ttf",
            ]
        } else {
            vec!["C:/Windows/Fonts/georgia.ttf"]
        };
    }
    if f.contains("impact") {
        return vec!["C:/Windows/Fonts/impact.ttf"];
    }
    if f.contains("times") {
        return if bold {
            vec![
                "C:/Windows/Fonts/timesbd.ttf",
                "C:/Windows/Fonts/times.ttf",
            ]
        } else {
            vec!["C:/Windows/Fonts/times.ttf"]
        };
    }
    if f.contains("calibri") {
        return if bold {
            vec![
                "C:/Windows/Fonts/calibrib.ttf",
                "C:/Windows/Fonts/calibri.ttf",
            ]
        } else {
            vec!["C:/Windows/Fonts/calibri.ttf"]
        };
    }
    Vec::new()
}

fn resolve_system_font(family: &str, weight: f64) -> Option<String> {
    system_font_candidates(family, weight)
        .into_iter()
        .find(|p| Path::new(p).is_file())
        .map(|p| p.to_string())
}

/// Resolve a bundled font to a real filesystem path for `drawtext`.
///
/// Prefer `$RESOURCE/fonts/<file>` (mapped in tauri.conf). Also accept the
/// legacy `_up_/public/fonts/` layout and repo paths for `tauri dev`.
fn resolve_bundled_font_path(file: &str, resource_dir: Option<&Path>) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::with_capacity(8);
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("fonts").join(file));
        candidates.push(dir.join("_up_").join("public").join("fonts").join(file));
        candidates.push(dir.join("public").join("fonts").join(file));
        candidates.push(dir.join(file));
        // Deep search: find `<file>` anywhere under the resource dir (max depth 4).
        if let Some(hit) = find_file_named(dir, file, 4) {
            candidates.push(hit);
        }
    }
    candidates.push(PathBuf::from("../public/fonts").join(file));
    candidates.push(PathBuf::from("public/fonts").join(file));
    candidates
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

fn find_file_named(root: &Path, name: &str, max_depth: usize) -> Option<PathBuf> {
    fn walk(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
        if depth == 0 {
            return None;
        }
        let entries = std::fs::read_dir(dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && entry.file_name().to_string_lossy() == name {
                return Some(path);
            }
            if path.is_dir() {
                if let Some(hit) = walk(&path, name, depth - 1) {
                    return Some(hit);
                }
            }
        }
        None
    }
    walk(root, name, max_depth)
}

/// Resolve every text clip to a concrete `font_path` (bundled or system) so
/// drawtext never silently falls back to a different face than preview.
pub fn resolve_plan_fonts(plan: &mut RenderPlan, resource_dir: Option<&Path>) {
    for text in &mut plan.texts {
        if let Some(p) = text.font_path.as_deref() {
            if Path::new(p).is_file() {
                continue;
            }
        }
        if let Some(resolved) =
            resolve_drawtext_font(None, &text.font_family, text.font_weight, resource_dir)
        {
            text.font_path = Some(resolved);
        }
    }
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

/// Copy the audio stream to `dest` (.m4a). Falls back to AAC when stream copy fails.
pub fn extract_audio_file(source: &Path, dest: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err("Media file missing".into());
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let program = ffmpeg_program();
    let src = source.to_string_lossy().to_string();
    let out = dest.to_string_lossy().to_string();
    let copied = silent_command(&program)
        .args(["-y", "-i", &src, "-vn", "-acodec", "copy", &out])
        .output()
        .map_err(|e| format!("ffmpeg failed to start ({e})"))?;
    if copied.status.success() && dest.is_file() {
        return Ok(());
    }
    let _ = std::fs::remove_file(dest);
    let encoded = silent_command(&program)
        .args(["-y", "-i", &src, "-vn", "-c:a", "aac", "-b:a", "192k", &out])
        .output()
        .map_err(|e| format!("ffmpeg failed to start ({e})"))?;
    if encoded.status.success() && dest.is_file() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&encoded.stderr);
    Err(format!("Could not extract audio: {stderr}"))
}

pub(crate) fn media_has_audio_stream(path: &str) -> bool {
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
