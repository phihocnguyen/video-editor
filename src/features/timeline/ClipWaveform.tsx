import { useEffect, useRef } from "react";
import { getMediaPeaks } from "../../lib/mediaPeaks";
import styles from "./ClipMediaVisual.module.css";

interface ClipWaveformProps {
  cacheKey: string;
  mediaUrl: string;
  sourceInSec: number;
  sourceOutSec: number;
  /** Ignored for redraw — canvas is stretched with CSS on zoom. */
  widthPx?: number;
  heightPx?: number;
}

/** Fixed internal resolution; CSS stretches on zoom so we don't redraw. */
const WAVE_W = 480;
const WAVE_H = 40;

export function ClipWaveform({
  cacheKey,
  mediaUrl,
  sourceInSec,
  sourceOutSec,
  heightPx = WAVE_H,
}: ClipWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = WAVE_W;
    const h = Math.max(2, Math.round(heightPx));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, h / 2 - 0.5, w, 1);

    void getMediaPeaks(cacheKey, mediaUrl).then((data) => {
      if (cancelled || !data || !canvasRef.current) return;
      const c = canvasRef.current.getContext("2d");
      if (!c) return;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);

      const dur = Math.max(0.01, data.durationSec);
      const startBucket = Math.floor((sourceInSec / dur) * data.buckets);
      const endBucket = Math.ceil((sourceOutSec / dur) * data.buckets);
      const bucketSpan = Math.max(1, endBucket - startBucket);

      c.fillStyle = "rgba(220, 255, 230, 0.85)";
      const mid = h / 2;
      for (let x = 0; x < w; x++) {
        const b = startBucket + Math.floor((x / w) * bucketSpan);
        const idx = Math.min(data.buckets - 1, Math.max(0, b));
        const min = data.peaks[idx * 2] ?? 0;
        const max = data.peaks[idx * 2 + 1] ?? 0;
        const y1 = mid + min * mid * 0.92;
        const y2 = mid + max * mid * 0.92;
        const top = Math.min(y1, y2);
        const bottom = Math.max(y1, y2);
        c.fillRect(x, top, 1, Math.max(1, bottom - top));
      }

      c.fillStyle = "rgba(255,255,255,0.2)";
      c.fillRect(0, mid - 0.5, w, 1);
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, heightPx, mediaUrl, sourceInSec, sourceOutSec]);

  return <canvas className={styles.waveform} ref={canvasRef} aria-hidden />;
}
