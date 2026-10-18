/**
 * Photo-booth builder. The themed booth is the whole template feature now:
 * a white card of photo windows on a flat background, optional stickers,
 * a background pattern, a card frame, and a caption printed on the card.
 * Everything is a normal clip so preview and export stay in lockstep.
 */

import { boothDecorCenter, isBoothDecorAsset, type BoothDecor } from "./boothDecor";
import { BOOTH_FRAMES, BOOTH_PATTERNS, isBoothOverlayAsset } from "./boothOverlays";
import { boothDecorsForTheme, boothThemeById } from "./boothThemes";
import {
  BOOTH_CANVAS,
  BOOTH_DEFAULT_BACKGROUND,
  BOOTH_MAX_PHOTOS,
  BOOTH_MIN_PHOTOS,
  BOOTH_PAPER_ID,
  BOOTH_STILL_TICKS,
  boothLayout,
  rotatePoint,
} from "./boothStrip";
import { DEFAULT_CLIP_EFFECTS } from "./effects";
import { containFitBox, coverTransform } from "./mediaTransform";
import { DEFAULT_CLIP_TRANSITION } from "./transitions";
import {
  PROJECT_SCHEMA_VERSION,
  createDefaultTextStyle,
  normalizeTextStyle,
  type Clip,
  type MediaAsset,
  type ProjectDocument,
  type Track,
} from "./project";

/** Default hold for a booth still, in ticks (10 s). */
export const BOOTH_DURATION_TICKS = 10_000_000;

const TRACK_PAPER = "strip-track-paper";
const TRACK_FRAME = "strip-track-frame";
const TRACK_PATTERN = "strip-track-pattern";
const TRACK_TITLE = "strip-track-title";

/**
 * Assets the booth generates for itself (paper, stickers, pattern, frame).
 * They belong to the project so preview/export can resolve them, but they are
 * noise in the media bin — callers hide them from pickers.
 */
export function isStripGeneratedAsset(id: string): boolean {
  return id === BOOTH_PAPER_ID || isBoothDecorAsset(id) || isBoothOverlayAsset(id);
}

export interface StripAssetInput {
  id: string;
  kind: MediaAsset["kind"];
  width: number | null;
  height: number | null;
  durationTicks: number | null;
}

export interface BoothApplyOptions {
  /** Booth background colour. */
  backgroundColor?: string;
  /** How long the booth still holds, in ticks. */
  durationTicks?: number;
  /** Booth photos render black-and-white. */
  grayscale?: boolean;
  /** Scrapbook sticker groups drawn as SVG around the card. */
  decorGroups?: readonly string[];
  /** Booth theme. Groups are filtered against that theme's stickers. */
  themeId?: string;
  /** Straight card (drops the classic tilt). */
  upright?: boolean;
  /** Photo windows on the card (1…12). */
  photoCount?: number;
  /** Card arrangement: 1 = vertical strip, 2–3 = grid columns. */
  columns?: number;
  /** Full-canvas background pattern id (from BOOTH_PATTERNS). */
  patternId?: string | null;
  /** Border drawn around the card (from BOOTH_FRAMES). */
  frameId?: string | null;
  /** Caption printed on the bottom of the card. Empty hides it. */
  title?: string | null;
  /** Caption colour. Defaults to the theme's title colour. */
  titleColor?: string;
}

