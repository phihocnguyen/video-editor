import { useMemo } from "react";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { ticksToSeconds } from "../../domain";
import styles from "./TimelinePanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function TimelinePanel() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const clips = useProjectStore((s) => s.project.clips);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const timelineZoom = useEditorUiStore((s) => s.timelineZoom);
  const setTimelineZoom = useEditorUiStore((s) => s.setTimelineZoom);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);

  const pxPerSecond = 64 * timelineZoom;
  const durationSeconds = ticksToSeconds(durationTicks);
  const playheadSeconds = ticksToSeconds(playheadTicks);
  const laneWidth = Math.max(800, durationSeconds * pxPerSecond);

  const marks = useMemo(() => {
    const step = timelineZoom >= 2 ? 1 : timelineZoom >= 1 ? 2 : 5;
    const out: number[] = [];
    for (let t = 0; t <= durationSeconds + 0.001; t += step) out.push(t);
    return out;
  }, [durationSeconds, timelineZoom]);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button type="button" disabled title="Split — Milestone 2">
            ✂
          </button>
          <button type="button" disabled title="Duplicate — Milestone 2">
            ▤
          </button>
          <button type="button" disabled title="Delete — Milestone 2">
            ⌫
          </button>
          <span className={styles.timecode}>
            {formatClock(playheadSeconds)}
            <span> / {formatClock(durationSeconds)}</span>
          </span>
        </div>
        <div className={styles.zoom}>
          <button
            type="button"
            onClick={() => setTimelineZoom(timelineZoom - 0.2)}
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setTimelineZoom(timelineZoom + 0.2)}
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      <div className={styles.scroll}>
        <div className={styles.labels}>
          <div className={styles.rulerSpacer} />
          {tracks.map((track) => (
            <div key={track.id} className={styles.label}>
              <strong>{track.name}</strong>
              <span>{track.kind}</span>
            </div>
          ))}
        </div>

        <div className={styles.lanes}>
          <div
            className={styles.ruler}
            style={{ width: laneWidth }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const seconds = Math.max(0, Math.min(durationSeconds, x / pxPerSecond));
              setPlayheadTicks(Math.round(seconds * 1_000_000));
            }}
          >
            {marks.map((t) => (
              <span key={t} className={styles.mark} style={{ left: t * pxPerSecond }}>
                {formatClock(t).slice(0, 5)}
              </span>
            ))}
          </div>

          {tracks.map((track) => {
            const trackClips = clips.filter((c) => c.trackId === track.id);
            return (
              <div
                key={track.id}
                className={styles.lane}
                data-kind={track.kind}
                style={{ width: laneWidth }}
              >
                {trackClips.length === 0 ? (
                  <div className={styles.emptyLane} />
                ) : (
                  trackClips.map((clip) => {
                    const start = ticksToSeconds(clip.startTicks);
                    const dur = ticksToSeconds(clip.sourceOutTicks - clip.sourceInTicks);
                    return (
                      <div
                        key={clip.id}
                        className={styles.clip}
                        data-kind={track.kind}
                        style={{
                          left: start * pxPerSecond,
                          width: Math.max(24, dur * pxPerSecond),
                        }}
                      />
                    );
                  })
                )}
              </div>
            );
          })}

          <div
            className={styles.playhead}
            style={{ left: playheadSeconds * pxPerSecond }}
          />
        </div>
      </div>
    </div>
  );
}
