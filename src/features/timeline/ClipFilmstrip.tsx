import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  clipDurationTicks,
  sourceOffsetForClipTimelineOffset,
  ticksToSeconds,
  type Clip,
  type MediaAsset,
} from "../../domain";
import {
  getTrackThumbsVersion,
  readTrackThumb,
  requestTrackThumb,
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

/**
 * Premiere-style filmstrip inside a timeline clip box. Renders `<img>` only —
 * captures are produced off-band by `trackThumbs` (Tauri FFmpeg process, or
 * one epoch-gated shared seeker on web), so this layer can never steal the
 * preview decoder from Play.
 */
export function ClipFilmstrip({ clip, asset, mediaUrl, widthPx }: ClipFilmstripProps) {
  const isImage = asset.kind === "image";
  const count = isImage
    ? 1
    : Math.max(1, Math.min(MAX_THUMBS, Math.floor(widthPx / THUMB_TARGET_PX)));

  const slots = useMemo(() => {
    if (widthPx < MIN_WIDTH_PX) return [];
    const durTicks = Math.max(1, clipDurationTicks(clip));
    const list: { key: string; timeSec: number }[] = [];
    const n = isImage ? 1 : count;
    for (let i = 0; i < n; i += 1) {
      // Timeline fraction → source time (speed/ramp aware), so thumbs match
      // the frames preview actually plays at each position.
      const frac = (i + 0.5) / n;
      const localTicks = frac * durTicks;
      const srcOff = sourceOffsetForClipTimelineOffset(clip, localTicks);
      const timeSec = Math.max(
        0,
        ticksToSeconds(clip.sourceInTicks) + ticksToSeconds(srcOff),
      );
      list.push({ key: thumbKeyFor(asset.id, timeSec), timeSec });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    asset.id,
    clip.sourceInTicks,
    clip.sourceOutTicks,
    clip.speed,
    clip.speedRamp,
    clip.startTicks,
    count,
    isImage,
    widthPx,
  ]);

  useSyncExternalStore(subscribeTrackThumbs, getTrackThumbsVersion);

  const filePath = asset.path.startsWith("blob:") ? null : asset.path;
  const slotsKey = slots.map((s) => s.key).join("|");
  useEffect(() => {
    if (isImage || slots.length === 0) return;
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
  }, [slotsKey, asset.id, filePath, isImage, mediaUrl]);

  // Images need no capture at all — the file itself is the thumbnail.
  if (isImage) {
    if (widthPx < MIN_WIDTH_PX) return null;
    return (
      <div className={styles.filmstrip} aria-hidden>
        <img className={styles.thumbImg} src={mediaUrl} alt="" draggable={false} />
      </div>
    );
  }

  if (slots.length === 0) return null;
  return (
    <div className={styles.filmstrip} aria-hidden>
      {slots.map((s) => {
        const url = readTrackThumb(s.key);
        return url ? (
          <img key={s.key} className={styles.thumbImg} src={url} alt="" draggable={false} />
        ) : (
          <div key={s.key} className={styles.thumbSkeleton} />
        );
      })}
    </div>
  );
}
