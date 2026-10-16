import type { BlendMode } from "./blendModes";
import type { ClipEffects } from "./effects";
import type { EffectKeyframes } from "./effectKeyframes";
import type { TransformKeyframes } from "./transformKeyframes";
import type { ClipTransition } from "./transitions";
import type { Tick } from "./time";
import type { SpeedRamp } from "./speedRamp";

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type MediaKind = "video" | "audio" | "image";
export type TrackKind = "video" | "audio";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  /** Absolute or project-relative path; never embed media bytes. */
  path: string;
  name: string;
  durationTicks: Tick | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  hasAudio: boolean;
  missing: boolean;
  /**
   * Soundtrack extracted from this video asset. Missing → audio still rides
   * the video file until a clip is detached.
   */
  extractedAudioAssetId?: string | null;
}

/**
 * Position/scale/rotation for a layer on the canvas.
 *
 * Text clips: `x`/`y` are the absolute canvas pixel position of the text centre.
 *
 * Media clips (video/image): `x`/`y` are the canvas pixel position of the layer
 * centre (default = canvas centre). The layer is first contained-fit into the
 * canvas, then `scaleX`/`scaleY` multiply that fitted box. `rotation` is degrees
 * (clockwise). Older projects may have `x`/`y` at 0 — treat 0 as "canvas centre"
 * for media in that case.
 */
export interface ClipTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  /** How this layer composites over layers below (CapCut-style). Defaults to normal. */
  blendMode?: BlendMode;
}

export type TextAnimType =
  | "none"
  | "fade"
  | "slideUp"
  | "slideDown"
  | "slideLeft"
  | "slideRight"
  | "scalePop";

export interface TextAnimation {
  in: TextAnimType;
  out: TextAnimType;
  inDurationSec: number;
  outDurationSec: number;
}

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  in: "none",
  out: "none",
  inDurationSec: 0.5,
  outDurationSec: 0.5,
};

export const TEXT_ANIM_OPTIONS: { type: TextAnimType; label: string }[] = [
  { type: "none", label: "None" },
  { type: "fade", label: "Fade" },
  { type: "slideUp", label: "Slide Up" },
  { type: "slideDown", label: "Slide Down" },
  { type: "slideLeft", label: "Slide Left" },
  { type: "slideRight", label: "Slide Right" },
  { type: "scalePop", label: "Pop" },
];

function isTextAnimType(value: unknown): value is TextAnimType {
  return TEXT_ANIM_OPTIONS.some((o) => o.type === value);
}

export function normalizeTextAnimation(input?: Partial<TextAnimation> | null): TextAnimation {
  const src = (input ?? {}) as Record<string, unknown>;
  const clampDur = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(10, Math.max(0, v))
      : fallback;
  return {
    in: isTextAnimType(src.in) ? (src.in as TextAnimType) : "none",
    out: isTextAnimType(src.out) ? (src.out as TextAnimType) : "none",
    inDurationSec: clampDur(src.inDurationSec, DEFAULT_TEXT_ANIMATION.inDurationSec),
    outDurationSec: clampDur(src.outDurationSec, DEFAULT_TEXT_ANIMATION.outDurationSec),
  };
}

export type TextListStyle = "none" | "bullet" | "number";

export interface TextStyle {
  content: string;
  fontFamily: string;
  /** Optional absolute path to a .ttf/.otf file (custom font). */
  fontPath: string | null;
  fontSize: number;
  /** 100 (thin) … 900 (black). Preview renders it directly; export snaps to
   * the closest bundled face (Regular < 650, Bold ≥ 650). */
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** Line prefixes are stored in `content`; flag drives UI toggle state. */
  listStyle: TextListStyle;
  /**
   * Instagram-style highlight behind glyphs. `null` / empty = no background.
   */
  backgroundColor: string | null;
  /** Extra padding around glyphs (canvas px at design size). */
  backgroundPadding: number;
  /** Corner radius of the highlight pill (canvas px). */
  backgroundRadius: number;
  /** Entrance/exit animation (B1). Missing on older projects → none. */
  textAnimation?: TextAnimation | null;
}

export function createDefaultTextStyle(content = "Title text"): TextStyle {
  return {
    content,
    fontFamily: "Manrope Variable",
    fontPath: null,
    fontSize: 48,
    fontWeight: 700,
    color: "#FFE566",
    align: "center",
    italic: false,
    underline: false,
    strikethrough: false,
    listStyle: "none",
    backgroundColor: null,
    backgroundPadding: 12,
    backgroundRadius: 10,
    textAnimation: { ...DEFAULT_TEXT_ANIMATION },
  };
}

