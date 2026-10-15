import type { ClipEffects } from "./effects";
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
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  /** Optional absolute path to a .ttf/.otf file (custom font). */
  fontPath: string | null;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
}

export function createDefaultTextStyle(content = "Title text"): TextStyle {
  return {
    content,
    fontFamily: "Manrope Variable",
    fontPath: null,
    fontSize: 72,
    color: "#FFE566",
    align: "center",
  };
}

export interface Clip {
  id: string;
  trackId: string;
  assetId: string | null;
  kind: "media" | "text";
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
