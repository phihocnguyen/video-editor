import {
  normalizeBlendMode,
  type BlendMode,
} from "./blendModes";
import {
  DEFAULT_CLIP_EFFECTS,
  normalizeClipEffects,
  type ClipEffects,
} from "./effects";
import {
  normalizeEffectKeyframes,
  type EffectKeyframes,
} from "./effectKeyframes";
import {
  normalizeTransformKeyframes,
  type TransformKeyframes,
} from "./transformKeyframes";
import type { ClipTransform, Letterbox, ProjectDocument, TextAnimation } from "./project";
import { normalizeLetterbox, normalizeTextAnimation } from "./project";
import { clipDurationTicks } from "./timelineCommands";
import { ticksToSeconds } from "./time";
import {
  normalizeClipTransition,
  transitionHalfSec,
  type ClipTransition,
} from "./transitions";
import { normalizeSpeedRamp, type SpeedRamp } from "./speedRamp";

export type RenderResolutionPreset = "source" | "720" | "1080";
export type RenderQualityPreset = "draft" | "standard" | "high";

export interface RenderClipPlan {
  clipId: string;
  trackId: string;
  trackOrder: number;
  assetPath: string;
  timelineStartSec: number;
  timelineEndSec: number;
  sourceInSec: number;
  sourceOutSec: number;
  volume: number;
  opacity: number;
  speed: number;
  /** Variable-speed curve, when the clip carries one (null = constant speed). */
  speedRamp: SpeedRamp | null;
  includeAudio: boolean;
  kind: "video" | "audio" | "image";
  effects: ClipEffects;
  effectKeyframes: EffectKeyframes | null;
  transformKeyframes: TransformKeyframes | null;
  transitionIn: ClipTransition;
  /** Seconds to start overlay early for incoming transition overlap. */
  transitionOverlapSec: number;
  /** Position/scale/rotation/opacity (media placement) in project-canvas space. */
  transform: ClipTransform;
  /** Project-canvas size the transform is expressed against. */
  canvasWidth: number;
  canvasHeight: number;
  /** Source media dimensions (for contain-fit export placement). */
  mediaWidth: number | null;
  mediaHeight: number | null;
}

export interface RenderTextPlan {
  clipId: string;
  trackId: string;
  trackOrder: number;
  content: string;
  fontFamily: string;
  fontPath: string | null;
  fontSize: number;
  /** 100…900 (see TextStyle). Export snaps to the closest bundled face. */
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  backgroundColor: string | null;
  backgroundPadding: number;
  backgroundRadius: number;
  /** Slide distance in output px (preview 48 canvas px * fontScale). */
  slideDist: number;
  x: number;
  y: number;
  opacity: number;
  blendMode: BlendMode;
  timelineStartSec: number;
  timelineEndSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  textAnimation: TextAnimation;
  transformKeyframes: TransformKeyframes | null;
  /** Font size before transform scale, in output px. Used when scale is keyframed. */
  baseFontSize: number;
}

export interface RenderWashPlan {
  clipId: string;
  trackId: string;
  trackOrder: number;
  timelineStartSec: number;
  timelineEndSec: number;
  opacity: number;
  effects: ClipEffects;
}

export interface RenderPlan {
  width: number;
  height: number;
  frameRate: number;
  /** Background colour behind all layers. */
  backgroundColor: string;
  /** Cinematic bars painted last (same geometry as preview overlay). */
  letterbox: Letterbox;
  durationSec: number;
  videoBitrate: string;
  audioBitrate: string;
  clips: RenderClipPlan[];
  texts: RenderTextPlan[];
  /** Filter-track washes painted above the picture for their time range. */
  washes: RenderWashPlan[];
  missingAssetIds: string[];
}

