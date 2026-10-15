import { ffmpegVideoEffectsChain } from "./effects";
import { mediaGeometry } from "./mediaTransform";
import type { RenderClipPlan, RenderPlan } from "./renderPlan";
import {
  rampOutputDurationSec,
  rampTimeMapSegments,
  type RampExprSegment,
} from "./speedRamp";
import {
  transitionDef,
  transitionDurationSec,
  type TransitionType,
} from "./transitions";

export interface BuiltFfmpegCommand {
  program: string;
  args: string[];
  tempOutput: string;
}

export interface BuildFfmpegOptions {
  /** Defaults to always-true (tests). CLI should pass `existsSync`. */
  fileExists?: (path: string) => boolean;
}

/** Build explicit FFmpeg argv from a render plan (CLI + same semantics as Rust export). */
export function buildFfmpegArgs(
  plan: RenderPlan,
  outputPath: string,
  options?: BuildFfmpegOptions,
): BuiltFfmpegCommand {
  const fileExists = options?.fileExists ?? (() => true);

  if (plan.missingAssetIds.length > 0) {
    throw new Error("Project has missing media; relink before export");
  }
  if (plan.durationSec <= 0) {
    throw new Error("Render duration must be > 0");
  }

  const width = Math.max(2, plan.width - (plan.width % 2));
  const height = Math.max(2, plan.height - (plan.height % 2));
  const fps = plan.frameRate > 0 ? plan.frameRate : 30;
  const duration = plan.durationSec;

  const visuals = plan.clips
    .filter((c) => c.kind === "video" || c.kind === "image")
    .slice()
    .sort(
      (a, b) =>
        a.trackOrder - b.trackOrder || a.timelineStartSec - b.timelineStartSec,
    );

  const audios = plan.clips.filter(
    (c) => c.includeAudio && (c.kind === "audio" || c.kind === "video"),
  );

  for (const clip of [...visuals, ...audios]) {
    if (clip.assetPath.startsWith("blob:")) {
      throw new Error("Cannot export browser blob URLs; use filesystem paths");
    }
    if (!fileExists(clip.assetPath)) {
      throw new Error(`Media file missing: ${clip.assetPath}`);
    }
  }

  const tempOutput = outputPath.replace(/(\.mp4)?$/i, ".tmp.mp4");
  const args: string[] = ["-y", "-hide_banner"];

  const baseColor = ffmpegColorLiteral(plan.backgroundColor);
  args.push(
    "-f",
    "lavfi",
    "-i",
    `color=c=${baseColor}:s=${width}x${height}:d=${duration}:r=${fps}`,
  );

  for (const clip of visuals) {
    const overlap = Math.max(0, clip.transitionOverlapSec);
    const sourceDur = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
    if (clip.kind === "image") {
      // Hold for outgoing transition is added via tpad in the filter graph.
      const clipDur =
        Math.max(0.01, clip.timelineEndSec - clip.timelineStartSec) + overlap;
      args.push("-loop", "1", "-t", clipDur.toFixed(3), "-i", clip.assetPath);
    } else {
      // Ramped clips skip transition pre-roll so the setpts curve maps cleanly
      // from sourceIn (u = 0). Constant-speed clips keep the original pre-roll.
      const speed = clip.speed > 0 ? clip.speed : 1;
      const earlySource = clip.speedRamp ? 0 : overlap * speed;
      const ss = Math.max(0, clip.sourceInSec - earlySource);
      const trimmedEarly = clip.sourceInSec - ss;
      args.push(
        "-ss",
        ss.toFixed(3),
        "-t",
        (sourceDur + trimmedEarly).toFixed(3),
        "-i",
        clip.assetPath,
      );
    }
  }

  const audioOnly: { inputIndex: number; clip: RenderClipPlan }[] = [];
  let audioOnlyOffset = 1 + visuals.length;
  for (const clip of audios) {
    if (clip.kind !== "audio") continue;
    const sourceDur = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
    args.push(
      "-ss",
      Math.max(0, clip.sourceInSec).toFixed(3),
      "-t",
      sourceDur.toFixed(3),
      "-i",
      clip.assetPath,
    );
    audioOnly.push({ inputIndex: audioOnlyOffset, clip });
    audioOnlyOffset += 1;
  }

  const filter = buildFilterComplex(plan, visuals, audioOnly, width, height, fileExists);
  args.push("-filter_complex", filter, "-map", "[outv]");

  if (audios.length > 0) {
    args.push("-map", "[outa]", "-c:a", "aac", "-b:a", plan.audioBitrate);
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-b:v",
    plan.videoBitrate,
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    tempOutput,
  );

  return { program: "ffmpeg", args, tempOutput };
}