function hexColor(value: string | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function slotDurationTicks(requested: number | undefined): number {
  const raw = requested ?? BOOTH_DURATION_TICKS;
  const sec = raw / 1_000_000;
  const clamped = Math.min(120, Math.max(1, sec));
  return Math.round(clamped * 1_000_000);
}

function mediaClipBase(trackId: string, assetId: string, duration: number): Pick<
  Clip,
  | "trackId"
  | "assetId"
  | "kind"
  | "startTicks"
  | "sourceInTicks"
  | "sourceOutTicks"
  | "speed"
  | "volume"
  | "effects"
  | "effectKeyframes"
  | "transformKeyframes"
  | "transitionIn"
  | "text"
  | "speedRamp"
  | "crop"
  | "slotId"
  | "spanTicks"
  | "suppressEmbeddedAudio"
> {
  return {
    trackId,
    assetId,
    kind: "media",
    startTicks: 0,
    sourceInTicks: 0,
    sourceOutTicks: duration,
    speed: 1,
    volume: 0,
    effects: { ...DEFAULT_CLIP_EFFECTS },
    effectKeyframes: null,
    transformKeyframes: null,
    transitionIn: { ...DEFAULT_CLIP_TRANSITION },
    text: null,
    speedRamp: null,
    crop: null,
    slotId: null,
    spanTicks: duration,
    suppressEmbeddedAudio: true,
  };
}

/**
 * Pure applier: builds a normal project with the photo booth. Row-major drop
 * order; fewer files → trailing cells stay empty.
 */
export function applyBoothTemplate(
  assets: StripAssetInput[],
  options?: BoothApplyOptions,
): ProjectDocument {
  const now = new Date().toISOString();
  const theme = boothThemeById(options?.themeId ?? "classic");
  const decors = boothDecorsForTheme(
    theme.id,
    options?.decorGroups ?? theme.groups.map((group) => group.id),
  );
  const upright = options?.upright ?? theme.upright;
  const photoCount = Math.min(
    BOOTH_MAX_PHOTOS,
    Math.max(BOOTH_MIN_PHOTOS, Math.round(options?.photoCount ?? 4)),
  );
  const columns = Math.min(3, Math.max(1, Math.round(options?.columns ?? 1)));
  const title = (options?.title ?? "").trim();
  const titleColor = hexColor(options?.titleColor, theme.titleColor);
  const titleBand = title ? Math.round(BOOTH_CANVAS.height * 0.08) : 0;

  const layout = boothLayout({
    upright,
    stickerMargin: decors.length > 0,
    photos: photoCount,
    columns,
    titleBand,
  });
  const canvas = layout.canvas;
  const duration = slotDurationTicks(options?.durationTicks);
  const gray = options?.grayscale === true;
  const placed = assets.slice(0, photoCount);
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const fit = containFitBox(canvas.width, canvas.height, layout.paper.w, layout.paper.h);
  const paperScale = layout.paper.w / Math.max(1, fit.width);

  for (let i = 0; i < layout.cells.length; i += 1) {
    tracks.push({
      id: `strip-track-${i}`,
      kind: "video",
      name: `cell-${i}`,
      order: 1 + i,
      muted: false,
      visible: true,
      locked: false,
      volume: 1,
    });
  }

  for (let i = 0; i < layout.cells.length; i += 1) {
    const uprightCell = layout.cells[i];
    const asset = placed[i] ?? null;
    if (!uprightCell || !asset) continue;
    const mid = rotatePoint(
      uprightCell.x + uprightCell.w / 2,
      uprightCell.y + uprightCell.h / 2,
      cx,
      cy,
      layout.rotationDeg,
    );
    const placedRect = {
      x: mid.x - uprightCell.w / 2,
      y: mid.y - uprightCell.h / 2,
      w: uprightCell.w,
      h: uprightCell.h,
    };
    const cov = coverTransform(placedRect, asset, canvas);
    const video = asset.kind === "video" && (asset.durationTicks ?? 0) > 0;
    const sourceOut = video
      ? Math.max(1, Math.min(BOOTH_STILL_TICKS, Math.round(asset.durationTicks ?? BOOTH_STILL_TICKS)))
      : duration;
    clips.push({
      id: `strip-clip-${i}`,
      ...mediaClipBase(`strip-track-${i}`, asset.id, sourceOut),
      transform: {
        x: cov.x,
        y: cov.y,
        scaleX: cov.scale,
        scaleY: cov.scale,
        rotation: layout.rotationDeg,
        opacity: 1,
        blendMode: "normal",
      },
      effects: { ...DEFAULT_CLIP_EFFECTS, grayscale: gray },
      crop: {
        x: placedRect.x / canvas.width,
        y: placedRect.y / canvas.height,
        w: placedRect.w / canvas.width,
        h: placedRect.h / canvas.height,
      },
      slotId: `cell-${i}`,
      spanTicks: duration,
    });
  }

  // White card under the photos.
  tracks.push({
    id: TRACK_PAPER,
    kind: "video",
    name: "Paper",
    order: 40,
    muted: true,
    visible: true,
    locked: false,
    volume: 0,
  });
  clips.push({
    id: "strip-clip-paper",
    ...mediaClipBase(TRACK_PAPER, BOOTH_PAPER_ID, duration),
    transform: {
      x: cx,
      y: cy,
      scaleX: paperScale,
      scaleY: paperScale,
      rotation: layout.rotationDeg,
      opacity: 1,
      blendMode: "normal",
    },
  });

  const generatedAssets: MediaAsset[] = [
    {
      id: BOOTH_PAPER_ID,
      kind: "image",
      path: "booth-paper.png",
      name: "Booth paper",
      durationTicks: duration,
      width: layout.paper.w,
      height: layout.paper.h,
      frameRate: null,
      hasAudio: false,
      missing: false,
    },
  ];

  // Background pattern (behind the card and the stickers).
  const pattern = BOOTH_PATTERNS.find((item) => item.id === options?.patternId);
  if (pattern) {
    tracks.push({
      id: TRACK_PATTERN,
      kind: "video",
      name: pattern.label,
      order: 95,
      muted: true,
      visible: true,
      locked: false,
      volume: 0,
    });
    clips.push({
      id: "strip-clip-pattern",
      ...mediaClipBase(TRACK_PATTERN, pattern.id, duration),
      transform: {
        x: cx,
        y: cy,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        opacity: 1,
        blendMode: "normal",
      },
    });
    generatedAssets.push({
      id: pattern.id,
      kind: "image",
      path: `${pattern.id}.png`,
      name: pattern.label,
      durationTicks: duration,
      width: canvas.width,
      height: canvas.height,
      frameRate: null,
      hasAudio: false,
      missing: false,
    });
  }

  // Stickers around the card (behind the card).
  const decorAssets = decors.map((decor) => ({
    id: decor.id,
    kind: "image" as const,
    path: `${decor.id}.png`,
    name: decor.name,
    durationTicks: duration,
    width: decor.width,
    height: decor.height,
    frameRate: null,
    hasAudio: false,
    missing: false,
  }));
  decors.forEach((decor, index) => {
    const placedDecor = placeBoothDecor(decor, canvas, layout.paper, duration, index);
    tracks.push(placedDecor.track);
    clips.push(placedDecor.clip);
  });
  generatedAssets.push(...decorAssets);

  // Card frame on top of the photos.
  const frame = BOOTH_FRAMES.find((item) => item.id === options?.frameId);
  if (frame) {
    tracks.push({
      id: TRACK_FRAME,
      kind: "video",
      name: frame.label,
      order: 0,
      muted: true,
      visible: true,
      locked: false,
      volume: 0,
    });
    clips.push({
      id: "strip-clip-frame",
      ...mediaClipBase(TRACK_FRAME, frame.id, duration),
      transform: {
        x: cx,
        y: cy,
        scaleX: paperScale,
        scaleY: paperScale,
        rotation: layout.rotationDeg,
        opacity: 1,
        blendMode: "normal",
      },
    });
    generatedAssets.push({
      id: frame.id,
      kind: "image",
      path: `${frame.id}.png`,
      name: frame.label,
      durationTicks: duration,
      width: layout.paper.w,
      height: layout.paper.h,
      frameRate: null,
      hasAudio: false,
      missing: false,
    });
  }

  // Caption printed on the reserved band at the bottom of the card.
  if (title) {
    const titleMid = rotatePoint(
      layout.paper.x + layout.paper.w / 2,
      layout.paper.y + layout.paper.h - layout.titleBand / 2,
      cx,
      cy,
      layout.rotationDeg,
    );
    tracks.push({
      id: TRACK_TITLE,
      kind: "video",
      name: "Caption",
      order: 0,
      muted: false,
      visible: true,
      locked: false,
      volume: 1,
    });
    clips.push({
      id: "strip-clip-title",
      trackId: TRACK_TITLE,
      assetId: null,
      kind: "text",
      startTicks: 0,
      sourceInTicks: 0,
      sourceOutTicks: duration,
      speed: 1,
      transform: {
        x: titleMid.x,
        y: titleMid.y,
        scaleX: 1,
        scaleY: 1,
        rotation: layout.rotationDeg,
        opacity: 1,
        blendMode: "normal",
      },
      volume: 0,
      effects: { ...DEFAULT_CLIP_EFFECTS },
      effectKeyframes: null,
      transformKeyframes: null,
      transitionIn: { ...DEFAULT_CLIP_TRANSITION },
      text: normalizeTextStyle({
        ...createDefaultTextStyle(title),
        color: titleColor,
        align: "center",
        fontWeight: 700,
        fontSize: Math.max(28, Math.round(canvas.width * 0.05)),
      }),
      speedRamp: null,
      crop: null,
      slotId: null,
    });
  }

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
    name: `Photo booth · ${theme.label}`,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      frameRate: BOOTH_CANVAS.frameRate,
      backgroundColor: hexColor(options?.backgroundColor, theme.background || BOOTH_DEFAULT_BACKGROUND),
    },
    tracks,
    assets: generatedAssets,
    clips,
    updatedAt: now,
  };
}

