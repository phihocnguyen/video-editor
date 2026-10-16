import { blendModeToFfmpeg, normalizeBlendMode } from "./blendModes";
import { ffmpegVideoEffectsChainAnimated } from "./effectKeyframes";
import { ffmpegWashPlate } from "./effects";
import { bundledFontFileForFamily } from "../lib/fonts";
import { containFitBox, mediaCenter, mediaGeometry } from "./mediaTransform";
import {
  ffmpegLinearExpr,
  getTransformTrack,
  hasGeometryKeyframes,
  type TransformParamKey,
} from "./transformKeyframes";
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

  const filter = buildFilterComplex(plan, visuals, audioOnly, width, height, fps, fileExists);
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
  fps: number,
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
    | { kind: "wash"; trackOrder: number; washIndex: number; wash: (typeof plan.washes)[number] }
    | { kind: "text"; trackOrder: number; textIndex: number; text: (typeof plan.texts)[number] };

  const paintRank = (kind: PaintStep["kind"]) =>
    kind === "track" ? 0 : kind === "wash" ? 1 : 2;

  const steps: PaintStep[] = [
    ...trackIds.map((trackId, trackIndex) => ({
      kind: "track" as const,
      trackOrder: trackOrderById.get(trackId) ?? trackIndex,
      trackId,
      trackIndex,
    })),
    ...plan.washes.map((wash, washIndex) => ({
      kind: "wash" as const,
      trackOrder: wash.trackOrder,
      washIndex,
      wash,
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
    // Same track: media, then the wash, then text (matches layerStackZ).
    return paintRank(a.kind) - paintRank(b.kind);
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
      const trackBlend = resolveGroupBlendMode(group);
      const ffmpegBlend = blendModeToFfmpeg(trackBlend);
      parts.push(
        ffmpegBlend
          ? `${current}${trackLabel}blend=all_mode=${ffmpegBlend}:all_opacity=1:shortest=0${next}`
          : `${current}${trackLabel}overlay=x=0:y=0:format=auto:eof_action=pass${next}`,
      );
      current = next;
      continue;
    }

    if (step.kind === "wash") {
      const wash = step.wash;
      const start = Math.max(0, wash.timelineStartSec);
      const end = Math.max(start + 0.01, wash.timelineEndSec);
      const plate = ffmpegWashPlate(
        wash.effects,
        width,
        height,
        Math.max(end, plan.durationSec),
        fps,
      );
      if (!plate) continue;
      const layer = `[wash${step.washIndex}]`;
      const next = `[wmix${step.washIndex}]`;
      const opacity = Math.min(1, Math.max(0, wash.opacity));
      const alpha =
        opacity < 0.999 ? `,colorchannelmixer=aa=${opacity.toFixed(3)}` : "";
      parts.push(`${plate}${alpha}${layer}`);
      parts.push(
        `${current}${layer}overlay=x=0:y=0:format=auto:eof_action=pass:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${next}`,
      );
      current = next;
      continue;
    }

    const text = step.text;
    const start = Math.max(0, text.timelineStartSec);
    const end = Math.max(start + 0.01, text.timelineEndSec);
    const escaped = escapeDrawtext(text.content);
    const resolvedFont = resolveDrawtextFont(text.fontPath, fileExists, text.fontFamily, text.fontWeight);
    const fontfile = resolvedFont
      ? `:fontfile=${quoteFilterPath(resolvedFont)}`
      : "";
    const textDur = Math.max(0.01, end - start);
    const xTrack = getTransformTrack(text.transformKeyframes, "x");
    const yTrack = getTransformTrack(text.transformKeyframes, "y");
    const scaleTrack = getTransformTrack(text.transformKeyframes, "scaleX");
    const opacityTrack = getTransformTrack(text.transformKeyframes, "opacity");
    const xValue = xTrack
      ? (ffmpegLinearExpr(xTrack.points, textDur, text.x, start, "t") ?? text.x.toFixed(2))
      : String(Math.max(0, Math.round(text.x)));
    const yValue = yTrack
      ? (ffmpegLinearExpr(yTrack.points, textDur, text.y, start, "t") ?? text.y.toFixed(2))
      : String(Math.max(0, Math.round(text.y)));
    const baseSize = scaleTrack
      ? `'(${(text.baseFontSize || text.fontSize).toFixed(3)})*abs(${ffmpegLinearExpr(scaleTrack.points, textDur, 1, start, "t") ?? "1"})'`
      : String(Math.max(8, Math.round(text.fontSize)));
    const color = normalizeColor(text.color);
    const opacityExpr = opacityTrack
      ? (ffmpegLinearExpr(
          opacityTrack.points,
          textDur,
          Math.min(1, Math.max(0, text.opacity)),
          start,
          "t",
        ) ?? text.opacity.toFixed(3))
      : Math.min(1, Math.max(0, text.opacity));
    const xExpr = xTrack ? drawtextXExpr(text, xValue) : drawtextXExpr(text);
    const yExpr = yTrack ? drawtextYExpr(text, yValue) : drawtextYExpr(text);
    const alphaExpr = drawtextAlphaExpr(text, start, end, opacityExpr);
    const box =
      text.backgroundColor && text.backgroundColor.length > 0
        ? `:box=1:boxcolor=${normalizeColor(text.backgroundColor)}@1:boxborderw=${Math.max(2, Math.round(text.backgroundPadding || 12))}`
        : "";
    const next = `[txt${step.textIndex}]`;
    const textBlend = blendModeToFfmpeg(text.blendMode);
    // italic / underline / strikethrough are preview+UI only in v1 (no drawbox/oblique face).
    // listStyle prefixes are already baked into `text.content`.
    const drawtext =
      `drawtext=text='${escaped}'${fontfile}:fontsize=${baseSize}:fontcolor=${color}@1:x='${xExpr}':y='${yExpr}':alpha='${alphaExpr}'${box}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'`;
    if (textBlend) {
      // Rasterize text onto a transparent frame, then blend onto the mix.
      const layer = `[txtL${step.textIndex}]`;
      parts.push(
        `color=c=black@0:s=${width}x${height}:d=${Math.max(end, 0.01).toFixed(3)},format=rgba,${drawtext}${layer}`,
      );
      parts.push(
        `${current}${layer}blend=all_mode=${textBlend}:all_opacity=1:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'${next}`,
      );
    } else {
      parts.push(`${current}${drawtext}${next}`);
    }
    current = next;
  }

  if (current !== "[outv]") {
    // Cinematic bars (Sony Vegas style) — painted dead last so they cover
    // every layer exactly like the draggable preview overlay (% of output).
    const lb = plan.letterbox;
    if (lb && lb.enabled) {
      const bar = ffmpegColorLiteral(lb.color ?? "#000000");
      const top = Math.round((Math.min(45, Math.max(0, lb.topPct)) / 100) * height);
      const bottom = Math.round((Math.min(45, Math.max(0, lb.bottomPct)) / 100) * height);
      const left = Math.round((Math.min(45, Math.max(0, lb.leftPct)) / 100) * width);
      const right = Math.round((Math.min(45, Math.max(0, lb.rightPct)) / 100) * width);
      const next = (i: number) => `[lb${i}]`;
      let li = 0;
      let cur = current;
      if (top > 0) {
        const n = next(li++);
        parts.push(`${cur}drawbox=x=0:y=0:w=iw:h=${top}:c=${bar}:t=fill${n}`);
        cur = n;
      }
      if (bottom > 0) {
        const n = next(li++);
        parts.push(`${cur}drawbox=x=0:y=ih-${bottom}:w=iw:h=${bottom}:c=${bar}:t=fill${n}`);
        cur = n;
      }
      if (left > 0) {
        const n = next(li++);
        parts.push(`${cur}drawbox=x=0:y=0:w=${left}:h=ih:c=${bar}:t=fill${n}`);
        cur = n;
      }
      if (right > 0) {
        const n = next(li++);
        parts.push(`${cur}drawbox=x=iw-${right}:y=0:w=${right}:h=ih:c=${bar}:t=fill${n}`);
        cur = n;
      }
      current = cur;
    }
    // Force constant frame rate = canvas fps so motion matches preview
    // (sources may be VFR or a different fps; lavfi base alone doesn't fix it).
    parts.push(`${current}fps=${formatFps(fps)}[outv]`);
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
  if (hasGeometryKeyframes(clip.transformKeyframes)) {
    return animatedPlacementFilters(clip, width, height);
  }
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
  // Fit source into the (scaled) box, then flip / rotate if needed.
  // lanczos keeps downscaled sources (e.g. 4K → 1080p) sharp like preview.
  parts.push(
    `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease:flags=lanczos`,
  );
  if (geom.scaleX < 0) parts.push("hflip");
  if (geom.scaleY < 0) parts.push("vflip");
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
  // pad already yields exactly width x height — a trailing scale would force a
  // redundant full-frame resample (softening). setsar keeps geometry exact.
  parts.push("setsar=1");
  return parts.join(",");
}

/**
 * Time-varying scale / rotate / pad. The clip stays a full frame so xfade and
 * concat keep matching sizes; pad x/y is the animated layer position (the same
 * result as overlaying an unpadded clip). `t` is clip-local because setpts
 * runs before this chain.
 */
function animatedPlacementFilters(
  clip: RenderClipPlan,
  width: number,
  height: number,
): string {
  const cw = Math.max(1, clip.canvasWidth);
  const ch = Math.max(1, clip.canvasHeight);
  const fit = containFitBox(cw, ch, clip.mediaWidth, clip.mediaHeight);
  const outScaleX = width / cw;
  const outScaleY = height / ch;
  const fitW = fit.width * outScaleX;
  const fitH = fit.height * outScaleY;
  const dur = Math.max(0.01, clip.timelineEndSec - clip.timelineStartSec);
  const center = mediaCenter(clip.transform, cw, ch);
  const xTracked = Boolean(getTransformTrack(clip.transformKeyframes, "x"));
  const yTracked = Boolean(getTransformTrack(clip.transformKeyframes, "y"));

  const scaleXExpr = paramExpr(clip, "scaleX", clip.transform.scaleX, dur);
  const scaleYExpr = paramExpr(clip, "scaleY", clip.transform.scaleY, dur);
  const boxW = getTransformTrack(clip.transformKeyframes, "scaleX")
    ? evenExpr(`${fitW.toFixed(4)}*abs(${scaleXExpr})`)
    : evenNum(fitW * Math.abs(clip.transform.scaleX || 1));
  const boxH = getTransformTrack(clip.transformKeyframes, "scaleY")
    ? evenExpr(`${fitH.toFixed(4)}*abs(${scaleYExpr})`)
    : evenNum(fitH * Math.abs(clip.transform.scaleY || 1));

  const centerX = xTracked
    ? `(${paramExpr(clip, "x", clip.transform.x, dur)})*${outScaleX.toFixed(6)}`
    : (center.x * outScaleX).toFixed(3);
  const centerY = yTracked
    ? `(${paramExpr(clip, "y", clip.transform.y, dur)})*${outScaleY.toFixed(6)}`
    : (center.y * outScaleY).toFixed(3);

  const parts: string[] = [
    `scale=w='${boxW}':h='${boxH}':eval=frame:flags=lanczos`,
  ];
  if (clip.transform.scaleX < 0) parts.push("hflip");
  if (clip.transform.scaleY < 0) parts.push("vflip");

  const rotTracked = Boolean(getTransformTrack(clip.transformKeyframes, "rotation"));
  const rot = clip.transform.rotation;
  let padW = boxW;
  let padH = boxH;
  if (rotTracked || Math.abs(rot) > 0.01) {
    const rotExpr = paramExpr(clip, "rotation", rot, dur);
    const rad = `(${rotExpr})*0.0174533`;
    const ow = `abs((${boxW})*cos(abs(${rad})))+abs((${boxH})*sin(abs(${rad})))`;
    const oh = `abs((${boxW})*sin(abs(${rad})))+abs((${boxH})*cos(abs(${rad})))`;
    parts.push(`rotate=${rad}:ow='${ow}':oh='${oh}':c=black@0:eval=frame`);
    padW = ow;
    padH = oh;
  }
  const offX = `(${centerX})-(${padW})/2`;
  const offY = `(${centerY})-(${padH})/2`;
  parts.push(
    `pad=${width}:${height}:x='${offX}':y='${offY}':color=black@0:eval=frame`,
  );
  parts.push("setsar=1");
  return parts.join(",");
}

function paramExpr(
  clip: RenderClipPlan,
  param: TransformParamKey,
  before: number,
  clipDur: number,
  timeVar = "t",
  tOrigin = 0,
): string {
  const track = getTransformTrack(clip.transformKeyframes, param);
  if (!track) return before.toFixed(4);
  return ffmpegLinearExpr(track.points, clipDur, before, tOrigin, timeVar) ?? before.toFixed(4);
}

function evenExpr(inner: string): string {
  return `max(2\\,2*trunc((${inner})/2))`;
}

function evenNum(value: number): string {
  const even = Math.max(2, Math.round(value) & ~1);
  return String(even);
}

/**
 * Build one video track: prepare clips, chain with xfade (matches preview transitions).
 * Returns a label like `[trk0]` whose PTS starts at timeline 0 (leading black pad if needed).
 */
function resolveGroupBlendMode(
  group: { clip: RenderClipPlan }[],
): ReturnType<typeof normalizeBlendMode> {
  if (group.length === 0) return "normal";
  const first = normalizeBlendMode(group[0]!.clip.transform.blendMode);
  for (let i = 1; i < group.length; i += 1) {
    if (normalizeBlendMode(group[i]!.clip.transform.blendMode) !== first) {
      return "normal";
    }
  }
  return first;
}

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
    const animatedGeo = hasGeometryKeyframes(clip.transformKeyframes);

    const fx = ffmpegVideoEffectsChainAnimated(clip.effects, clipDur, {
      delaySec: early,
      keyframes: clip.effectKeyframes,
    });
    const bits: string[] = animatedGeo
      ? [
          `[${inputIndex}:v]${setpts}`,
          mediaPlacementFilters(clip, width, height),
          "format=rgba",
        ]
      : [
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
    const opacityTrack = getTransformTrack(clip.transformKeyframes, "opacity");
    if (opacityTrack) {
      const expr =
        ffmpegLinearExpr(opacityTrack.points, clipDur, opacity, 0, "T") ??
        opacity.toFixed(4);
      bits.push(
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expr})'`,
      );
    } else if (opacity < 0.999) {
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
 * - Ramp → a piecewise-quadratic *forward* map of the source offset
 *   `u = (PTS-STARTPTS)*TB` (seconds, robust to `-ss` seek offsets) to the
 *   output timeline `t = tStart + a·(u−uStart) + b·(u−uStart)²`, so output PTS
 *   follows ∫ds/v exactly like preview. The result is divided by TB because
 *   setpts evaluates in timestamp units (only `T`, `PTS`, `STARTPTS`, `TB`…
 *   exist there — a lowercase `t` would fail parsing).
 */
export function clipSetpts(clip: RenderClipPlan): string {
  const speed = clip.speed > 0 ? clip.speed : 1;
  if (!clip.speedRamp) {
    return Math.abs(speed - 1) < 0.001
      ? "setpts=PTS-STARTPTS"
      : `setpts=(PTS-STARTPTS)/${formatNum(speed)}`;
  }

  const sourceSpanSec = Math.max(0.001, clip.sourceOutSec - clip.sourceInSec);
  const segments = rampTimeMapSegments(clip.speedRamp, sourceSpanSec, 32);
  if (segments.length === 0) {
    return "setpts=PTS-STARTPTS";
  }

  const u = "((PTS-STARTPTS)*TB)";
  let expr = "0";
  for (let k = segments.length - 1; k >= 0; k -= 1) {
    const seg = segments[k];
    expr = `if(gte(${u}\\,${formatNum(seg.uStart)})\\,${forwardExpr(seg, u)}\\,${expr})`;
  }
  return `setpts=(${expr})/TB`;
}

/**
 * Output timeline seconds for a source offset inside this segment:
 * `t = tStart + a·du + b·du²`. Coefficients are emitted sign-safe
 * (`-x*…` instead of `+-x*…`) so the expression always parses.
 */
function forwardExpr(seg: RampExprSegment, uExpr: string): string {
  const du = `(${uExpr}-${formatNum(seg.uStart)})`;
  return `(${formatNum(seg.tStart)}${signedMul(seg.a, du)}${signedMul(seg.b, `${du}*${du}`)})`;
}

function signedMul(coef: number, term: string): string {
  if (!Number.isFinite(coef) || coef === 0) return `+0*${term}`;
  if (coef < 0) return `-${formatNum(-coef)}*${term}`;
  return `+${formatNum(coef)}*${term}`;
}

function formatNum(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // Trim trailing zeros while keeping enough precision for sub-ms accuracy.
  return Number(value.toFixed(6)).toString();
}

/** fps filter value: integer when whole, else 3 decimals (e.g. 29.970). */
function formatFps(fps: number): string {
  const safe = Number.isFinite(fps) && fps > 0 ? fps : 30;
  return Number.isInteger(safe) ? String(safe) : safe.toFixed(3);
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
  // Stream-local pre-roll mirrors the video input construction: constant-
  // speed video inputs fetch `overlap` of early source, so the audio fades
  // must start after it (same `delay` convention as the video fade chain).
  const overlap = Math.max(0, clip.transitionOverlapSec);
  const preRoll =
    clip.kind === "video" && !clip.speedRamp ? overlap : 0;
  const clipDur = Math.max(
    0.01,
    clip.timelineEndSec - clip.timelineStartSec,
  );
  const fade = audioFadeChain(clip.effects, clipDur, preRoll);
  const tail = `volume=${volume},adelay=${startMs}|${startMs},apad,atrim=0:${outputDurationSec.toFixed(3)}`;

  if (!clip.speedRamp) {
    const speed = clip.speed > 0 ? clip.speed : 1;
    parts.push(`[${inputIndex}:a]asetpts=PTS-STARTPTS,${atempoChain(speed)}${fade}${tail}${outLabel}`);
    return;
  }

  const span = Math.max(0.01, clip.sourceOutSec - clip.sourceInSec);
  // 24 slices halve the tempo step vs 12, so pitch glides instead of jumping.
  const segments = rampTimeMapSegments(clip.speedRamp, span, 24);
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
  parts.push(`${sliceLabels}concat=n=${n}:v=0:a=1,${fade}${tail}${outLabel}`);
}

/**
 * `afade` pair matching the video fade semantics (same durations, same
 * pre-roll delay). Empty when both fades are ~0. Ramped clips carry no
 * pre-roll, so their caller passes `preRoll = 0`.
 */
function audioFadeChain(
  effects: RenderClipPlan["effects"],
  clipDurationSec: number,
  preRollSec: number,
): string {
  const dur = Math.max(0.01, clipDurationSec);
  const pre = Math.max(0, preRollSec);
  const parts: string[] = [];
  const fadeIn = Math.min(effects.fadeInSec, dur);
  if (fadeIn > 0.001) {
    parts.push(`afade=t=in:st=${pre.toFixed(3)}:d=${fadeIn.toFixed(3)}`);
  }
  const fadeOut = Math.min(effects.fadeOutSec, dur);
  if (fadeOut > 0.001) {
    const st = pre + Math.max(0, dur - fadeOut);
    parts.push(`afade=t=out:st=${st.toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  }
  return parts.length > 0 ? `${parts.join(",")},` : "";
}

/** FFmpeg drawtext needs a real TTF/OTF path; UI fonts like Manrope often have none. */
function drawtextBaseX(text: { align: string; x: number }): string {
  return drawtextBaseFrom(text.align, `${Math.max(0, Math.round(text.x))}`, "x");
}

function drawtextBaseFrom(align: string, xExpr: string, _axis: "x"): string {
  if (align === "left") return xExpr;
  if (align === "right") return `(${xExpr})-text_w`;
  return `(${xExpr})-(text_w/2)`;
}

function drawtextBaseY(text: { y: number }): string {
  return `${Math.max(0, Math.round(text.y))}-(text_h/2)`;
}

function slideOffsetExpr(
  anim: string,
  axis: "x" | "y",
  start: number,
  dur: number,
  outStart: number,
  outDur: number,
  dist: number,
): string | null {
  const wants =
    (axis === "x" && (anim === "slideLeft" || anim === "slideRight")) ||
    (axis === "y" && (anim === "slideUp" || anim === "slideDown"));
  if (!wants) return null;
  const sign =
    anim === "slideLeft" || anim === "slideUp" ? 1 : -1;
  const terms: string[] = [];
  if (dur > 0.001) {
    // Entrance: offset DIST → 0 over [start, start+dur].
    terms.push(
      `${(sign * dist).toFixed(1)}*(1-min(1\\,max(0\\,(t-${start.toFixed(3)})/${dur.toFixed(3)})))`,
    );
  }
  if (outDur > 0.001) {
    // Exit: 0 → offset over [outStart, outStart+outDur].
    terms.push(
      `${(sign * dist).toFixed(1)}*(min(1\\,max(0\\,(t-${outStart.toFixed(3)})/${outDur.toFixed(3)})))`,
    );
  }
  if (terms.length === 0) return null;
  return `(${terms.join("+")})`;
}

/** drawtext x/y with slide in/out offsets (B1); scalePop/blur degrade to fade. */
export function drawtextXExpr(
  text: {
    align: string;
    x: number;
    timelineStartSec: number;
    timelineEndSec: number;
    slideDist?: number;
    textAnimation?: { in: string; out: string; inDurationSec: number; outDurationSec: number } | null;
  },
  xOverride?: string,
): string {
  const base = xOverride ? drawtextBaseFrom(text.align, xOverride, "x") : drawtextBaseX(text);
  const dur = Math.max(0, text.timelineEndSec - text.timelineStartSec);
  const anim = text.textAnimation;
  if (!anim || dur <= 0.01) return base;
  const dist = Number.isFinite(text.slideDist) ? (text.slideDist as number) : 48;
  const start = Math.max(0, text.timelineStartSec);
  const inDur = Math.min(anim.inDurationSec, dur);
  const outDur = Math.min(anim.outDurationSec, dur);
  const outStart = start + Math.max(0, dur - outDur);
  const offIn = slideOffsetExpr(anim.in, "x", start, inDur, outStart, 0, dist);
  const offOut = slideOffsetExpr(anim.out, "x", start, 0, outStart, outDur, dist);
  const off = [offIn, offOut].filter(Boolean).join("+");
  return off ? `(${base}+${off})` : base;
}

export function drawtextYExpr(
  text: {
    y: number;
    timelineStartSec: number;
    timelineEndSec: number;
    slideDist?: number;
    textAnimation?: { in: string; out: string; inDurationSec: number; outDurationSec: number } | null;
  },
  yOverride?: string,
): string {
  const base = yOverride ? `(${yOverride})-(text_h/2)` : drawtextBaseY(text);
  const dur = Math.max(0, text.timelineEndSec - text.timelineStartSec);
  const anim = text.textAnimation;
  if (!anim || dur <= 0.01) return base;
  const dist = Number.isFinite(text.slideDist) ? (text.slideDist as number) : 48;
  const start = Math.max(0, text.timelineStartSec);
  const inDur = Math.min(anim.inDurationSec, dur);
  const outDur = Math.min(anim.outDurationSec, dur);
  const outStart = start + Math.max(0, dur - outDur);
  const offIn = slideOffsetExpr(anim.in, "y", start, inDur, outStart, 0, dist);
  const offOut = slideOffsetExpr(anim.out, "y", start, 0, outStart, outDur, dist);
  const off = [offIn, offOut].filter(Boolean).join("+");
  return off ? `(${base}+${off})` : base;
}

/**
 * drawtext alpha combining base opacity, fadeInSec/fadeOutSec (B0) and
 * textAnimation fade/slide/scalePop (B1, opacity part only).
 */
export function drawtextAlphaExpr(
  text: {
    timelineStartSec: number;
    timelineEndSec: number;
    fadeInSec?: number;
    fadeOutSec?: number;
    textAnimation?: { in: string; out: string; inDurationSec: number; outDurationSec: number } | null;
  },
  start: number,
  end: number,
  baseAlpha: number | string,
): string {
  const dur = Math.max(0.01, end - start);
  const terms: string[] = [
    typeof baseAlpha === "number" ? baseAlpha.toFixed(3) : baseAlpha,
  ];
  const fadeIn = Math.min(text.fadeInSec ?? 0, dur);
  if (fadeIn > 0.001) {
    terms.push(`min(1\\,max(0\\,(t-${start.toFixed(3)})/${fadeIn.toFixed(3)}))`);
  }
  const fadeOut = Math.min(text.fadeOutSec ?? 0, dur);
  if (fadeOut > 0.001) {
    terms.push(
      `min(1\\,max(0\\,(${end.toFixed(3)}-t)/${fadeOut.toFixed(3)}))`,
    );
  }
  const anim = text.textAnimation;
  if (anim) {
    const inDur = Math.min(anim.inDurationSec, dur);
    if (anim.in !== "none" && inDur > 0.001) {
      terms.push(
        anim.in === "fade" || anim.in === "scalePop"
          ? `min(1\\,max(0\\,(t-${start.toFixed(3)})/${inDur.toFixed(3)}))`
          : `(0.15+0.85*min(1\\,max(0\\,(t-${start.toFixed(3)})/${inDur.toFixed(3)})))`,
      );
    }
    const outDur = Math.min(anim.outDurationSec, dur);
    if (anim.out !== "none" && outDur > 0.001) {
      const outStart = start + Math.max(0, dur - outDur);
      void outStart;
      terms.push(
        anim.out === "fade" || anim.out === "scalePop"
          ? `min(1\\,max(0\\,(${end.toFixed(3)}-t)/${outDur.toFixed(3)}))`
          : `(0.15+0.85*min(1\\,max(0\\,(${end.toFixed(3)}-t)/${outDur.toFixed(3)})))`,
      );
    }
  }
  return terms.join("*");
}
/** System TTF candidates for a UI font family + weight (mirrors Rust). */
function systemFontCandidates(family: string, weight: number): string[] {
  const f = family.toLowerCase();
  const bold = weight >= 650;
  if (f.includes("arial black")) {
    return ["C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/Arial Black.ttf"];
  }
  if (f.includes("arial")) {
    return bold
      ? [
          "C:/Windows/Fonts/arialbd.ttf",
          "C:/Windows/Fonts/Arial Bold.ttf",
          "C:/Windows/Fonts/arial.ttf",
          "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
          "/System/Library/Fonts/Supplemental/Arial.ttf",
        ]
      : [
          "C:/Windows/Fonts/arial.ttf",
          "/System/Library/Fonts/Supplemental/Arial.ttf",
        ];
  }
  if (f.includes("segoe")) {
    return bold
      ? ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/segoeui.ttf"]
      : ["C:/Windows/Fonts/segoeui.ttf"];
  }
  if (f.includes("verdana")) {
    return bold
      ? ["C:/Windows/Fonts/verdanab.ttf", "C:/Windows/Fonts/verdana.ttf"]
      : ["C:/Windows/Fonts/verdana.ttf"];
  }
  if (f.includes("georgia")) {
    return bold
      ? ["C:/Windows/Fonts/georgiab.ttf", "C:/Windows/Fonts/georgia.ttf"]
      : ["C:/Windows/Fonts/georgia.ttf"];
  }
  if (f.includes("impact")) return ["C:/Windows/Fonts/impact.ttf"];
  if (f.includes("times")) {
    return bold
      ? ["C:/Windows/Fonts/timesbd.ttf", "C:/Windows/Fonts/times.ttf"]
      : ["C:/Windows/Fonts/times.ttf"];
  }
  if (f.includes("calibri")) {
    return bold
      ? ["C:/Windows/Fonts/calibrib.ttf", "C:/Windows/Fonts/calibri.ttf"]
      : ["C:/Windows/Fonts/calibri.ttf"];
  }
  return [];
}

function resolveDrawtextFont(
  fontPath: string | null,
  fileExists: (path: string) => boolean,
  fontFamily?: string,
  fontWeight?: number,
): string | null {
  if (fontPath && fileExists(fontPath)) return fontPath;
  const weight = fontWeight ?? 700;
  const family = fontFamily ?? "";

  // Bundled OFL faces — same files preview uses for Manrope / JetBrains.
  if (family) {
    const bundled = bundledFontFileForFamily(family, weight);
    if (bundled) {
      for (const candidate of [
        `public/fonts/${bundled}`,
        `../public/fonts/${bundled}`,
        bundled,
      ]) {
        if (fileExists(candidate)) return candidate;
      }
    }
    for (const candidate of systemFontCandidates(family, weight)) {
      if (fileExists(candidate)) return candidate;
    }
  }

  // Last resort: Arial at the requested weight.
  for (const candidate of systemFontCandidates("Arial", weight)) {
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
