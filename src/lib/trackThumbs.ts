/**
 * Timeline filmstrip thumbnails — decoder-safe by design.
 *
 * History: timeline filmstrips were once removed because per-thumbnail
 * `<video>` seekers contended with preview Play on the same hardware decoder.
 * This module brings thumbnails back with hard rules:
 *
 *  - The timeline NEVER mounts `<video>` elements. Only `<img>` is rendered.
 *  - Desktop (Tauri): captures go through the `generate_thumbnail` command —
 *    a separate FFmpeg process writing to a disk cache. It never touches the
 *    browser decoder, so it is safe even mid-Play. Concurrency is capped.
 *  - Browser fallback: exactly ONE shared hidden `<video>` seeker, used
 *    strictly serially and only while `whenPreviewDecodeIdle()` resolves.
 *    Every await is bracketed by decode-epoch checks (same protocol as
 *    `VideoThumb`), and the seeker is registered in the media-bin thumb set
 *    so a Play press pauses it immediately.
 *  - Results are cached in memory (bounded) keyed by asset + 0.5s-quantized
 *    time, so zooming only re-requests genuinely new slots. Failures retry
 *    (bounded) once the decoder is idle again — never in a render loop.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import {
  currentDecodeEpoch,
  isDecodeEpochStale,
  whenPreviewDecodeIdle,
} from "./mediaDecodeGate";
import { registerMediaBinThumb } from "./mediaFilmstrip";
import { generateThumbnail, isTauriRuntime } from "./tauri";

export interface ThumbRequest {
  assetId: string;
  /** Filesystem path for the Tauri FFmpeg path; null for blob: URLs. */
  filePath: string | null;
  /** Playable URL for the browser fallback path. */
  mediaUrl: string;
  timeSec: number;
}

/** Quantize to a 0.5s grid so zooming reuses slots instead of recapturing. */
export function quantizeThumbTime(timeSec: number): number {
  return Math.max(0, Math.round(timeSec * 2) / 2);
}

export function thumbKeyFor(assetId: string, timeSec: number): string {
  return `${assetId}@${quantizeThumbTime(timeSec).toFixed(1)}`;
}

const MAX_CACHE_ENTRIES = 240;
const MAX_RETRIES = 4;
const TAURI_MAX_INFLIGHT = 4;

const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();
const retryCount = new Map<string, number>();

let version = 0;
const listeners = new Set<() => void>();

