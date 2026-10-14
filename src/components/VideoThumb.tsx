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
import { generateThumbnail, isTauriRuntime } from "../lib/tauri";
import styles from "./VideoThumb.module.css";

interface VideoThumbProps {
  src: string;
  filePath?: string | null;
  className?: string;
}

function capturePoster(video: HTMLVideoElement): string | null {
  try {
    const w = Math.max(1, Math.min(160, video.videoWidth || 160));
    const h = Math.max(
      1,
      Math.round((w * (video.videoHeight || 90)) / (video.videoWidth || 160)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
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
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          resolve(ok);
        };

        const onMeta = () => {
          void (async () => {
            await whenPreviewDecodeIdle();
            if (cancelled || isDecodeEpochStale(epoch)) {
              finish(false);
              return;
            }
            try {
              const t =
                Number.isFinite(video.duration) && video.duration > 0
                  ? Math.min(0.15, video.duration * 0.05)
                  : 0.05;
              video.currentTime = t;
            } catch {
              finish(false);
            }
          })();
        };

        const onSeeked = () => {
          if (cancelled || isDecodeEpochStale(epoch) || gotPosterRef.current) {
            finish(false);
            return;
          }
          const dataUrl = capturePoster(video);
          releaseVideoEl(video);
          if (dataUrl) {
            gotPosterRef.current = true;
            setPosterSrc(dataUrl);
            setReady(true);
            finish(true);
          } else {
            setReady(true);
            finish(true);
          }
        };

        const onError = () => {
          // Likely preempted by Play/quiet (src cleared) — retry, don't mark ready.
          finish(false);
        };

        const watchdog = window.setTimeout(() => finish(false), 4000);

        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        video.preload = "metadata";
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
      />
    </div>
  );
}
