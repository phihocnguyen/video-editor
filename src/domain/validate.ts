import { normalizeClipEffects } from "./effects";
import { normalizeEffectKeyframes } from "./effectKeyframes";
import {
  PROJECT_SCHEMA_VERSION,
  normalizeTextAnimation,
  normalizeTextStyle,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "./project";
import { normalizeSpeedRamp } from "./speedRamp";
import { normalizeClipTransition } from "./transitions";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]) {
  if (typeof obj[key] !== "string" || (obj[key] as string).length === 0) {
    issues.push({ path: `${path}.${key}`, message: "Expected non-empty string" });
  }
}

function requireNumber(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]) {
  if (typeof obj[key] !== "number" || !Number.isFinite(obj[key] as number)) {
    issues.push({ path: `${path}.${key}`, message: "Expected finite number" });
  }
}

function requireBoolean(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]) {
  if (typeof obj[key] !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: "Expected boolean" });
  }
}

export function validateProject(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: "", message: "Project must be an object" }] };
  }

  if (input.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `Unsupported schemaVersion (expected ${PROJECT_SCHEMA_VERSION})`,
    });
  }

  requireString(input, "id", "", issues);
  requireString(input, "name", "", issues);
  requireString(input, "updatedAt", "", issues);

  if (!isRecord(input.canvas)) {
    issues.push({ path: "canvas", message: "Expected canvas object" });
  } else {
    requireNumber(input.canvas, "width", "canvas", issues);
    requireNumber(input.canvas, "height", "canvas", issues);
    requireNumber(input.canvas, "frameRate", "canvas", issues);
    if (typeof input.canvas.frameRate === "number" && input.canvas.frameRate <= 0) {
      issues.push({ path: "canvas.frameRate", message: "frameRate must be > 0" });
    }
  }

  if (!Array.isArray(input.tracks)) {
    issues.push({ path: "tracks", message: "Expected tracks array" });
  } else {
    input.tracks.forEach((track, index) => validateTrack(track, `tracks[${index}]`, issues));
  }

  if (!Array.isArray(input.assets)) {
    issues.push({ path: "assets", message: "Expected assets array" });
  } else {
    input.assets.forEach((asset, index) => validateAsset(asset, `assets[${index}]`, issues));
  }

  if (!Array.isArray(input.clips)) {
    issues.push({ path: "clips", message: "Expected clips array" });
  } else {
    const trackIds = new Set(
      Array.isArray(input.tracks)
        ? input.tracks
            .filter(isRecord)
            .map((t) => t.id)
            .filter((id): id is string => typeof id === "string")
        : [],
    );
    const assetIds = new Set(
      Array.isArray(input.assets)
        ? input.assets
            .filter(isRecord)
            .map((a) => a.id)
            .filter((id): id is string => typeof id === "string")
        : [],
    );

    input.clips.forEach((clip, index) => {
      validateClip(clip, `clips[${index}]`, issues);
      if (isRecord(clip) && typeof clip.trackId === "string" && !trackIds.has(clip.trackId)) {
        issues.push({ path: `clips[${index}].trackId`, message: "Unknown trackId" });
      }
      if (
        isRecord(clip) &&
        clip.assetId !== null &&
        typeof clip.assetId === "string" &&
        !assetIds.has(clip.assetId)
      ) {
        issues.push({ path: `clips[${index}].assetId`, message: "Unknown assetId" });
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

function validateTrack(track: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(track)) {
    issues.push({ path, message: "Expected track object" });
    return;
  }
  requireString(track, "id", path, issues);
  requireString(track, "name", path, issues);
  if (track.kind !== "video" && track.kind !== "audio") {
    issues.push({ path: `${path}.kind`, message: "kind must be video|audio" });
  }
  requireNumber(track, "order", path, issues);
  requireBoolean(track, "muted", path, issues);
  requireBoolean(track, "visible", path, issues);
  requireBoolean(track, "locked", path, issues);
  requireNumber(track, "volume", path, issues);
}

function validateAsset(asset: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(asset)) {
    issues.push({ path, message: "Expected asset object" });
    return;
  }
  requireString(asset, "id", path, issues);
  requireString(asset, "path", path, issues);
  requireString(asset, "name", path, issues);
  if (asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "image") {
    issues.push({ path: `${path}.kind`, message: "kind must be video|audio|image" });
  }
  requireBoolean(asset, "hasAudio", path, issues);
  requireBoolean(asset, "missing", path, issues);
}

function validateClip(clip: unknown, path: string, issues: ValidationIssue[]) {
  if (!isRecord(clip)) {
    issues.push({ path, message: "Expected clip object" });
    return;
  }
  requireString(clip, "id", path, issues);
  requireString(clip, "trackId", path, issues);
  if (clip.kind !== "media" && clip.kind !== "text") {
    issues.push({ path: `${path}.kind`, message: "kind must be media|text" });
  }
  requireNumber(clip, "startTicks", path, issues);
  requireNumber(clip, "sourceInTicks", path, issues);
  requireNumber(clip, "sourceOutTicks", path, issues);
  requireNumber(clip, "speed", path, issues);
  requireNumber(clip, "volume", path, issues);

  if (
    typeof clip.sourceInTicks === "number" &&
    typeof clip.sourceOutTicks === "number" &&
    clip.sourceOutTicks <= clip.sourceInTicks
  ) {
    issues.push({
      path: `${path}.sourceOutTicks`,
      message: "sourceOutTicks must be greater than sourceInTicks",
    });
  }

  if (clip.transform !== undefined && clip.transform !== null) {
    if (!isRecord(clip.transform)) {
      issues.push({ path: `${path}.transform`, message: "Expected transform object" });
    } else {
      for (const key of [
        "x",
        "y",
        "scaleX",
        "scaleY",
        "rotation",
        "opacity",
      ] as const) {
        if (clip.transform[key] !== undefined) {
          requireNumber(clip.transform, key, `${path}.transform`, issues);
        }
      }
    }
  }

  if (clip.effects !== undefined && clip.effects !== null) {
    if (!isRecord(clip.effects)) {
      issues.push({ path: `${path}.effects`, message: "Expected effects object" });
    } else {
      for (const key of [
        "brightness",
        "contrast",
        "saturation",
        "blur",
        "fadeInSec",
        "fadeOutSec",
      ] as const) {
        if (clip.effects[key] !== undefined) {
          requireNumber(clip.effects, key, `${path}.effects`, issues);
        }
      }
      if (clip.effects.grayscale !== undefined) {
        requireBoolean(clip.effects, "grayscale", `${path}.effects`, issues);
      }
    }
  }

  if (clip.speedRamp !== undefined && clip.speedRamp !== null) {
    if (!isRecord(clip.speedRamp) || !Array.isArray(clip.speedRamp.points)) {
      issues.push({ path: `${path}.speedRamp`, message: "Expected { points: [] }" });
    } else {
      clip.speedRamp.points.forEach((point, index) => {
        if (!isRecord(point)) {
          issues.push({
            path: `${path}.speedRamp.points[${index}]`,
            message: "Expected ramp point object",
          });
          return;
        }
        requireNumber(point, "atProgress", `${path}.speedRamp.points[${index}]`, issues);
        requireNumber(point, "speed", `${path}.speedRamp.points[${index}]`, issues);
        const speed = point.speed;
        const progress = point.atProgress;
        if (typeof speed === "number" && (speed <= 0 || speed > 100)) {
          issues.push({
            path: `${path}.speedRamp.points[${index}].speed`,
            message: "speed must be > 0",
          });
        }
        if (typeof progress === "number" && (progress < 0 || progress > 1)) {
          issues.push({
            path: `${path}.speedRamp.points[${index}].atProgress`,
            message: "atProgress must be within [0, 1]",
          });
        }
      });
    }
  }
}

export function assertProject(input: unknown): ProjectDocument {
  const result = validateProject(input);
  if (!result.ok) {
    throw new Error(result.issues.map((i) => `${i.path}: ${i.message}`).join("; "));
  }
  return normalizeProjectDocument(input as ProjectDocument);
}

const DEFAULT_TRANSFORM: Clip["transform"] = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
};

/** Fill missing clip fields + canvas defaults for older project JSON. */
export function normalizeProjectDocument(project: ProjectDocument): ProjectDocument {
  const canvas = project.canvas as ProjectDocument["canvas"] & {
    backgroundColor?: unknown;
  };
  return {
    ...project,
    canvas: {
      ...project.canvas,
      // Keep even so preview geometry matches export dims (yuv420p needs even).
      width: Math.max(2, Math.round(project.canvas.width) & ~1),
      height: Math.max(2, Math.round(project.canvas.height) & ~1),
      backgroundColor:
        typeof canvas.backgroundColor === "string" && canvas.backgroundColor.length > 0
          ? canvas.backgroundColor
          : "#000000",
    },
    clips: project.clips.map((clip) => {
      const raw = clip as Clip & {
        effects?: Partial<Clip["effects"]> | null;
        effectKeyframes?: Clip["effectKeyframes"];
        transitionIn?: Partial<Clip["transitionIn"]> | null;
        speedRamp?: Partial<Clip["speedRamp"]> | null;
        transform?: Partial<Clip["transform"]> | null;
        text?: (Clip["text"] & { textAnimation?: unknown; animation?: unknown }) | null;
        animation?: unknown;
      };
      const normalizedRamp = normalizeSpeedRamp(raw.speedRamp ?? null);
      const normalizedEffectKf = normalizeEffectKeyframes(raw.effectKeyframes ?? null);
      const { animation: _removedAnim, ...rest } = raw;
      const { animation: _removedTextAnim, ...rawText } = (raw.text ?? {}) as Record<
        string,
        unknown
      >;
      const text =
        raw.text == null
          ? raw.text
          : normalizeTextStyle({
              ...rawText,
              textAnimation: normalizeTextAnimation(
                (rawText.textAnimation ?? null) as Partial<
                  import("./project").TextAnimation
                > | null,
              ),
            } as Partial<import("./project").TextStyle>);
      return {
        ...rest,
        text: text as Clip["text"],
        transform: { ...DEFAULT_TRANSFORM, ...(raw.transform ?? {}) },
        effects: normalizeClipEffects(raw.effects),
        effectKeyframes: normalizedEffectKf,
        transitionIn: normalizeClipTransition(raw.transitionIn),
        speedRamp: normalizedRamp,
      };
    }),
  };
}

export type { Clip, MediaAsset, Track };
