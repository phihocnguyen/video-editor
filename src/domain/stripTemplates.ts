import { DEFAULT_CLIP_EFFECTS } from "./effects";
import { coverTransform, slotToPixels, type SlotRectNorm } from "./mediaTransform";
import { DEFAULT_CLIP_TRANSITION } from "./transitions";
import type { Clip, MediaAsset, ProjectDocument, Track } from "./project";
import { PROJECT_SCHEMA_VERSION } from "./project";

export const STRIP_CANVAS = { width: 1080, height: 1920, frameRate: 30 } as const;
export const STRIP_DURATION_TICKS = 10_000_000;
export const STRIP_FRAME_PATH = "/shapes/film-rebate.svg";

export interface LayoutTemplate {
  id: string;
  label: string;
  /** Files the user drops (pair templates place each file twice). */
  slotCount: number;
  /** Total cell clips placed. */
  cellCount: number;
  cols: number;
  rows: number;
  /** Right side is the color copy of the left (grayscale left). */
  twin: boolean;
  frame: boolean;
  slots: SlotRectNorm[];
}

function gridSlots(
  cols: number,
  rows: number,
  inset: { x: number; y: number; w: number; h: number },
  gutter: number,
): SlotRectNorm[] {
  const slots: SlotRectNorm[] = [];
  const cellW = (inset.w - gutter * (cols - 1)) / cols;
  const cellH = (inset.h - gutter * (rows - 1)) / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      slots.push({
        x: inset.x + c * (cellW + gutter),
        y: inset.y + r * (cellH + gutter),
        w: cellW,
        h: cellH,
      });
    }
  }
  return slots;
}

function twinSlots(slots: SlotRectNorm[]): SlotRectNorm[] {
  // Left half = grayscale copies, right half = color. Each half keeps the
  // same row-major order: file i → left cell i + right cell i.
  const left = slots.map((s) => ({ x: s.x * 0.5, y: s.y, w: s.w * 0.5, h: s.h }));
  const right = slots.map((s) => ({
    x: 0.5 + s.x * 0.5,
    y: s.y,
    w: s.w * 0.5,
    h: s.h,
  }));
  return [...left, ...right];
}

const PLAIN_INSET = { x: 0.04, y: 0.04, w: 0.92, h: 0.92 };
const FILM_INSET = { x: 0.13, y: 0.055, w: 0.74, h: 0.89 };
const GUTTER = 0.018;

function makeTemplate(opts: {
  id: string;
  label: string;
  cols: number;
  rows: number;
  twin?: boolean;
  frame?: boolean;
}): LayoutTemplate {
  const inset = opts.frame ? FILM_INSET : PLAIN_INSET;
  const base = gridSlots(opts.cols, opts.rows, inset, GUTTER);
  const slots = opts.twin ? twinSlots(base) : base;
  const cells = base.length;
  return {
    id: opts.id,
    label: opts.label,
    slotCount: cells,
    cellCount: opts.twin ? cells * 2 : cells,
    cols: opts.cols,
    rows: opts.rows,
    twin: opts.twin ?? false,
    frame: opts.frame ?? false,
    slots,
  };
}

