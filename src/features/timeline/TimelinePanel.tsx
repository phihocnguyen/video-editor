import { useMemo } from "react";
import {
  addMediaClip,
  clipDurationTicks,
  deleteClips,
  moveClip,
  splitClipAt,
  ticksToSeconds,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./TimelinePanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function TimelinePanel() {
  const project = useProjectStore((s) => s.project);
  const tracks = project.tracks;
  const clips = project.clips;
  const assets = project.assets;
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const timelineZoom = useEditorUiStore((s) => s.timelineZoom);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setTimelineZoom = useEditorUiStore((s) => s.setTimelineZoom);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

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

  function handleSplit() {
    const id = selectedClipIds[0];
    if (!id) {
      setStatusMessage("Select a clip to split");
      return;
    }
    commitProjectChange((p) => splitClipAt(p, id, playheadTicks));
    setStatusMessage("Split at playhead");
  }

  function handleDelete() {
    if (selectedClipIds.length === 0) {
      setStatusMessage("Select a clip to delete");
      return;
    }
    commitProjectChange((p) => deleteClips(p, selectedClipIds));
    setSelectedClipIds([]);
    setStatusMessage("Deleted selected clip(s)");
  }

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button type="button" onClick={handleSplit} title="Split at playhead">
            ✂
          </button>
          <button type="button" onClick={handleDelete} title="Delete selected">
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
              setSelectedClipIds([]);
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
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const assetId = e.dataTransfer.getData("text/cutline-asset");
                  if (!assetId) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const startTicks = Math.max(0, Math.round((x / pxPerSecond) * 1_000_000));
                  try {
                    commitProjectChange((p) =>
                      addMediaClip(p, assetId, { trackId: track.id, startTicks }),
                    );
                    setStatusMessage("Clip dropped on timeline");
                  } catch {
                    setStatusMessage("Drop failed — check track type");
                  }
                }}
              >
                {trackClips.length === 0 ? <div className={styles.emptyLane} /> : null}
                {trackClips.map((clip) => {
                  const start = ticksToSeconds(clip.startTicks);
                  const dur = ticksToSeconds(clipDurationTicks(clip));
                  const asset = assets.find((a) => a.id === clip.assetId);
                  const selected = selectedClipIds.includes(clip.id);
                  const label =
                    clip.kind === "text"
                      ? clip.text?.content || "Text"
                      : asset?.name ?? "Clip";
                  return (
                    <div
                      key={clip.id}
                      className={selected ? `${styles.clip} ${styles.clipSelected}` : styles.clip}
                      data-kind={clip.kind === "text" ? "text" : track.kind}
                      style={{
                        left: start * pxPerSecond,
                        width: Math.max(24, dur * pxPerSecond),
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClipIds([clip.id]);
                      }}
                      draggable
                      onDragEnd={(e) => {
                        const lane = (e.target as HTMLElement).closest(`.${styles.lane}`);
                        if (!lane) return;
                        const rect = lane.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        if (x < 0) return;
                        const startTicks = Math.max(0, Math.round((x / pxPerSecond) * 1_000_000));
                        commitProjectChange((p) => moveClip(p, clip.id, startTicks, track.id));
                      }}
                      title={label}
                    >
                      <span>{label}</span>
                    </div>
                  );
                })}
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