/** Map editor transition → FFmpeg xfade name (null = hard cut / concat). */
function xfadeTransitionName(type: TransitionType): string | null {
  return transitionDef(type).xfade;
}

/** Normalise a hex colour to an FFmpeg `color=` literal. */
function ffmpegColorLiteral(color: string): string {
  const trimmed = (color ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return `0x${trimmed.slice(1)}`;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1);
    return `0x${r}${r}${g}${g}${b}${b}`;
  }
  return "black";
}

function buildFilterComplex(
  plan: RenderPlan,
  visuals: RenderClipPlan[],
  audioOnly: { inputIndex: number; clip: RenderClipPlan }[],
  width: number,
  height: number,
  fileExists: (path: string) => boolean,
): string {
  const parts: string[] = [];
  parts.push(`[0:v]format=rgba[base]`);
  let current = "[base]";

  // Group media by track (already sorted by trackOrder, then start).
  const trackIds: string[] = [];
  const byTrack = new Map<string, { clip: RenderClipPlan; inputIndex: number }[]>();
  const trackOrderById = new Map<string, number>();
  visuals.forEach((clip, index) => {
    const inputIndex = index + 1;
    if (!byTrack.has(clip.trackId)) {
      byTrack.set(clip.trackId, []);
      trackIds.push(clip.trackId);
      trackOrderById.set(clip.trackId, clip.trackOrder);
    }
    byTrack.get(clip.trackId)!.push({ clip, inputIndex });
  });

  // Interleave video tracks and text by trackOrder so export matches preview
  // stacking (higher order on top; same-track text above that track's media).
  type PaintStep =
    | {
        kind: "track";
        trackOrder: number;
        trackId: string;
        trackIndex: number;
      }
    | { kind: "text"; trackOrder: number; textIndex: number; text: (typeof plan.texts)[number] };

  const steps: PaintStep[] = [
    ...trackIds.map((trackId, trackIndex) => ({
      kind: "track" as const,
      trackOrder: trackOrderById.get(trackId) ?? trackIndex,
      trackId,
      trackIndex,
    })),
    ...plan.texts.map((text, textIndex) => ({
      kind: "text" as const,
      trackOrder: text.trackOrder,
      textIndex,
      text,
    })),
  ];
  steps.sort((a, b) => {
    // Paint high order first (behind), low order last (on top) — matches preview.
    if (a.trackOrder !== b.trackOrder) return b.trackOrder - a.trackOrder;
    // Same track: media before text (matches layerStackZ).
    if (a.kind !== b.kind) return a.kind === "track" ? -1 : 1;
    return 0;
  });

  let mixCount = 0;
  for (const step of steps) {
    if (step.kind === "track") {
      const group = byTrack.get(step.trackId)!;
      const trackLabel = buildTrackChain(
        parts,
        group,
        width,
        height,
        step.trackIndex,
      );
      const next = `[mix${mixCount}]`;
      mixCount += 1;
      parts.push(
        `${current}${trackLabel}overlay=x=0:y=0:format=rgb:eof_action=pass${next}`,
      );
      current = next;
      continue;
    }

    const text = step.text;
    const start = Math.max(0, text.timelineStartSec);
    const end = Math.max(start + 0.01, text.timelineEndSec);
    const escaped = escapeDrawtext(text.content);
    const resolvedFont = resolveDrawtextFont(text.fontPath, fileExists);
    const fontfile = resolvedFont
      ? `:fontfile=${quoteFilterPath(resolvedFont)}`
      : "";
    const baseSize = Math.max(8, Math.round(text.fontSize));
    const color = normalizeColor(text.color);
    const alpha = Math.min(1, Math.max(0, text.opacity)).toFixed(3);
    const xExpr =
      text.align === "left"
        ? `${Math.max(0, Math.round(text.x))}`
        : text.align === "right"
          ? `${Math.max(0, Math.round(text.x))}-text_w`
          : `${Math.max(0, Math.round(text.x))}-(text_w/2)`;
    const yExpr = `${Math.max(0, Math.round(text.y))}-(text_h/2)`;
    const next = `[txt${step.textIndex}]`;
    parts.push(
      `${current}drawtext=text='${escaped}'${fontfile}:fontsize=${baseSize}:fontcolor=${color}@1:x='${xExpr}':y='${yExpr}':alpha=${alpha}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${next}`,
    );
    current = next;
  }

  if (current !== "[outv]") {
    parts.push(`${current}null[outv]`);
  }

  const audioLabels: string[] = [];
  let ai = 0;

  visuals.forEach((clip, index) => {
    if (clip.kind !== "video" || !clip.includeAudio) return;
    const inputIndex = index + 1;
    const startMs = Math.round(Math.max(0, clip.timelineStartSec) * 1000);
    const vol = Math.min(2, Math.max(0, clip.volume));
    const label = `[a${ai}]`;
    appendAudioChain(parts, inputIndex, clip, plan.durationSec, startMs, vol, label);
    audioLabels.push(label);
    ai += 1;
  });

  for (const { inputIndex, clip } of audioOnly) {
    if (!clip.includeAudio) continue;
    const startMs = Math.round(Math.max(0, clip.timelineStartSec) * 1000);
    const vol = Math.min(2, Math.max(0, clip.volume));
    const label = `[a${ai}]`;
    appendAudioChain(parts, inputIndex, clip, plan.durationSec, startMs, vol, label);
    audioLabels.push(label);
    ai += 1;
  }

  if (audioLabels.length === 1) {
    parts.push(`${audioLabels[0]}anull[outa]`);
  } else if (audioLabels.length > 1) {
    parts.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:dropout_transition=0:normalize=0[outa]`,
    );
  }

  return parts.join(";");
}

/**
 * Scale/rotate/pad a media clip into the output frame honouring its transform.
 *
 * Always lands on a full `width x height` rgba canvas so xfade/concat stay valid.
 * The transform is expressed in project-canvas px; we rescale to output px.
 */
export function mediaPlacementFilters(
  clip: RenderClipPlan,
  width: number,
  height: number,
): string {
  const geom = mediaGeometry(clip.transform, clip.canvasWidth, clip.canvasHeight, {
    width: clip.mediaWidth,
    height: clip.mediaHeight,
  });
  // Project-canvas → output scale.
  const outScaleX = width / Math.max(1, clip.canvasWidth);
  const outScaleY = height / Math.max(1, clip.canvasHeight);
  const boxW = Math.max(2, Math.round(geom.boxWidth * outScaleX) & ~1);
  const boxH = Math.max(2, Math.round(geom.boxHeight * outScaleY) & ~1);
  const centerX = geom.centerX * outScaleX;
  const centerY = geom.centerY * outScaleY;

  const parts: string[] = [];
  // Fit source into the (scaled) box, then rotate if needed.
  parts.push(`scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease`);
  if (Math.abs(geom.rotation) > 0.01) {
    // Rotate onto a transparent canvas big enough to avoid clipping, then the
    // final pad below recentres it on the frame.
    const rad = (Math.abs(geom.rotation) * Math.PI) / 180;
    const rw = Math.round((Math.abs(boxW * Math.cos(rad)) + Math.abs(boxH * Math.sin(rad))) & ~1);
    const rh = Math.round((Math.abs(boxW * Math.sin(rad)) + Math.abs(boxH * Math.cos(rad))) & ~1);
    const angle = ((geom.rotation % 360) * Math.PI) / 180;
    parts.push(
      `rotate=${angle.toFixed(6)}:ow=${Math.max(boxW, rw)}:oh=${Math.max(boxH, rh)}:c=black@0`,
    );
  }
  const offX = Math.max(0, Math.round(centerX - boxW / 2));
  const offY = Math.max(0, Math.round(centerY - boxH / 2));
  parts.push(`pad=${width}:${height}:${offX}:${offY}:black@0`);
  parts.push(`scale=${width}:${height}`);
  return parts.join(",");
}

/**
 * Build one video track: prepare clips, chain with xfade (matches preview transitions).
 * Returns a label like `[trk0]` whose PTS starts at timeline 0 (leading black pad if needed).
 */
function buildTrackChain(
  parts: string[],
  group: { clip: RenderClipPlan; inputIndex: number }[],
  width: number,
  height: number,
  trackIndex: number,
): string {
  const origin = group[0]!.clip.timelineStartSec;

  group.forEach(({ clip, inputIndex }, i) => {
    const start = Math.max(0, clip.timelineStartSec);
    const end = Math.max(start + 0.01, clip.timelineEndSec);
    const opacity = Math.min(1, Math.max(0, clip.opacity));
    const early = Math.max(0, clip.transitionOverlapSec);
    const clipDur = Math.max(0.01, end - start);
    const next = group[i + 1]?.clip;
    const hold =
      next && next.transitionIn.type !== "none"
        ? Math.max(0, next.transitionOverlapSec)
        : 0;
    const setpts = clipSetpts(clip);

    const fx = ffmpegVideoEffectsChain(clip.effects, clipDur, {
      delaySec: early,
    });
    const bits: string[] = [
      `[${inputIndex}:v]${mediaPlacementFilters(clip, width, height)}`,
      setpts,
      "format=rgba",
    ];
    if (fx) bits.push(fx);

    // First clip on track with transitionIn: RGB fade from black (preview over empty stage).
    if (i === 0 && early > 0.001 && clip.transitionIn.type !== "none") {
      const inFull = transitionDurationSec(clip.transitionIn);
      if (clip.transitionIn.type === "fade") {
        bits.push(
          `fade=t=in:st=${(inFull / 2).toFixed(3)}:d=${(inFull / 2).toFixed(3)}`,
        );
      } else {
        bits.push(`fade=t=in:st=0:d=${inFull.toFixed(3)}`);
      }
    }

    if (hold > 0.001) {
      bits.push(`tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`);
    }
    if (opacity < 0.999) {
      bits.push(`colorchannelmixer=aa=${opacity.toFixed(3)}`);
    }
    parts.push(`${bits.join(",")}[c${trackIndex}_${i}]`);
  });

  let acc = `[c${trackIndex}_0]`;
  for (let i = 1; i < group.length; i += 1) {
    const curr = group[i]!.clip;
    const xname = xfadeTransitionName(curr.transitionIn.type);
    const out =
      i === group.length - 1 ? `[xf${trackIndex}_last]` : `[xf${trackIndex}_${i}]`;
    const useXfade = xname && curr.transitionOverlapSec > 0.001;

    if (useXfade) {
      const dur = transitionDurationSec(curr.transitionIn);
      const offset = Math.max(
        0,
        curr.timelineStartSec - origin - curr.transitionOverlapSec,
      );
      parts.push(
        `${acc}[c${trackIndex}_${i}]xfade=transition=${xname}:duration=${dur.toFixed(3)}:offset=${offset.toFixed(3)}${out}`,
      );
    } else {
      // Hard cut — concatenate (clips should abut).
      parts.push(`${acc}[c${trackIndex}_${i}]concat=n=2:v=1:a=0${out}`);
    }
    acc = out;
  }

  const trackOut = `[trk${trackIndex}]`;
  if (origin > 0.001) {
    parts.push(
      `${acc}tpad=start_mode=add:start_duration=${origin.toFixed(3)}:color=black@0${trackOut}`,
    );
  } else if (acc !== trackOut) {
    parts.push(`${acc}null${trackOut}`);
  }
  return trackOut;
}

/**
 * Build the `setpts` filter for a clip.
 *
 * - No ramp → constant-speed division (or identity when speed ≈ 1).
 * - Ramp → a piecewise-quadratic expression of the source offset
 *   `u = (PTS-STARTPTS)/1e6`, so output PTS follows ∫ds/v exactly like preview.
 */
export function clipSetpts(clip: RenderClipPlan): string {
  const speed = clip.speed > 0 ? clip.speed : 1;
  if (!clip.speedRamp) {
    return Math.abs(speed - 1) < 0.001
      ? "setpts=PTS-STARTPTS"
      : `setpts=(PTS-STARTPTS)/${formatNum(speed)}`;
  }

  const sourceSpanSec = Math.max(0.001, clip.sourceOutSec - clip.sourceInSec);
  const segments = rampTimeMapSegments(clip.speedRamp, sourceSpanSec);
  if (segments.length === 0) {
    return "setpts=PTS-STARTPTS";
  }

  // Invert: output timeline t → source offset u (smallest segment whose T(u) ≥ t).
  let expr = `((PTS-STARTPTS)/1000000)`;
  for (let k = segments.length - 1; k >= 0; k -= 1) {
    const seg = segments[k];
    const inner = quadInverseExpr(seg, "t");
    expr = `if(gte(t\\,${formatNum(seg.tStart)})\\,${inner}\\,${expr})`;
  }
  return `setpts=((${expr})*1000000)+STARTPTS`;
}

/**
 * Expression for the source offset u given output time `tVar`, valid inside this
 * segment: solving t = tStart + a·du + b·du² gives
 *   du = (−a + √(a² + 4b·(t−tStart))) / (2b),
 * choosing the + root so du → 0 as t → tStart.
 */
function quadInverseExpr(seg: RampExprSegment, tVar: string): string {
  const dt = `(${tVar}-${formatNum(seg.tStart)})`;
  const a = formatNum(seg.a);
  const bRaw = Math.abs(seg.b) < 1e-12 ? 1e-12 : seg.b;
  const b = formatNum(bRaw);
  const u0 = formatNum(seg.uStart);
  const disc = `(${formatNum(seg.a * seg.a)}+4*${b}*${dt})`;
  const root = `sqrt(max(0\\,${disc}))`;
  return `${u0}+(-(${a})+${root})/(2*${b})`;
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // Trim trailing zeros while keeping enough precision for sub-ms accuracy.
  return Number(value.toFixed(6)).toString();
}

function atempoChain(speed: number): string {
  if (Math.abs(speed - 1) < 0.001) return "";
  let remaining = speed;
  const filters: string[] = [];
  while (remaining > 2 + 1e-6) {
    filters.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-6) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return `${filters.join(",")},`;
}

/**
 * Append a clip's audio chain to the filter graph.
 *
 * Constant speed → one `atempo` chain.
 * Ramped → split the source into short constant-speed slices, retime each with a
 * slice-local `atempo`, and `concat` them (FFmpeg's `atempo` cannot take an
 * expression). N slices keep per-slice drift small and the graph bounded.
 */
function appendAudioChain(
  parts: string[],
  inputIndex: number,
  clip: RenderClipPlan,
  outputDurationSec: number,
  startMs: number,
  volume: number,
  outLabel: string,
): void {
  const tail = `volume=${volume},adelay=${startMs}|${startMs},apad,atrim=0:${outputDurationSec.toFixed(3)}`;

  if (!clip.speedRamp) {
    const speed = clip.speed > 0 ? clip.speed : 1;
    parts.push(`[${inputIndex}:a]asetpts=PTS-STARTPTS,${atempoChain(speed)}${tail}${outLabel}`);
    return;
  }

  const span = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
  const segments = rampTimeMapSegments(clip.speedRamp, span, 12);
  const n = segments.length;
  const sliceDur = span / n;

  for (let i = 0; i < n; i += 1) {
    const outEnd =
      i + 1 < n ? segments[i + 1].tStart : rampOutputDurationSec(clip.speedRamp, span);
    const outDur = Math.max(0.02, outEnd - segments[i].tStart);
    const speed = Math.max(0.01, sliceDur / outDur);
    parts.push(
      `[${inputIndex}:a]atrim=${segments[i].uStart.toFixed(3)}:${segments[i].uEnd.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,${atempoChain(speed)}asetpts=PTS-STARTPTS[ras${inputIndex}_${i}]`,
    );
  }
  const sliceLabels = Array.from(
    { length: n },
    (_, i) => `[ras${inputIndex}_${i}]`,
  ).join("");
  parts.push(`${sliceLabels}concat=n=${n}:v=0:a=1,${tail}${outLabel}`);
}

/** FFmpeg drawtext needs a real TTF/OTF path; UI fonts like Manrope often have none. */
function resolveDrawtextFont(
  fontPath: string | null,
  fileExists: (path: string) => boolean,
): string | null {
  if (fontPath && fileExists(fontPath)) return fontPath;
  const fallbacks = [
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  for (const candidate of fallbacks) {
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function escapeDrawtext(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "%%")
    .replace(/\n/g, "\\n");
}

function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** Quote a filesystem path for FFmpeg filter option values (fontfile=…). */
function quoteFilterPath(path: string): string {
  return `'${escapeFilterPath(path).replace(/'/g, "\\'")}'`;
}

function normalizeColor(color: string): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") && (trimmed.length === 7 || trimmed.length === 4)) {
    return `0x${trimmed.slice(1)}`;
  }
  return "white";
}
