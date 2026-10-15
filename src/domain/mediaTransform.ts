/**
 * Geometry helpers for media (video/image) layers on the canvas.
 *
 * A media layer is first contained-fit into the canvas, then `transform.scaleX`
 * /`scaleY` multiply that fitted box and `rotation` rotates it. `transform.x`/`y`
 * give the layer centre in canvas pixels.
 *
 * Older projects default media transform.x/y to 0 — treat 0/0 as "canvas centre"
 * so legacy clips still fill the frame.
 */

import type { Clip, ClipTransform, MediaAsset } from "./project";

export interface FitBox {
  /** Fitted width in canvas pixels. */
  width: number;
  /** Fitted height in canvas pixels. */
  height: number;
}

/** Contain-fit a media source box into the canvas (preserves aspect ratio). */
export function containFitBox(
  canvasWidth: number,
  canvasHeight: number,
  mediaWidth: number | null,
  mediaHeight: number | null,
): FitBox {
  const cw = Math.max(1, canvasWidth);
  const ch = Math.max(1, canvasHeight);
  const mw = mediaWidth && mediaWidth > 0 ? mediaWidth : cw;
  const mh = mediaHeight && mediaHeight > 0 ? mediaHeight : ch;
  const scale = Math.min(cw / mw, ch / mh);
  return { width: mw * scale, height: mh * scale };
}

/** Effective layer centre, treating a legacy 0/0 transform as canvas centre. */
export function mediaCenter(
  transform: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const legacy = transform.x === 0 && transform.y === 0;
  return {
    x: legacy ? canvasWidth / 2 : transform.x,
    y: legacy ? canvasHeight / 2 : transform.y,
  };
}

/** Scale applied on top of the contain-fit box (clamped; sign preserved for flip). */
export function mediaScale(transform: ClipTransform): { x: number; y: number } {
  return {
    x: clampScale(transform.scaleX),
    y: clampScale(transform.scaleY),
  };
}

function clampScale(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 1;
  const sign = value < 0 ? -1 : 1;
  return sign * Math.min(20, Math.max(0.02, Math.abs(value)));
}

export interface MediaGeometry {
  /** Centre in canvas px. */
  centerX: number;
  centerY: number;
  /** Fitted box size (pre-scale) in canvas px. */
  fitWidth: number;
  fitHeight: number;
  /** Scaled box size in canvas px (what actually renders, before rotation). */
  boxWidth: number;
  boxHeight: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
}

export function mediaGeometry(
  transform: ClipTransform,
  canvasWidth: number,
  canvasHeight: number,
  asset: Pick<MediaAsset, "width" | "height"> | null,
): MediaGeometry {
  const fit = containFitBox(canvasWidth, canvasHeight, asset?.width ?? null, asset?.height ?? null);
  const center = mediaCenter(transform, canvasWidth, canvasHeight);
  const scale = mediaScale(transform);
  return {
    centerX: center.x,
    centerY: center.y,
    fitWidth: fit.width,
    fitHeight: fit.height,
    boxWidth: fit.width * Math.abs(scale.x),
    boxHeight: fit.height * Math.abs(scale.y),
    scaleX: scale.x,
    scaleY: scale.y,
    rotation: Number.isFinite(transform.rotation) ? transform.rotation : 0,
    opacity: transform.opacity,
  };
}

/** Convenience overload for callers holding a full clip. */
export function clipMediaGeometry(
  clip: Clip,
  canvasWidth: number,
  canvasHeight: number,
  asset: Pick<MediaAsset, "width" | "height"> | null,
): MediaGeometry {
  return mediaGeometry(clip.transform, canvasWidth, canvasHeight, asset);
}

/**
 * Preview stacking z-index from track order.
 * Lower `track.order` (higher in the timeline list) paints above — same as
 * Premiere/Vegas: Move layer down sends a clip behind; Move up brings it forward.
 * Same-track boost: media pixels < hitbox < text.
 */
export function layerStackZ(
  trackOrder: number,
  kind: "media" | "mediaHit" | "text",
): number {
  // Large bias so order 0 stays above any realistic number of tracks.
  const base = (1000 - Math.max(0, trackOrder)) * 10;
  if (kind === "media") return base;
  if (kind === "mediaHit") return base + 1;
  return base + 2;
}