export const STRIP_TEMPLATES: LayoutTemplate[] = [
  makeTemplate({ id: "strip-4", label: "Strip · 4 videos", cols: 2, rows: 2 }),
  makeTemplate({ id: "strip-8", label: "Strip · 8 videos", cols: 2, rows: 4 }),
  makeTemplate({ id: "film-4", label: "Film · 4 videos", cols: 2, rows: 2, frame: true }),
  makeTemplate({ id: "film-8", label: "Film · 8 videos", cols: 2, rows: 4, frame: true }),
  makeTemplate({ id: "film-pair-4", label: "Film pair · 4 videos", cols: 2, rows: 2, twin: true, frame: true }),
  makeTemplate({ id: "film-pair-8", label: "Film pair · 8 videos", cols: 2, rows: 4, twin: true, frame: true }),
  makeTemplate({ id: "strip-2", label: "Strip · 2 videos", cols: 1, rows: 2 }),
  makeTemplate({ id: "strip-3", label: "Strip · 3 videos", cols: 1, rows: 3 }),
  makeTemplate({ id: "strip-6", label: "Strip · 6 videos", cols: 2, rows: 3 }),
  makeTemplate({ id: "strip-9", label: "Strip · 9 videos", cols: 3, rows: 3 }),
  makeTemplate({ id: "strip-12", label: "Strip · 12 videos", cols: 3, rows: 4 }),
  makeTemplate({ id: "film-2", label: "Film · 2 videos", cols: 1, rows: 2, frame: true }),
  makeTemplate({ id: "film-3", label: "Film · 3 videos", cols: 1, rows: 3, frame: true }),
  makeTemplate({ id: "film-6", label: "Film · 6 videos", cols: 2, rows: 3, frame: true }),
  makeTemplate({ id: "film-9", label: "Film · 9 videos", cols: 3, rows: 3, frame: true }),
  makeTemplate({ id: "film-12", label: "Film · 12 videos", cols: 3, rows: 4, frame: true }),
];

export function getStripTemplate(id: string): LayoutTemplate | null {
  return STRIP_TEMPLATES.find((t) => t.id === id) ?? null;
}

export interface StripAssetInput {
  id: string;
  kind: MediaAsset["kind"];
  width: number | null;
  height: number | null;
  durationTicks: number | null;
}

function clipSourceSpan(asset: StripAssetInput): number {
  if (asset.kind === "image") return STRIP_DURATION_TICKS;
  const d = asset.durationTicks ?? 0;
  if (!Number.isFinite(d) || d <= 0) return STRIP_DURATION_TICKS;
  return Math.max(1_000_000, Math.round(d));
}

/**
 * Pure applier: builds a normal 9:16 project with every cell filled.
 * Row-major drop order. Fewer files → trailing cells stay empty (black).
 * Extra files are ignored by the caller (already in the media bin).
 */