export function normalizeTextStyle(input?: Partial<TextStyle> | null): TextStyle {
  const base = createDefaultTextStyle();
  const src = input ?? {};
  const bg =
    typeof src.backgroundColor === "string" && src.backgroundColor.trim().length > 0
      ? src.backgroundColor.trim()
      : null;
  return {
    content: typeof src.content === "string" ? src.content : base.content,
    fontFamily: typeof src.fontFamily === "string" ? src.fontFamily : base.fontFamily,
    fontPath: typeof src.fontPath === "string" ? src.fontPath : src.fontPath === null ? null : base.fontPath,
    fontSize:
      typeof src.fontSize === "number" && Number.isFinite(src.fontSize)
        ? Math.min(400, Math.max(8, src.fontSize))
        : base.fontSize,
    fontWeight:
      typeof src.fontWeight === "number" && Number.isFinite(src.fontWeight)
        ? Math.min(900, Math.max(100, Math.round(src.fontWeight)))
        : base.fontWeight,
    color: typeof src.color === "string" ? src.color : base.color,
    align:
      src.align === "left" || src.align === "center" || src.align === "right"
        ? src.align
        : base.align,
    italic: src.italic === true,
    underline: src.underline === true,
    strikethrough: src.strikethrough === true,
    listStyle:
      src.listStyle === "bullet" || src.listStyle === "number" || src.listStyle === "none"
        ? src.listStyle
        : base.listStyle,
    backgroundColor: bg,
    backgroundPadding:
      typeof src.backgroundPadding === "number" && Number.isFinite(src.backgroundPadding)
        ? Math.min(80, Math.max(0, src.backgroundPadding))
        : base.backgroundPadding,
    backgroundRadius:
      typeof src.backgroundRadius === "number" && Number.isFinite(src.backgroundRadius)
        ? Math.min(80, Math.max(0, src.backgroundRadius))
        : base.backgroundRadius,
    textAnimation: normalizeTextAnimation(src.textAnimation ?? null),
  };
}

/**
 * Preview style for a text clip at local time `localSec` within duration `durSec`.
 * Combines clip fadeInSec/fadeOutSec (B0) with textAnimation in/out (B1).
 * Slide distance is in canvas px; scalePop is 0.8→1 with fade.
 */
