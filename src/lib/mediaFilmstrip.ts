/**
 * Timeline filmstrip frames — optimized for snappy import.
 * Prefer a shared HTMLVideoElement seek pipeline (fast). FFmpeg is optional
 * background warm-up only, never on the critical path.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import {
  currentDecodeEpoch,
  isDecodeEpochStale,
  preemptDecodersNow,
  whenDecodeSlotFree,
  whenPreviewDecodeIdle,
} from "./mediaDecodeGate";
import { generateThumbnail, isTauriRuntime } from "./tauri";

const frameCache = new Map<string, Promise<string | null>>();
const resolvedFrames = new Map<string, string | null>();

/** Coarse buckets → fewer unique seeks for long clips. */
const BUCKET_SEC = 1;

function cacheKey(pathOrUrl: string, bucket: number): string {
  return `${pathOrUrl}|${bucket.toFixed(2)}`;
}

export function filmstripBucket(timeSec: number): number {
  return Math.max(0, Math.round(timeSec / BUCKET_SEC) * BUCKET_SEC);
}

function pathKeyFor(filePath: string | null | undefined, mediaUrl: string): string {
  return filePath && !filePath.startsWith("blob:") ? filePath : mediaUrl;
}

export function peekFilmstripFrame(
  filePath: string | null | undefined,
  mediaUrl: string,
  timeSec: number,
): string | null | undefined {
  const key = cacheKey(pathKeyFor(filePath, mediaUrl), filmstripBucket(timeSec));
  if (resolvedFrames.has(key)) return resolvedFrames.get(key);
  return undefined;
}

/** One shared video per URL — sequential seeks beat spawning N decoders. */
class SharedVideoSeeker {
  private ready: Promise<HTMLVideoElement> | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly url: string) {}

  /** Free decoder slot while preview plays / just after import. */
  releaseDecoder(): void {
    const video = this.videoEl;
    if (!video) return;
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore */
    }
    this.videoEl = null;
    this.ready = null;
  }

  private ensureVideo(): Promise<HTMLVideoElement> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      const fail = () => reject(new Error("video load failed"));
      video.addEventListener("error", fail, { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          this.videoEl = video;
          resolve(video);
        },
        { once: true },
      );
      video.src = this.url;
      video.load();
    });
    return this.ready;
  }

  capture(timeSec: number): Promise<string | null> {
    const run = async () => {
      try {
        const epoch = currentDecodeEpoch();
        if (isDecodeEpochStale(epoch)) return null;
        await whenDecodeSlotFree();
        if (isDecodeEpochStale(epoch)) return null;
        const video = await this.ensureVideo();
        if (isDecodeEpochStale(epoch)) return null;
        const dur = Number.isFinite(video.duration) ? video.duration : 0;
        const t =
          dur > 0 ? Math.min(Math.max(0, timeSec), Math.max(0, dur - 0.04)) : 0;
        await new Promise<void>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error("seek timeout")), 2500);
          const onSeeked = () => {
            window.clearTimeout(timer);
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
          try {
            video.currentTime = t;
          } catch (e) {
            window.clearTimeout(timer);
            video.removeEventListener("seeked", onSeeked);
            reject(e);
          }
        });
        if (isDecodeEpochStale(epoch)) return null;
        const w = Math.max(1, Math.min(64, video.videoWidth || 64));
        const h = Math.max(
          1,
          Math.round((w * (video.videoHeight || 36)) / (video.videoWidth || 64)),
        );
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, w, h);
        return canvas.toDataURL("image/jpeg", 0.45);
      } catch {
        return null;
      }
    };

    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const seekers = new Map<string, SharedVideoSeeker>();
/** Media-bin `<video>` posters that can steal the hardware decoder from preview. */
const mediaBinThumbs = new Set<HTMLVideoElement>();

function seekerFor(url: string): SharedVideoSeeker {
  let s = seekers.get(url);
  if (!s) {
    s = new SharedVideoSeeker(url);
    seekers.set(url, s);
  }
  return s;
}

