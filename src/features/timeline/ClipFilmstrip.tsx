import { useEffect, useMemo, useState } from "react";
import { whenPreviewDecodeIdle } from "../../lib/mediaDecodeGate";
import {
  filmstripSampleTimes,
  getFilmstripFrame,
  peekFilmstripFrame,
  pickVisibleFilmstripTimes,
  yieldToMain,
} from "../../lib/mediaFilmstrip";
import styles from "./ClipMediaVisual.module.css";

interface ClipFilmstripProps {
  mediaUrl: string;
  filePath?: string | null;
  kind: "video" | "image";
  sourceInSec: number;
  sourceOutSec: number;
  widthPx: number;
}

const TILE_PX = 56;

export function ClipFilmstrip({
  mediaUrl,
  filePath,
  kind,
  sourceInSec,
  sourceOutSec,
  widthPx,
}: ClipFilmstripProps) {
  const poolTimes = useMemo(
    () =>
      kind === "image"
        ? [sourceInSec]
        : filmstripSampleTimes(sourceInSec, sourceOutSec),
    [kind, sourceInSec, sourceOutSec],
  );

  const visibleTimes = useMemo(
    () =>
      kind === "image"
        ? poolTimes
        : pickVisibleFilmstripTimes(poolTimes, widthPx, 140),
    [kind, poolTimes, widthPx],
  );

  const span = Math.max(0.05, sourceOutSec - sourceInSec);
  const [poolFrames, setPoolFrames] = useState<Map<number, string | null>>(
    () => new Map(),
  );

  useEffect(() => {
    if (kind === "image") {
      setPoolFrames(new Map([[sourceInSec, mediaUrl]]));
      return;
    }

    let cancelled = false;
    const initial = new Map<number, string | null>();
    for (const t of visibleTimes) {
      initial.set(t, peekFilmstripFrame(filePath, mediaUrl, t) ?? null);
    }
    setPoolFrames(initial);

    void (async () => {
      // Let preview claim the decoder first (UHD import).
      await new Promise((r) => window.setTimeout(r, 900));
      if (cancelled) return;
      await whenPreviewDecodeIdle();
      if (cancelled) return;

      for (const timeSec of visibleTimes) {
        if (cancelled) return;
        if (peekFilmstripFrame(filePath, mediaUrl, timeSec) != null) continue;
        await whenPreviewDecodeIdle();
        if (cancelled) return;
        const url = await getFilmstripFrame({ filePath, mediaUrl, timeSec });
        if (cancelled) return;
        setPoolFrames((prev) => {
          const next = new Map(prev);
          next.set(timeSec, url);
          return next;
        });
        await yieldToMain();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filePath, kind, mediaUrl, sourceInSec, visibleTimes]);

  return (
    <div className={styles.filmstrip} aria-hidden>
      {visibleTimes.map((t) => {
        const src = poolFrames.get(t) ?? null;
        if (!src) return null;
        const u = (t - sourceInSec) / span;
        const left = Math.max(0, u * widthPx - TILE_PX / 2);
        return (
          <img
            key={t}
            className={styles.tile}
            src={src}
            alt=""
            draggable={false}
            style={{ left: `${left}px`, width: `${TILE_PX}px` }}
          />
        );
      })}
    </div>
  );
}
