import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { whenPreviewDecodeIdle } from "../lib/mediaDecodeGate";
import { generateThumbnail, isTauriRuntime } from "../lib/tauri";
import styles from "./VideoThumb.module.css";

interface VideoThumbProps {
  src: string;
  filePath?: string | null;
  className?: string;
}

/**
 * Media-bin poster. Never contends with preview play — waits for decode idle.
 */
export function VideoThumb({ src, filePath, className }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (cachedSrc) return;
    setReady(false);
    const video = ref.current;
    if (!video) return;

    let cancelled = false;
    const show = () => {
      if (!cancelled) setReady(true);
    };

    const onMeta = () => {
      void (async () => {
        await whenPreviewDecodeIdle();
        if (cancelled) return;
        try {
          const t =
            Number.isFinite(video.duration) && video.duration > 0
              ? Math.min(0.15, video.duration * 0.05)
              : 0.05;
          video.currentTime = t;
        } catch {
          show();
        }
      })();
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", show);
    video.addEventListener("error", show);
    video.preload = "metadata";
    // Defer so preview can attach first after import.
    const start = window.setTimeout(() => {
      void (async () => {
        await whenPreviewDecodeIdle();
        if (cancelled) return;
        video.src = src;
        video.load();
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", show);
      video.removeEventListener("error", show);
    };
  }, [cachedSrc, src]);

  useEffect(() => {
    if (!isTauriRuntime() || !filePath || filePath.startsWith("blob:")) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        await whenPreviewDecodeIdle();
        if (cancelled) return;
        try {
          const result = await generateThumbnail(filePath, 0.5);
          if (cancelled) return;
          setCachedSrc(convertFileSrc(result.path));
          setReady(true);
        } catch {
          /* ignore */
        }
      })();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filePath]);

  if (cachedSrc) {
    return (
      <div className={`${styles.wrap} ${className ?? ""}`}>
        {!ready ? <div className={styles.skeleton} /> : null}
        <img
          className={ready ? styles.videoReady : styles.videoHidden}
          src={cachedSrc}
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