export function buildRenderPlan(
  project: ProjectDocument,
  preset: RenderResolutionPreset = "1080",
  quality: RenderQualityPreset = "standard",
): RenderPlan {
  const missingAssetIds = project.assets.filter((a) => a.missing).map((a) => a.id);
  const assetsById = new Map(project.assets.map((a) => [a.id, a]));
  const tracksById = new Map(project.tracks.map((t) => [t.id, t]));

  let durationTicks = 0;
  const clips: RenderClipPlan[] = [];
  const texts: RenderTextPlan[] = [];
  const washes: RenderWashPlan[] = [];
  const { width, height } = resolveSize(project, preset);
  const scaleX = width / Math.max(1, project.canvas.width);
  const scaleY = height / Math.max(1, project.canvas.height);
  const fontScale = Math.min(scaleX, scaleY);

  for (const clip of project.clips) {
    const end = clip.startTicks + clipDurationTicks(clip);
    durationTicks = Math.max(durationTicks, end);
    const track = tracksById.get(clip.trackId);

    if (clip.kind === "text" && clip.text) {
      if (track && !track.visible) continue;
      const fx = normalizeClipEffects(clip.effects ?? DEFAULT_CLIP_EFFECTS);
      const textKf = normalizeTransformKeyframes(clip.transformKeyframes ?? null);
      const scaleAnimated = Boolean(textKf?.tracks.some((t) => t.param === "scaleX"));
      const textScaleX =
        scaleAnimated
          ? 1
          : Number.isFinite(clip.transform.scaleX) && clip.transform.scaleX !== 0
            ? Math.abs(clip.transform.scaleX)
            : 1;
      texts.push({
        clipId: clip.id,
        trackId: clip.trackId,
        trackOrder: track?.order ?? 0,
        content: clip.text.content,
        fontFamily: clip.text.fontFamily,
        fontPath: clip.text.fontPath,
        fontSize: clip.text.fontSize * fontScale * textScaleX,
        fontWeight: clip.text.fontWeight,
        color: clip.text.color,
        align: clip.text.align,
        backgroundColor: clip.text.backgroundColor ?? null,
        backgroundPadding: (clip.text.backgroundPadding ?? 12) * fontScale,
        backgroundRadius: (clip.text.backgroundRadius ?? 10) * fontScale,
        slideDist: 48 * fontScale,
        x: clip.transform.x * scaleX,
        y: clip.transform.y * scaleY,
        opacity: clip.transform.opacity,
        blendMode: normalizeBlendMode(clip.transform.blendMode),
        timelineStartSec: ticksToSeconds(clip.startTicks),
        timelineEndSec: ticksToSeconds(end),
        fadeInSec: fx.fadeInSec,
        fadeOutSec: fx.fadeOutSec,
        textAnimation: normalizeTextAnimation(clip.text.textAnimation ?? null),
        transformKeyframes: textKf,
        baseFontSize: clip.text.fontSize * fontScale,
      });
      continue;
    }

    if (clip.kind === "filter") {
      if (track && !track.visible) continue;
      washes.push({
        clipId: clip.id,
        trackId: clip.trackId,
        trackOrder: track?.order ?? 0,
        timelineStartSec: ticksToSeconds(clip.startTicks),
        timelineEndSec: ticksToSeconds(end),
        opacity: clip.transform.opacity,
        effects: normalizeClipEffects(clip.effects ?? DEFAULT_CLIP_EFFECTS),
      });
      continue;
    }

    if (clip.kind !== "media" || !clip.assetId) continue;
    const asset = assetsById.get(clip.assetId);
    if (!asset) continue;
    if (track && !track.visible && asset.kind !== "audio") continue;

    const trackVolume = track?.volume ?? 1;
    const muted = Boolean(track?.muted);
    clips.push({
      clipId: clip.id,
      trackId: clip.trackId,
      trackOrder: track?.order ?? 0,
      assetPath: asset.path,
      timelineStartSec: ticksToSeconds(clip.startTicks),
      timelineEndSec: ticksToSeconds(end),
      sourceInSec: ticksToSeconds(clip.sourceInTicks),
      sourceOutSec: ticksToSeconds(clip.sourceOutTicks),
      volume: clip.volume * trackVolume,
      opacity: clip.transform.opacity,
      speed: clip.speed > 0 ? clip.speed : 1,
      speedRamp: normalizeSpeedRamp(clip.speedRamp ?? null),
      includeAudio:
        !muted &&
        asset.hasAudio &&
        (asset.kind === "audio" || (asset.kind === "video" && !clip.suppressEmbeddedAudio)),
      kind: asset.kind,
      effects: normalizeClipEffects(clip.effects ?? DEFAULT_CLIP_EFFECTS),
      effectKeyframes: normalizeEffectKeyframes(clip.effectKeyframes ?? null),
      transformKeyframes: normalizeTransformKeyframes(clip.transformKeyframes ?? null),
      transitionIn: normalizeClipTransition(clip.transitionIn),
      transitionOverlapSec: 0,
      transform: {
        ...clip.transform,
        blendMode: normalizeBlendMode(clip.transform.blendMode),
      },
      canvasWidth: project.canvas.width,
      canvasHeight: project.canvas.height,
      mediaWidth: asset.width,
      mediaHeight: asset.height,
    });
  }

  clips.sort((a, b) => a.trackOrder - b.trackOrder || a.timelineStartSec - b.timelineStartSec);
  texts.sort(
    (a, b) =>
      a.trackOrder - b.trackOrder || a.timelineStartSec - b.timelineStartSec,
  );
  washes.sort(
    (a, b) => a.trackOrder - b.trackOrder || a.timelineStartSec - b.timelineStartSec,
  );

  // Match preview: always honor transitionIn, centered on the cut (D/2 each side).
  // Do not skip when clips have a small gap — preview still blends around the cut.
  for (let i = 0; i < clips.length; i += 1) {
    const curr = clips[i];
    if (curr.kind === "audio") continue;
    const tin = curr.transitionIn;
    if (tin.type === "none") continue;
    const prev = [...clips]
      .slice(0, i)
      .reverse()
      .find((c) => c.trackId === curr.trackId && c.kind !== "audio");
    const half = transitionHalfSec(tin);
    const currCap = Math.max(
      0.05,
      curr.timelineEndSec - curr.timelineStartSec - 0.05,
    );
    if (!prev) {
      curr.transitionOverlapSec = Math.min(half, currCap);
      continue;
    }
    const prevCap = Math.max(
      0.05,
      prev.timelineEndSec - prev.timelineStartSec - 0.05,
    );
    curr.transitionOverlapSec = Math.min(half, prevCap, currCap);
  }

  const { videoBitrate, audioBitrate } = qualityBitrates(quality);

  return {
    width,
    height,
    frameRate: project.canvas.frameRate,
    backgroundColor: project.canvas.backgroundColor,
    letterbox: normalizeLetterbox(project.canvas.letterbox ?? null),
    durationSec: Math.max(ticksToSeconds(durationTicks), 0.1),
    videoBitrate,
    audioBitrate,
    clips,
    texts,
    washes,
    missingAssetIds,
  };
}

function qualityBitrates(quality: RenderQualityPreset): {
  videoBitrate: string;
  audioBitrate: string;
} {
  switch (quality) {
    case "draft":
      return { videoBitrate: "2500k", audioBitrate: "128k" };
    case "high":
      return { videoBitrate: "12M", audioBitrate: "320k" };
    default:
      return { videoBitrate: "6M", audioBitrate: "192k" };
  }
}

function resolveSize(
  project: ProjectDocument,
  preset: RenderResolutionPreset,
): { width: number; height: number } {
  if (preset === "source") {
    return { width: project.canvas.width, height: project.canvas.height };
  }
  if (preset === "720") {
    return scaleToHeight(project.canvas.width, project.canvas.height, 720);
  }
  return scaleToHeight(project.canvas.width, project.canvas.height, 1080);
}

function scaleToHeight(width: number, height: number, targetHeight: number) {
  const ratio = width / Math.max(1, height);
  return {
    width: Math.round((targetHeight * ratio) / 2) * 2,
    height: targetHeight,
  };
}