function placeBoothDecor(
  decor: BoothDecor,
  canvas: { width: number; height: number },
  paper: { x: number; y: number; w: number; h: number },
  duration: number,
  index: number,
): { track: Track; clip: Clip } {
  const fit = containFitBox(canvas.width, canvas.height, decor.width, decor.height);
  const scale = decor.width / Math.max(1, fit.width);
  const center = boothDecorCenter(decor, paper, canvas);
  const trackId = `strip-track-decor-${index}`;
  const track: Track = {
    id: trackId,
    kind: "video",
    name: decor.name,
    // Behind the white card (order 40) so stickers never cover the photos.
    order: 70 + index,
    muted: true,
    visible: true,
    locked: false,
    volume: 0,
  };
  const clip: Clip = {
    id: `strip-clip-decor-${index}`,
    ...mediaClipBase(trackId, decor.id, duration),
    transform: {
      x: center.x,
      y: center.y,
      scaleX: scale,
      scaleY: scale,
      rotation: decor.rotation,
      opacity: 1,
      blendMode: "normal",
    },
  };
  return { track, clip };
}

/**
 * Replace the media of one booth clip by clip id, using the clip's own crop
 * rect as the slot. No template lookup needed (works after save/reopen).
 */
export function swapStripCellByClip(
  project: ProjectDocument,
  clipId: string,
  asset: StripAssetInput,
): ProjectDocument {
  const target = project.clips.find((c) => c.id === clipId);
  if (!target || !target.crop) return project;
  const px = {
    x: target.crop.x * project.canvas.width,
    y: target.crop.y * project.canvas.height,
    w: target.crop.w * project.canvas.width,
    h: target.crop.h * project.canvas.height,
  };
  const cov = coverTransform(px, asset, project.canvas);
  // A booth still reserves `spanTicks` so a short video frame is held for the
  // chosen length. Presence of spanTicks (not rotation) marks a booth cell.
  const still = target.spanTicks != null && target.spanTicks > 0;
  const slotTicks = still ? target.spanTicks! : BOOTH_DURATION_TICKS;
  const video = asset.kind === "video" && (asset.durationTicks ?? 0) > 0;
  const span = still
    ? video
      ? Math.max(1, Math.min(BOOTH_STILL_TICKS, Math.round(asset.durationTicks ?? BOOTH_STILL_TICKS)))
      : slotTicks
    : asset.kind === "image"
      ? BOOTH_DURATION_TICKS
      : Math.max(1_000_000, Math.round(asset.durationTicks ?? BOOTH_DURATION_TICKS));
  const clips = project.clips.map((c) =>
    c.id === clipId
      ? {
          ...c,
          assetId: asset.id,
          sourceInTicks: 0,
          sourceOutTicks: span,
          spanTicks: still ? slotTicks : c.spanTicks,
          transform: { ...c.transform, x: cov.x, y: cov.y, scaleX: cov.scale, scaleY: cov.scale },
        }
      : c,
  );
  return { ...project, clips, updatedAt: new Date().toISOString() };
}
