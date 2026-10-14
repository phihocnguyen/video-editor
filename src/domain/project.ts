import type { Tick } from "./time";

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
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
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
  text: TextStyle | null;
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
