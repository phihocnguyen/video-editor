import { useEffect, useRef, useState } from "react";
import styles from "./VideoThumb.module.css";

interface VideoThumbProps {
  src: string;
  className?: string;
}

/** Shows a video poster frame once decoded — avoids prolonged black tiles. */
export function VideoThumb({ src, className }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const video = ref.current;
    if (!video) return;

    let cancelled = false;

    const show = () => {
      if (!cancelled) setReady(true);
    };

    const onMeta = () => {
      try {
        const t = Number.isFinite(video.duration) && video.duration > 0
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
  }, [src]);

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
