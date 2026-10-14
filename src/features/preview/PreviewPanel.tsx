import { useEffect, useMemo, useRef, useState } from "react";
import { clipDurationTicks, ticksToSeconds } from "../../domain";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { TextOverlayLayer } from "./TextOverlayLayer";
import { useTimelineAudio } from "./useTimelineAudio";
import styles from "./PreviewPanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function PreviewPanel() {
  const canvas = useProjectStore((s) => s.project.canvas);
  const clips = useProjectStore((s) => s.project.clips);
  const assets = useProjectStore((s) => s.project.assets);
  const tracks = useProjectStore((s) => s.project.tracks);
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const isScrubbing = useEditorUiStore((s) => s.isScrubbing);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastSeekAtRef = useRef(0);
  const [mediaReady, setMediaReady] = useState(false);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);

  const active = useMemo(() => {
    const videoTracks = tracks
      .filter((t) => t.kind === "video" && t.visible)
      .sort((a, b) => b.order - a.order);
    for (const track of videoTracks) {
      const hit = clips.find(
        (c) =>
          c.trackId === track.id &&
          c.kind === "media" &&
          playheadTicks >= c.startTicks &&
          playheadTicks < c.startTicks + clipDurationTicks(c),
      );
      if (hit?.assetId) {
        const asset = assets.find((a) => a.id === hit.assetId);
        if (asset && !asset.missing) {
          return { clip: hit, asset };
        }
      }
    }
    return null;
  }, [assets, clips, playheadTicks, tracks]);

  const mediaUrl = active
    ? resolveMediaUrl(active.asset.path, active.asset.id)
    : null;
  const mediaKey = active ? `${active.asset.id}:${active.clip.id}` : "";

  const activeTexts = useMemo(() => {
    return clips.filter(
      (c) =>
        c.kind === "text" &&
        c.text &&
        playheadTicks >= c.startTicks &&
        playheadTicks < c.startTicks + clipDurationTicks(c),
    );
  }, [clips, playheadTicks]);

  useTimelineAudio({
    clips,
    tracks,
    assets,
    playheadTicks,
    isPlaying,
    isScrubbing,
  });

  useEffect(() => {
    setMediaReady(false);
  }, [mediaKey]);

  useEffect(() => {
    if (!isPlaying || isScrubbing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useEditorUiStore.getState().playheadTicks + Math.round(dt * 1_000_000);
      if (next >= durationTicks) {
        setPlayheadTicks(durationTicks);
        setPlaying(false);
        return;
      }
      setPlayheadTicks(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationTicks, isPlaying, isScrubbing, setPlayheadTicks, setPlaying]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active || active.asset.kind !== "video") return;

    const track = tracks.find((t) => t.id === active.clip.trackId);
    const muted = Boolean(track?.muted) || !active.asset.hasAudio;
    video.muted = muted;
    video.volume = Math.min(
      1,
      Math.max(0, active.clip.volume * (track?.volume ?? 1)),
    );

    const localSec =
      ticksToSeconds(playheadTicks - active.clip.startTicks) +
      ticksToSeconds(active.clip.sourceInTicks);
    const target = Math.max(0, localSec);

    if (isPlaying && !isScrubbing) {
      void video.play().catch(() => undefined);
      if (Math.abs(video.currentTime - target) > 0.35) {
        video.currentTime = target;
      }
      return;
    }

    video.pause();
    const now = performance.now();
    const minInterval = isScrubbing ? 40 : 0;
    if (now - lastSeekAtRef.current < minInterval) return;
    if (Math.abs(video.currentTime - target) < 0.04) return;
    lastSeekAtRef.current = now;
    try {
      video.currentTime = target;
    } catch {
      /* ignore seek before ready */
    }
  }, [active, isPlaying, isScrubbing, playheadTicks, tracks]);

  return (
    <div className={styles.panel}>
      <div className={styles.stageWrap}>
        <div
          ref={stageRef}
          className={styles.stage}
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "VIDEO" || (e.target as HTMLElement).tagName === "IMG") {
              if (selectedClipIds.length > 0) setSelectedClipIds([]);
            }
          }}
        >
          {mediaUrl && active?.asset.kind === "video" ? (
            <>
              {!mediaReady ? <div className={styles.loading}>Loading frame…</div> : null}
              <video
                key={mediaKey}
                ref={videoRef}
                className={mediaReady ? styles.media : styles.mediaHidden}
                src={mediaUrl}
                playsInline
                preload="auto"
                muted={false}
                onLoadedData={(e) => {
                  const video = e.currentTarget;
                  if (!active) return;
                  const localSec = ticksToSeconds(active.clip.sourceInTicks);
                  try {
                    video.currentTime = Math.max(0, localSec);
                  } catch {
                    /* ignore */
                  }
                }}
                onSeeked={() => setMediaReady(true)}
                onCanPlay={() => setMediaReady(true)}
              />
            </>
          ) : mediaUrl && active?.asset.kind === "image" ? (
            <img className={styles.media} src={mediaUrl} alt="" onLoad={() => setMediaReady(true)} />
          ) : (
            <div className={styles.placeholder}>
              <div className={styles.badge}>Preview</div>
              <p>Import media and add clips to the timeline.</p>
              <span>Active-clip preview — multi-track compositing still limited</span>
            </div>
          )}
          <TextOverlayLayer
            clips={activeTexts}
            canvasWidth={canvas.width}
            canvasHeight={canvas.height}
            stageRef={stageRef}
          />
        </div>
      </div>

      <div className={styles.transport}>
        <div className={styles.transportLeft}>
          <button
            type="button"
            onClick={() => setPlayheadTicks(Math.max(0, playheadTicks - 1_000_000))}
            title="Back 1s"
          >
            ⏮
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => setPlaying(!isPlaying)}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={() =>
              setPlayheadTicks(Math.min(durationTicks, playheadTicks + 1_000_000))
            }
            title="Forward 1s"
          >
            ⏭
          </button>
        </div>
        <div className={styles.clock}>
          {formatClock(ticksToSeconds(playheadTicks))}
          <span> / </span>
          {formatClock(ticksToSeconds(durationTicks))}
        </div>
        <button type="button" className={styles.fullscreen} disabled title="Fullscreen">
          ⛶
        </button>
      </div>
    </div>
  );
}