function bump(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeTrackThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getTrackThumbsVersion(): number {
  return version;
}

export function readTrackThumb(key: string): string | null {
  return urlCache.get(key) ?? null;
}

function trimCache(): void {
  while (urlCache.size > MAX_CACHE_ENTRIES) {
    const oldest = urlCache.keys().next();
    if (oldest.done) break;
    urlCache.delete(oldest.value);
  }
}

export function requestTrackThumb(req: ThumbRequest): void {
  const timeSec = quantizeThumbTime(req.timeSec);
  const key = thumbKeyFor(req.assetId, timeSec);
  if (urlCache.has(key) || inflight.has(key) || pendingDebounce.has(key)) return;
  // Debounced: dragging/trimming recomputes slots every frame, but captures
  // must not spawn per frame — they flush once the gesture settles.
  pendingDebounce.set(key, { ...req, timeSec });
  if (typeof window !== "undefined" && debounceTimer == null) {
    debounceTimer = window.setTimeout(flushDebounced, DEBOUNCE_MS);
  }
}

const DEBOUNCE_MS = 220;
const pendingDebounce = new Map<string, ThumbRequest>();
let debounceTimer: number | null = null;

function flushDebounced(): void {
  debounceTimer = null;
  if (pendingDebounce.size === 0) return;
  const batch = [...pendingDebounce.values()];
  pendingDebounce.clear();
  for (const req of batch) {
    const key = thumbKeyFor(req.assetId, req.timeSec);
    if (urlCache.has(key) || inflight.has(key)) continue;
    startThumbJob(key, req);
  }
}

function startThumbJob(key: string, req: ThumbRequest): void {
  const job = (async () => {
    try {
      const url = await captureThumb(req);
      if (url) {
        urlCache.set(key, url);
        retryCount.delete(key);
        trimCache();
        bump();
      } else {
        scheduleRetry(req, key);
      }
    } catch {
      scheduleRetry(req, key);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
}

function scheduleRetry(req: ThumbRequest, key: string): void {
  const n = (retryCount.get(key) ?? 0) + 1;
  retryCount.set(key, n);
  if (n > MAX_RETRIES) return;
  // Idle-gated: pends through Play, resumes after — no render loop, no spin.
  void whenPreviewDecodeIdle().then(() => {
    if (urlCache.has(key) || inflight.has(key)) return;
    requestTrackThumb(req);
  });
}

async function captureThumb(req: ThumbRequest): Promise<string | null> {
  const fp = req.filePath;
  if (isTauriRuntime() && fp && !fp.startsWith("blob:")) {
    try {
      const result = await tauriSlot(() => generateThumbnail(fp, req.timeSec));
      return convertFileSrc(result.path);
    } catch {
      return null;
    }
  }
  return captureWithSharedSeeker(req);
}

/* ---------------- Tauri concurrency cap (separate processes, still bound) --- */

let tauriActive = 0;
const tauriWaiters: Array<() => void> = [];

function tauriSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (tauriActive < TAURI_MAX_INFLIGHT) {
    tauriActive += 1;
    return fn().finally(() => {
      tauriActive -= 1;
      tauriWaiters.shift()?.();
    });
  }
  return new Promise<T>((resolve, reject) => {
    tauriWaiters.push(() => {
      tauriActive += 1;
      fn().then(resolve, reject).finally(() => {
        tauriActive -= 1;
        tauriWaiters.shift()?.();
      });
    });
  });
}

/* ---------------- single shared browser seeker (strictly serial) ------------ */

let seeker: HTMLVideoElement | null = null;
let seekerUrl: string | null = null;
let seekerChain: Promise<void> = Promise.resolve();

function getSeeker(): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  if (!seeker) {
    seeker = document.createElement("video");
    seeker.muted = true;
    seeker.playsInline = true;
    seeker.preload = "auto";
    // A Play press pauses this element immediately via the hold-start hook.
    registerMediaBinThumb(seeker);
  }
  return seeker;
}

function captureWithSharedSeeker(req: ThumbRequest): Promise<string | null> {
  const run = seekerChain.then(() => seekInner(req));
  seekerChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function seekInner(req: ThumbRequest): Promise<string | null> {
  const video = getSeeker();
  if (!video) return null;
  const epoch = currentDecodeEpoch();
  await whenPreviewDecodeIdle();
  if (isDecodeEpochStale(epoch)) return null;
  try {
    if (seekerUrl !== req.mediaUrl) {
      await loadSeekerSrc(video, req.mediaUrl, epoch);
      seekerUrl = req.mediaUrl;
    }
    if (isDecodeEpochStale(epoch)) return null;
    await seekSeekerTo(video, req.timeSec, epoch);
    if (isDecodeEpochStale(epoch)) return null;
    const url = grabFrame(video);
    // Drop frames raced by a Play press — never poison the cache.
    return isDecodeEpochStale(epoch) ? null : url;
  } catch {
    return null;
  } finally {
    try {
      video.pause();
    } catch {
      /* ignore */
    }
  }
}

function loadSeekerSrc(
  video: HTMLVideoElement,
  url: string,
  epoch: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("error", onError);
      if (ok && !isDecodeEpochStale(epoch)) resolve();
      else reject(new Error("seeker load aborted"));
    };
    const onMeta = () => finish(true);
    const onError = () => finish(false);
    const watchdog = window.setTimeout(() => finish(false), 8000);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("error", onError);
    try {
      video.src = url;
      video.load();
    } catch {
      finish(false);
    }
  });
}

function seekSeekerTo(
  video: HTMLVideoElement,
  timeSec: number,
  epoch: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      if (ok && !isDecodeEpochStale(epoch)) resolve();
      else reject(new Error("seeker seek aborted"));
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    const watchdog = window.setTimeout(() => finish(false), 5000);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      const dur = video.duration;
      const t =
        Number.isFinite(dur) && dur > 0
          ? Math.min(Math.max(0, timeSec), Math.max(0, dur - 0.05))
          : Math.max(0, timeSec);
      if (Math.abs(video.currentTime - t) < 0.001) finish(true);
      else video.currentTime = t;
    } catch {
      finish(false);
    }
  });
}

const CAPTURE_W = 192;

function grabFrame(video: HTMLVideoElement): string | null {
  try {
    const vw = video.videoWidth || CAPTURE_W;
    const vh = video.videoHeight || Math.round((CAPTURE_W * 9) / 16);
    if (vw <= 0 || vh <= 0) return null;
    const w = Math.min(CAPTURE_W, vw);
    const h = Math.max(1, Math.round((w * vh) / vw));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", 0.65);
    return url && url.length > 64 ? url : null;
  } catch {
    return null;
  }
}
