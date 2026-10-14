import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { generateThumbnail, isTauriRuntime } from "../lib/tauri";
import styles from "./VideoThumb.module.css";

interface VideoThumbProps {
  src: string;
  /** Absolute filesystem path for FFmpeg disk cache (desktop). */
  filePath?: string | null;
  className?: string;
}

/** Shows a poster frame — prefers FFmpeg disk cache on desktop, else HTML video seek. */
export function VideoThumb({ src, filePath, className }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [cachedSrc, setCachedSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setCachedSrc(null);

    if (isTauriRuntime() && filePath && !filePath.startsWith("blob:")) {
      void generateThumbnail(filePath, 0.5)
        .then((result) => {
          if (cancelled) return;
          setCachedSrc(convertFileSrc(result.path));
          setReady(true);
        })
        .catch(() => {
          /* fall through to HTML video */
        });
    }

    return () => {
      cancelled = true;
    };
  }, [filePath, src]);

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
      try {
        const t =
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.min(0.15, video.duration * 0.05)
            : 0.05;
        video.currentTime = t;
      } catch {
        show();
      }
    };

    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", show);
    video.addEventListener("loadeddata", show);
    video.addEventListener("error", show);
    video.src = src;
    video.load();

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", show);
      video.removeEventListener("loadeddata", show);
      video.removeEventListener("error", show);
    };
  }, [cachedSrc, src]);

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
        preload="auto"
      />
    </div>
  );
}
