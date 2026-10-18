import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  clipDurationTicks,
  sourceOffsetForClipTimelineOffset,
  ticksToSeconds,
  type Clip,
  type MediaAsset,
} from "../../domain";
import { getRampLayoutHold } from "./clipLayoutMotion";
import {
  getTrackThumbsVersion,
  readNearestTrackThumb,
  readTrackThumb,
  requestTrackThumb,
  stableFilmstripProgress,
  subscribeTrackThumbs,
  thumbKeyFor,
} from "../../lib/trackThumbs";
import styles from "./ClipMediaVisual.module.css";

interface ClipFilmstripProps {
  clip: Clip;
  asset: MediaAsset;
  mediaUrl: string;
  widthPx: number;
}

/** Target width per thumb — zoom out collapses to 1, zoom in fans out. */
const THUMB_TARGET_PX = 120;
const MAX_THUMBS = 10;
const MIN_WIDTH_PX = 56;

interface FilmSlot {
  progress: number;
  key: string;
  timeSec: number;
}

/**
 * Premiere-style filmstrip inside a timeline clip box. Renders `<img>` only —
 * captures are produced off-band by `trackThumbs` (Tauri FFmpeg process, or
 * one epoch-gated shared seeker on web), so this layer can never steal the
 * preview decoder from Play.
 */
function filmstripLadder(clip: Clip, assetId: string, isImage: boolean): FilmSlot[] {
  const durTicks = Math.max(1, clipDurationTicks(clip));
  const progress = isImage ? [0.5] : stableFilmstripProgress(MAX_THUMBS);
  return progress.map((frac) => {
    // Timeline fraction → source time (speed/ramp aware), so thumbs match
    // the frames preview actually plays at each position.
    const srcOff = sourceOffsetForClipTimelineOffset(clip, frac * durTicks);
    const timeSec = Math.max(
      0,
      ticksToSeconds(clip.sourceInTicks) + ticksToSeconds(srcOff),
    );
    return { progress: frac, key: thumbKeyFor(assetId, timeSec), timeSec };
  });
}

export function ClipFilmstrip({ clip, asset, mediaUrl, widthPx }: ClipFilmstripProps) {
  const isImage = asset.kind === "image";
  const count = isImage
    ? 1
    : Math.max(1, Math.min(MAX_THUMBS, Math.floor(widthPx / THUMB_TARGET_PX)));

  const ladder = useMemo(
    () => filmstripLadder(clip, asset.id, isImage),
    // Source range and the ramp decide which frames exist. Width only picks
    // how many of those cached frames to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset.id, clip.sourceInTicks, clip.sourceOutTicks, clip.speed, clip.speedRamp, isImage],
  );

  // While a speed point is being dragged the curve is live, but the slot must
  // stay on the frames already on screen until the gesture ends.
  const heldLadder = useRef(ladder);
  const draggingRamp = getRampLayoutHold()?.clipId === clip.id;
  if (!draggingRamp) heldLadder.current = ladder;
  const slots = draggingRamp ? heldLadder.current : ladder;
  const visible = isImage
    ? slots
    : slots.filter((slot) =>
        stableFilmstripProgress(count).some((p) => Math.abs(p - slot.progress) < 1e-6),
      );

  useSyncExternalStore(subscribeTrackThumbs, getTrackThumbsVersion);

  const filePath = asset.path.startsWith("blob:") ? null : asset.path;
  const slotsKey = slots.map((s) => s.key).join("|");
  useEffect(() => {
    if (isImage || slots.length === 0) return;
    if (getRampLayoutHold()?.clipId === clip.id) return;
    for (const s of slots) {
      if (!readTrackThumb(s.key)) {
        requestTrackThumb({
          assetId: asset.id,
          filePath,
          mediaUrl,
          timeSec: s.timeSec,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey, asset.id, filePath, isImage, mediaUrl, clip.id]);

  // Images need no capture at all — the file itself is the thumbnail.
  if (isImage) {
    if (widthPx < MIN_WIDTH_PX) return null;
    return (
      <div className={styles.filmstrip} aria-hidden>
        <img className={styles.thumbImg} src={mediaUrl} alt="" draggable={false} />
      </div>
    );
  }

  if (widthPx < MIN_WIDTH_PX || visible.length === 0) return null;
  return (
    <div className={styles.filmstrip} aria-hidden>
      {visible.map((s) => {
        const url = readTrackThumb(s.key) ?? readNearestTrackThumb(asset.id, s.timeSec);
        return url ? (
          <img
            key={s.progress}
            className={styles.thumbImg}
            src={url}
            alt=""
            draggable={false}
          />
        ) : (
          <div key={s.progress} className={styles.thumbSkeleton} />
        );
      })}
    </div>
  );
}