export function textAnimVisual(
  textAnimation: TextAnimation | null | undefined,
  effects: { fadeInSec: number; fadeOutSec: number },
  localSec: number,
  durationSec: number,
): { opacity: number; offsetX: number; offsetY: number; scale: number } {
  const dur = Math.max(0.01, durationSec);
  const t = Math.max(0, Math.min(dur, localSec));
  let opacity = 1;
  let offsetX = 0;
  let offsetY = 0;
  let scale = 1;

  // B0: legacy fade effects.
  const fadeIn = Math.min(effects.fadeInSec, dur);
  if (fadeIn > 0.001 && t < fadeIn) opacity = Math.min(opacity, t / fadeIn);
  const fadeOut = Math.min(effects.fadeOutSec, dur);
  if (fadeOut > 0.001 && t > dur - fadeOut) {
    opacity = Math.min(opacity, (dur - t) / fadeOut);
  }

  const anim = normalizeTextAnimation(textAnimation);
  const DIST = 48;
  const applySide = (
    type: TextAnimType,
    progress: number, // 0 = hidden, 1 = fully in
  ) => {
    const e = progress * progress * (3 - 2 * progress);
    switch (type) {
      case "none":
        break;
      case "fade":
        opacity = Math.min(opacity, e);
        break;
      case "slideUp":
        offsetY = (1 - e) * DIST;
        opacity = Math.min(opacity, 0.15 + 0.85 * e);
        break;
      case "slideDown":
        offsetY = -(1 - e) * DIST;
        opacity = Math.min(opacity, 0.15 + 0.85 * e);
        break;
      case "slideLeft":
        offsetX = (1 - e) * DIST;
        opacity = Math.min(opacity, 0.15 + 0.85 * e);
        break;
      case "slideRight":
        offsetX = -(1 - e) * DIST;
        opacity = Math.min(opacity, 0.15 + 0.85 * e);
        break;
      case "scalePop":
        scale = 0.8 + 0.2 * e;
        opacity = Math.min(opacity, e);
        break;
    }
  };

  const inDur = Math.min(anim.inDurationSec, dur);
  if (anim.in !== "none" && inDur > 0.001 && t < inDur) {
    applySide(anim.in, t / inDur);
  }
  const outDur = Math.min(anim.outDurationSec, dur);
  if (anim.out !== "none" && outDur > 0.001 && t > dur - outDur) {
    applySide(anim.out, (dur - t) / outDur);
  }
  return {
    opacity: Math.min(1, Math.max(0, opacity)),
    offsetX,
    offsetY,
    scale,
  };
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string | null;
  kind: "media" | "text" | "filter";
  /** Timeline start in ticks (inclusive). */
  startTicks: Tick;
  /** Source in-point in ticks (inclusive). */
  sourceInTicks: Tick;
  /** Source out-point in ticks (exclusive). */
  sourceOutTicks: Tick;
  speed: number;
  transform: ClipTransform;
  volume: number;
  /** Visual effects; missing on older projects → treat as DEFAULT_CLIP_EFFECTS. */
  effects: ClipEffects;
  /**
   * Optional per-parameter effect keyframes (CapCut-style). Missing → static
   * `effects` for the whole clip.
   */
  effectKeyframes?: EffectKeyframes | null;
  /**
   * Linear opacity / position / scale / rotation keyframes. Missing → static
   * `transform` for the whole clip.
   */
  transformKeyframes?: TransformKeyframes | null;
  /**
   * Partner clip created when a video soundtrack is detached. Missing → no link.
   * A mutual link trims, splits, moves, and deletes together.
   * `linkFollow: false` is an explicit unlock from the properties checkbox.
   * Older clips stored `linkLocked: false` as the default and still follow.
   */
  linkedClipId?: string | null;
  linkLocked?: boolean;
  linkFollow?: boolean;
  /**
   * Video clip whose soundtrack plays from the linked audio clip. Missing or
   * false keeps today's embedded-audio playback.
   */
  suppressEmbeddedAudio?: boolean;
  /**
   * Incoming transition from the previous clip on the same track.
   * Missing on older projects → none.
   */
  transitionIn: ClipTransition;
  text: TextStyle | null;
  /**
   * Optional speed ramp (variable speed over the source range). Missing on older
   * projects → constant `speed`. When present and non-flat it supersedes `speed`
   * for duration and preview mapping.
   */
  speedRamp?: SpeedRamp | null;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  order: number;
  muted: boolean;
  visible: boolean;
  locked: boolean;
  volume: number;
}

export interface Letterbox {
  /** Master switch — off = no bars in preview/export. */
  enabled: boolean;
  /** Bars as % of canvas dimension (0..45 each). */
  topPct: number;
  bottomPct: number;
  leftPct: number;
  rightPct: number;
  /** Bar colour (default black). */
  color: string;
}

export const DEFAULT_LETTERBOX: Letterbox = {
  enabled: false,
  topPct: 0,
  bottomPct: 0,
  leftPct: 0,
  rightPct: 0,
  color: "#000000",
};

export function normalizeLetterbox(input?: Partial<Letterbox> | null): Letterbox {
  const src = (input ?? {}) as Record<string, unknown>;
  const pct = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(45, Math.max(0, v))
      : fallback;
  const color =
    typeof src.color === "string" && src.color.trim().length > 0
      ? src.color.trim()
      : DEFAULT_LETTERBOX.color;
  return {
    enabled: src.enabled === true,
    topPct: pct(src.topPct, 0),
    bottomPct: pct(src.bottomPct, 0),
    leftPct: pct(src.leftPct, 0),
    rightPct: pct(src.rightPct, 0),
    color,
  };
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  canvas: {
    width: number;
    height: number;
    frameRate: number;
    /** Stage background colour behind all layers (CSS + export base). */
    backgroundColor: string;
    /** Cinematic bars overlay (Sony Vegas style). Missing → off. */
    letterbox?: Letterbox | null;
  };
  tracks: Track[];
  assets: MediaAsset[];
  clips: Clip[];
  updatedAt: string;
}

export function createEmptyProject(name = "Untitled project"): ProjectDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    canvas: {
      width: 1920,
      height: 1080,
      frameRate: 30,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: crypto.randomUUID(),
        kind: "video",
        name: "V1",
        order: 0,
        muted: false,
        visible: true,
        locked: false,
        volume: 1,
      },
      {
        id: crypto.randomUUID(),
        kind: "audio",
        name: "A1",
        order: 1,
        muted: false,
        visible: true,
        locked: false,
        volume: 1,
      },
    ],
    assets: [],
    clips: [],
    updatedAt: now,
  };
}
