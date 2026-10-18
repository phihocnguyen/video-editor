import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  currentDecodeEpoch,
  isDecodeEpochStale,
  whenPreviewDecodeIdle,
} from "../lib/mediaDecodeGate";
import {
  registerMediaBinThumb,
  unregisterMediaBinThumb,
} from "../lib/mediaFilmstrip";
import { mediaFileFallbackUrl } from "../lib/mediaUrl";
import { generateThumbnail, isTauriRuntime } from "../lib/tauri";
import styles from "./VideoThumb.module.css";

interface VideoThumbProps {
  src: string;
  filePath?: string | null;
  className?: string;
}

interface PosterShot {
  url: string;
  bright: boolean;
}

/** Times likely to hold a picture. Lyric clips often stay black for the first second. */
function posterTimes(duration: number): number[] {
  const span = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const last = Math.max(0, span - 0.05);
  const raw =
    span > 1.8 ? [1.6, 2.5, 4, span * 0.2, span * 0.45, 0.4] : [span * 0.5, span * 0.2, 0];
  const times: number[] = [];
  for (const t of raw) {
    const clamped = Math.min(Math.max(0, t), last);
    if (!times.some((item) => Math.abs(item - clamped) < 0.05)) times.push(clamped);
  }
  return times.length > 0 ? times : [0];
}

function capturePoster(video: HTMLVideoElement): PosterShot | null {
  if (video.videoWidth < 2 || video.videoHeight < 2) return null;
  try {
    const w = Math.min(160, video.videoWidth);
    const h = Math.max(1, Math.round((w * video.videoHeight) / video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let max = 0;
    for (let i = 0; i < data.length; i += 16) {
      const v = (data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0);
      if (v > max) max = v;
    }
    return { url: canvas.toDataURL("image/jpeg", 0.7), bright: max > 24 };
  } catch {
    return null;
  }
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.08 && video.readyState >= 2) {
      resolve(true);
      return;
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve(ok);
    };
    const onSeeked = () => finish(true);
    const timer = window.setTimeout(() => finish(false), 2500);
    video.addEventListener("seeked", onSeeked);
    try {
      video.currentTime = time;
    } catch {
      finish(false);
    }
  });
}

function releaseVideoEl(video: HTMLVideoElement): void {
  try {
    video.pause();
    video.removeAttribute("src");
    video.load();
  } catch {
    /* ignore */
  }
}

/**
 * Media-bin poster. Prefers FFmpeg (no browser decoder contention); falls back
 * to a one-shot HTML seek that captures a still then frees the element.
 */
export function VideoThumb({ src, filePath, className }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [posterSrc, setPosterSrc] = useState<string | null>(null);
  const gotPosterRef = useRef(false);

  // Desktop: FFmpeg thumbnail — separate process, can start immediately.
  useEffect(() => {
    if (!isTauriRuntime() || !filePath || filePath.startsWith("blob:")) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await generateThumbnail(filePath, 0.5);
        if (cancelled || gotPosterRef.current) return;
        gotPosterRef.current = true;
        setPosterSrc(convertFileSrc(result.path));
        setReady(true);
      } catch {
        /* fall through to HTML path */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // HTML seek fallback. Retries when a quiet/play epoch invalidates the job.
  useEffect(() => {
    if (posterSrc) return;
    setReady(false);
    const video = ref.current;
    if (!video) return;

    let cancelled = false;
    registerMediaBinThumb(video);

    const seekOnce = (epoch: number): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(watchdog);
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onError);
          resolve(ok);
        };

        const acceptPoster = (url: string) => {
          releaseVideoEl(video);
          gotPosterRef.current = true;
          setPosterSrc(url);
          setReady(true);
        };

        const onMeta = () => {
          void (async () => {
            await whenPreviewDecodeIdle();
            if (cancelled || isDecodeEpochStale(epoch) || gotPosterRef.current) {
              finish(false);
              return;
            }
            let fallback: string | null = null;
            let moved = false;
            for (const time of posterTimes(video.duration)) {
              if (cancelled || isDecodeEpochStale(epoch) || gotPosterRef.current) {
                finish(false);
                return;
              }
              const before = video.currentTime;
              const sought = await seekVideo(video, time);
              if (!sought) continue;
              if (Math.abs(video.currentTime - before) > 0.08) moved = true;
              await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
              const shot = capturePoster(video);
              if (!shot) continue;
              fallback = shot.url;
              if (shot.bright) {
                acceptPoster(shot.url);
                finish(true);
                return;
              }
              if (!moved && time > 0.2) break;
            }
            if (!fallback || !moved) {
              try {
                video.muted = true;
                await video.play();
              } catch {
                /* autoplay can be blocked; fall through to the still we have */
              }
              const started = performance.now();
              while (performance.now() - started < 3500 && !cancelled && !gotPosterRef.current) {
                await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
                const shot = capturePoster(video);
                if (shot?.bright) {
                  video.pause();
                  acceptPoster(shot.url);
                  finish(true);
                  return;
                }
                if (shot) fallback = shot.url;
              }
              video.pause();
            }
            if (fallback && !gotPosterRef.current) {
              acceptPoster(fallback);
              finish(true);
              return;
            }
            setReady(true);
            finish(true);
          })();
        };

        const onError = () => {
          const next = mediaFileFallbackUrl(video.currentSrc || video.src || src);
          if (next && video.dataset.mediaFallback !== "1") {
            video.dataset.mediaFallback = "1";
            video.src = next;
            video.load();
            return;
          }
          // Likely preempted by Play/quiet (src cleared) — retry, don't mark ready.
          finish(false);
        };

        const watchdog = window.setTimeout(() => finish(false), 12000);

        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onError);
        video.preload = "auto";
        if (src.startsWith("http:") || src.startsWith("https:")) {
          video.crossOrigin = "anonymous";
        } else {
          video.removeAttribute("crossorigin");
        }
        video.src = src;
        video.load();
      });

    void (async () => {
      while (!cancelled && !gotPosterRef.current) {
        const epoch = currentDecodeEpoch();
        await whenPreviewDecodeIdle();
        if (cancelled || gotPosterRef.current) return;
        if (isDecodeEpochStale(epoch)) continue;

        const done = await seekOnce(epoch);
        if (cancelled || gotPosterRef.current || done) return;
        // Epoch went stale mid-seek — loop and retry.
      }
    })();

    return () => {
      cancelled = true;
      unregisterMediaBinThumb(video);
      releaseVideoEl(video);
    };
  }, [posterSrc, src]);

  if (posterSrc) {
    return (
      <div className={`${styles.wrap} ${className ?? ""}`}>
        {!ready ? <div className={styles.skeleton} /> : null}
        <img
          className={ready ? styles.videoReady : styles.videoHidden}
          src={posterSrc}
          alt=""
          draggable={false}
          onLoad={() => setReady(true)}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.wrap} ${className ?? ""}`}>
      {!ready ? <div className={styles.skeleton} /> : null}
      <video
        ref={ref}
        className={ready ? styles.videoReady : styles.videoHidden}
        muted
        playsInline
        preload="metadata"
        draggable={false}
      />
    </div>
  );
}