export function applyStripTemplate(
  template: LayoutTemplate,
  assets: StripAssetInput[],
): ProjectDocument {
  const now = new Date().toISOString();
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const placed = assets.slice(0, template.slotCount);

  for (let i = 0; i < template.cellCount; i += 1) {
    tracks.push({
      id: `strip-track-${i}`,
      kind: "video",
      name: template.twin ? (i < template.slotCount ? `L${i + 1}` : `R${i + 1 - template.slotCount}`) : `cell-${i}`,
      order: 1 + i,
      muted: false,
      visible: true,
      locked: false,
      volume: 1,
    });
  }

  const cellFor = (i: number): { asset: StripAssetInput | null; gray: boolean } => {
    if (template.twin) {
      const file = placed[i % template.slotCount] ?? null;
      return { asset: file, gray: i < template.slotCount };
    }
    return { asset: placed[i] ?? null, gray: false };
  };

  for (let i = 0; i < template.cellCount; i += 1) {
    const slot = template.slots[i]!;
    const { asset, gray } = cellFor(i);
    if (!asset) continue; // empty cell: black shows through, no clip
    const px = slotToPixels(slot, STRIP_CANVAS.width, STRIP_CANVAS.height);
    const cov = coverTransform(px, asset, STRIP_CANVAS);
    const span = clipSourceSpan(asset);
    clips.push({
      id: `strip-clip-${i}`,
      trackId: `strip-track-${i}`,
      assetId: asset.id,
      kind: "media",
      startTicks: 0,
      sourceInTicks: 0,
      sourceOutTicks: span,
      speed: 1,
      transform: {
        x: cov.x,
        y: cov.y,
        scaleX: cov.scale,
        scaleY: cov.scale,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
      },
      volume: 1,
      effects: { ...DEFAULT_CLIP_EFFECTS, grayscale: gray },
      effectKeyframes: null,
      transformKeyframes: null,
      transitionIn: { ...DEFAULT_CLIP_TRANSITION },
      text: null,
      speedRamp: null,
      crop: { ...slot },
      slotId: `cell-${i}`,
    });
  }

  if (template.frame) {
    tracks.push({
      id: "strip-track-frame",
      kind: "video",
      name: "Frame",
      order: 0,
      muted: false,
      visible: true,
      locked: true,
      volume: 1,
    });
    clips.push({
      id: "strip-clip-frame",
      trackId: "strip-track-frame",
      assetId: "__film-frame__",
      kind: "media",
      startTicks: 0,
      sourceInTicks: 0,
      sourceOutTicks: STRIP_DURATION_TICKS,
      speed: 1,
      transform: {
        x: STRIP_CANVAS.width / 2,
        y: STRIP_CANVAS.height / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
      },
      volume: 0,
      effects: { ...DEFAULT_CLIP_EFFECTS },
      effectKeyframes: null,
      transformKeyframes: null,
      transitionIn: { ...DEFAULT_CLIP_TRANSITION },
      text: null,
      speedRamp: null,
      crop: null,
      slotId: null,
    });
  }

  // Empty audio track stays (createEmptyProject convention).
  tracks.push({
    id: "strip-track-audio",
    kind: "audio",
    name: "A1",
    order: 100,
    muted: false,
    visible: true,
    locked: false,
    volume: 1,
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name: template.label,
    canvas: {
      width: STRIP_CANVAS.width,
      height: STRIP_CANVAS.height,
      frameRate: STRIP_CANVAS.frameRate,
      backgroundColor: "#000000",
    },
    tracks,
    assets: template.frame
      ? [
          {
            id: "__film-frame__",
            kind: "image",
            path: STRIP_FRAME_PATH,
            name: "Film rebate",
            durationTicks: STRIP_DURATION_TICKS,
            width: STRIP_CANVAS.width,
            height: STRIP_CANVAS.height,
            frameRate: null,
            hasAudio: false,
            missing: false,
          },
        ]
      : [],
    clips,
    updatedAt: now,
  };
}

/** Replace one cell's media, recompute cover for the new dimensions. */
export function swapStripCell(
  project: ProjectDocument,
  cellIndex: number,
  asset: StripAssetInput,
  template: LayoutTemplate,
): ProjectDocument {
  const slot = template.slots[cellIndex];
  if (!slot) return project;
  const px = slotToPixels(slot, project.canvas.width, project.canvas.height);
  const cov = coverTransform(px, asset, project.canvas);
  const span =
    asset.kind === "image"
      ? STRIP_DURATION_TICKS
      : Math.max(1_000_000, Math.round(asset.durationTicks ?? STRIP_DURATION_TICKS));
  const clips = project.clips.map((c) =>
    c.slotId === `cell-${cellIndex}`
      ? {
          ...c,
          assetId: asset.id,
          sourceInTicks: 0,
          sourceOutTicks: span,
          transform: { ...c.transform, x: cov.x, y: cov.y, scaleX: cov.scale, scaleY: cov.scale },
          crop: { ...slot },
        }
      : c,
  );
  return { ...project, clips, updatedAt: new Date().toISOString() };
}

/**
 * Replace the media of one strip clip by clip id, using the clip's own crop
 * rect as the slot. No template lookup needed (works after save/reopen).
 */
export function swapStripCellByClip(
  project: ProjectDocument,
  clipId: string,
  asset: StripAssetInput,
): ProjectDocument {
  const target = project.clips.find((c) => c.id === clipId);
  if (!target || !target.crop) return project;
  const px = slotToPixels(target.crop, project.canvas.width, project.canvas.height);
  const cov = coverTransform(px, asset, project.canvas);
  const span =
    asset.kind === "image"
      ? STRIP_DURATION_TICKS
      : Math.max(1_000_000, Math.round(asset.durationTicks ?? STRIP_DURATION_TICKS));
  const clips = project.clips.map((c) =>
    c.id === clipId
      ? {
          ...c,
          assetId: asset.id,
          sourceInTicks: 0,
          sourceOutTicks: span,
          transform: { ...c.transform, x: cov.x, y: cov.y, scaleX: cov.scale, scaleY: cov.scale },
        }
      : c,
  );
  return { ...project, clips, updatedAt: new Date().toISOString() };
}