export function registerMediaBinThumb(video: HTMLVideoElement): void {
  mediaBinThumbs.add(video);
}

export function unregisterMediaBinThumb(video: HTMLVideoElement): void {
  mediaBinThumbs.delete(video);
}

function releaseMediaBinThumbs(): void {
  for (const video of mediaBinThumbs) {
    try {
      video.pause();
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore */
    }
  }
}

/** Release timeline filmstrip seekers only (does not touch media-bin thumbs). */
export function releaseFilmstripSeekers(): void {
  preemptDecodersNow();
  for (const s of seekers.values()) s.releaseDecoder();
}

export function releaseFilmstripDecoders(): void {
  // Invalidate in-flight captures, free filmstrip + media-bin thumb decoders.
  releaseFilmstripSeekers();
  releaseMediaBinThumbs();
}

/** Non-blocking FFmpeg warm — only after preview is idle. */
function warmFfmpegThumb(filePath: string, timeSec: number) {
  if (!isTauriRuntime() || filePath.startsWith("blob:")) return;
  void (async () => {
    await whenPreviewDecodeIdle();
    await new Promise((r) => window.setTimeout(r, 800));
    await whenPreviewDecodeIdle();
    await generateThumbnail(filePath, timeSec).catch(() => undefined);
  })();
}

/**
 * Capture one filmstrip frame. Fast path = HTML video seek.
 * `priority: "high"` used for the first poster tile.
 */
export function getFilmstripFrame(options: {
  filePath?: string | null;
  mediaUrl: string;
  timeSec: number;
}): Promise<string | null> {
  const bucket = filmstripBucket(options.timeSec);
  const pathKey = pathKeyFor(options.filePath, options.mediaUrl);
  const key = cacheKey(pathKey, bucket);
  const existing = frameCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    await whenPreviewDecodeIdle();
    const url = await seekerFor(options.mediaUrl).capture(bucket);
    if (options.filePath) {
      warmFfmpegThumb(options.filePath, bucket);
    }
    // If HTML seek failed, last-resort FFmpeg (desktop only).
    if (!url && options.filePath && isTauriRuntime() && !options.filePath.startsWith("blob:")) {
      try {
        const result = await generateThumbnail(options.filePath, bucket);
        const converted = convertFileSrc(result.path);
        resolvedFrames.set(key, converted);
        return converted;
      } catch {
        // Don't cache failures — play/quiet may have preempted the seek.
        frameCache.delete(key);
        return null;
      }
    }
    if (!url) {
      // Preempted / seek failed — allow a later retry instead of caching null.
      frameCache.delete(key);
      return null;
    }
    resolvedFrames.set(key, url);
    return url;
  })();

  frameCache.set(key, promise);
  return promise;
}

/**
 * Sparse sample times — few tiles so import stays light.
 */
export function filmstripSampleTimes(
  sourceInSec: number,
  sourceOutSec: number,
  intervalSec = 8,
  maxTiles = 1,
): number[] {
  const span = Math.max(0.05, sourceOutSec - sourceInSec);
  const count = Math.max(1, Math.min(maxTiles, Math.ceil(span / intervalSec)));
  if (count === 1) return [sourceInSec + span * 0.5];
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    times.push(sourceInSec + ((i + 0.5) / count) * span);
  }
  return times;
}

export function pickVisibleFilmstripTimes(
  pool: number[],
  widthPx: number,
  minTilePx = 96,
): number[] {
  if (pool.length <= 1) return pool;
  const count = Math.max(
    1,
    Math.min(pool.length, Math.floor(Math.max(widthPx, 1) / minTilePx) || 1),
  );
  if (count >= pool.length) return pool;
  if (count === 1) {
    return [pool[Math.floor(pool.length / 2)]!];
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (pool.length - 1));
    out.push(pool[idx]!);
  }
  return out;
}

/** Yield to the browser between thumbnail jobs. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 120 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });
}
