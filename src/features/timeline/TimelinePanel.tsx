import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  addMediaClip,
  addTrack,
  clipDurationTicks,
  deleteClips,
  moveClip,
  projectDurationTicks,
  removeTrack,
  snapTicks,
  splitClipAt,
  ticksToSeconds,
  trimClip,
  updateTrack,
} from "../../domain";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSettingsStore } from "../../stores/settingsStore";
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
  const setDurationTicks = useEditorUiStore((s) => s.setDurationTicks);
  const timelineZoom = useEditorUiStore((s) => s.timelineZoom);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const snapEnabled = useEditorUiStore((s) => s.snapEnabled);
  const setTimelineZoom = useEditorUiStore((s) => s.setTimelineZoom);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const setScrubbing = useEditorUiStore((s) => s.setScrubbing);
  const setSnapEnabled = useSettingsStore((s) => s.setSnapEnabled);

  const lanesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const rafRef = useRef(0);
  const pendingTicksRef = useRef(playheadTicks);
  const scrubMoveRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const scrubEndRef = useRef<() => void>(() => undefined);

  const pxPerSecond = 64 * timelineZoom;
  const durationSeconds = ticksToSeconds(durationTicks);
  const playheadSeconds = ticksToSeconds(playheadTicks);
  const laneWidth = Math.max(800, durationSeconds * pxPerSecond);

  useEffect(() => {
    setDurationTicks(projectDurationTicks(clips));
  }, [clips, setDurationTicks]);

  useEffect(() => {
    if (!scrubbingRef.current && playheadRef.current) {
      playheadRef.current.style.left = `${playheadSeconds * pxPerSecond}px`;
    }
  }, [playheadSeconds, pxPerSecond]);

  const marks = useMemo(() => {
    const step = timelineZoom >= 2 ? 1 : timelineZoom >= 1 ? 2 : 5;
    const out: number[] = [];
    for (let t = 0; t <= durationSeconds + 0.001; t += step) out.push(t);
    return out;
  }, [durationSeconds, timelineZoom]);

  const ticksFromClientX = useCallback(
    (clientX: number) => {
      const lanes = lanesRef.current;
      if (!lanes) return 0;
      const rect = lanes.getBoundingClientRect();
      const x = Math.max(0, Math.min(laneWidth, clientX - rect.left));
      let ticks = Math.round((x / pxPerSecond) * 1_000_000);
      if (snapEnabled) {
        ticks = snapTicks(ticks, clips, {
          thresholdTicks: Math.round(0.15 * 1_000_000 / Math.max(0.5, timelineZoom)),
          extraTargets: [playheadTicks],
        });
      }
      return Math.max(0, Math.min(durationTicks, ticks));
    },
    [clips, durationTicks, laneWidth, playheadTicks, pxPerSecond, snapEnabled, timelineZoom],
  );

  const applyScrubTicks = useCallback(
    (ticks: number, immediateStore: boolean) => {
      const x = ticksToSeconds(ticks) * pxPerSecond;
      if (playheadRef.current) {
        playheadRef.current.style.left = `${x}px`;
      }
      pendingTicksRef.current = ticks;
      if (immediateStore) {
        setPlayheadTicks(ticks);
        return;
      }
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          setPlayheadTicks(pendingTicksRef.current);
        });
      }
    },
    [pxPerSecond, setPlayheadTicks],
  );

  const endScrub = useCallback(() => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    setScrubbing(false);
    setPlayheadTicks(pendingTicksRef.current);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    window.removeEventListener("pointermove", scrubMoveRef.current);
    window.removeEventListener("pointerup", scrubEndRef.current);
    window.removeEventListener("pointercancel", scrubEndRef.current);
  }, [setPlayheadTicks, setScrubbing]);

  scrubMoveRef.current = (event: PointerEvent) => {
    if (!scrubbingRef.current) return;
    applyScrubTicks(ticksFromClientX(event.clientX), false);
  };
  scrubEndRef.current = () => {
    endScrub();
  };

  const beginScrub = useCallback(
    (clientX: number) => {
      scrubbingRef.current = true;
      setPlaying(false);
      setScrubbing(true);
      setSelectedClipIds([]);
      applyScrubTicks(ticksFromClientX(clientX), true);
      window.addEventListener("pointermove", scrubMoveRef.current);
      window.addEventListener("pointerup", scrubEndRef.current);
      window.addEventListener("pointercancel", scrubEndRef.current);
    },
    [applyScrubTicks, setPlaying, setScrubbing, setSelectedClipIds, ticksFromClientX],
  );

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
          <button type="button" onClick={handleSplit} title="Split at playhead" aria-label="Split">
            <svg className={styles.toolIcon} viewBox="0 0 16 16" aria-hidden>
              <path
                fill="currentColor"
                d="M4.2 1.8a1.5 1.5 0 1 0-.9 2.8L5.8 7l-2.5 2.4a1.5 1.5 0 1 0 .9 2.8L8 8.7l3.8 3.5a1.5 1.5 0 1 0 .9-2.8L10.2 7l2.5-2.4a1.5 1.5 0 1 0-.9-2.8L8 5.3 4.2 1.8Z"
              />
            </svg>
          </button>
          <button type="button" onClick={handleDelete} title="Delete selected" aria-label="Delete">
            <svg className={styles.toolIcon} viewBox="0 0 16 16" aria-hidden>
              <path
                fill="currentColor"
                d="M6.2 2h3.6l.4 1.2H13v1.4H3V3.2h2.8L6.2 2Zm.8 3.4h1.5v7H7V5.4Zm3 0h1.5v7H10V5.4ZM4.8 4.8h6.4l-.5 8.1A1.4 1.4 0 0 1 9.3 14H6.7a1.4 1.4 0 0 1-1.4-1.1L4.8 4.8Z"
              />
            </svg>
          </button>
          <button
            type="button"
            className={snapEnabled ? styles.toolOn : undefined}
            onClick={() => setSnapEnabled(!snapEnabled)}
            title="Snap to clip edges"
            aria-label="Snap to clip edges"
            aria-pressed={snapEnabled}
          >
            <svg className={styles.toolIcon} viewBox="0 0 16 16" aria-hidden>
              <path
                fill="currentColor"
                d="M3.2 1.8h2.3v5c0 1.5-.9 2.5-2.2 2.5S1.1 8.3 1.1 6.8V4.8h1.6v2c0 .5.2.8.6.8s.6-.3.6-.8v-5Zm7.3 0h2.3v5c0 .5.2.8.6.8s.6-.3.6-.8v-2h1.6v2c0 1.5-.9 2.5-2.2 2.5s-2.2-1-2.2-2.5v-5ZM2.8 11h10.4v1.5H2.8V11Zm1.8 2.2h6.8V15H4.6v-1.8Z"
              />
            </svg>
          </button>
          <span className={styles.timecode}>
            {formatClock(playheadSeconds)}
            <span> / {formatClock(durationSeconds)}</span>
          </span>
        </div>
        <div className={styles.zoom}>
          <button
            type="button"
            title="Add video track"
            onClick={() => {
              commitProjectChange((p) => addTrack(p, "video"));
              setStatusMessage("Added video track");
            }}
          >
            +V
          </button>
          <button
            type="button"
            title="Add audio track"
            onClick={() => {
              commitProjectChange((p) => addTrack(p, "audio"));
              setStatusMessage("Added audio track");
            }}
          >
            +A
          </button>
          <button type="button" onClick={() => setTimelineZoom(timelineZoom - 0.2)} title="Zoom out">
            −
          </button>
          <button type="button" onClick={() => setTimelineZoom(timelineZoom + 0.2)} title="Zoom in">
            +
          </button>
        </div>
      </div>

      <div className={styles.scroll}>
        <div className={styles.labels}>
          <div className={styles.rulerSpacer} />
          {tracks.map((track) => (
            <div key={track.id} className={styles.label}>
              <div className={styles.labelTop}>
                <strong>{track.name}</strong>
                <span>{track.kind}</span>
              </div>
              <div className={styles.trackControls}>
                <button
                  type="button"
                  className={track.muted ? styles.trackCtrlOn : undefined}
                  title={track.muted ? "Unmute" : "Mute"}
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { muted: !track.muted }),
                    )
                  }
                >
                  M
                </button>
                <button
                  type="button"
                  className={!track.visible ? styles.trackCtrlOn : undefined}
                  title={track.visible ? "Hide" : "Show"}
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { visible: !track.visible }),
                    )
                  }
                >
                  V
                </button>
                <button
                  type="button"
                  className={track.locked ? styles.trackCtrlOn : undefined}
                  title={track.locked ? "Unlock" : "Lock"}
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { locked: !track.locked }),
                    )
                  }
                >
                  L
                </button>
                <button
                  type="button"
                  title="Remove track"
                  onClick={() => {
                    try {
                      commitProjectChange((p) => removeTrack(p, track.id));
                      setStatusMessage(`Removed ${track.name}`);
                    } catch (error) {
                      setStatusMessage(
                        error instanceof Error ? error.message : "Cannot remove track",
                      );
                    }
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        <div ref={lanesRef} className={styles.lanes}>
          <div
            className={styles.ruler}
            style={{ width: laneWidth }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              beginScrub(e.clientX);
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
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest(`.${styles.clip}`)) return;
                  e.preventDefault();
                  beginScrub(e.clientX);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const assetId = e.dataTransfer.getData("text/cutline-asset");
                  if (!assetId) return;
                  const startTicks = ticksFromClientX(e.clientX);
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
                      onPointerDown={(e) => e.stopPropagation()}
                      draggable
                      onDragEnd={(e) => {
                        if (track.locked) {
                          setStatusMessage("Track is locked");
                          return;
                        }
                        let startTicks = ticksFromClientX(e.clientX);
                        if (snapEnabled) {
                          startTicks = snapTicks(
                            startTicks,
                            clips.filter((c) => c.id !== clip.id),
                            { extraTargets: [playheadTicks] },
                          );
                        }
                        try {
                          commitProjectChange((p) =>
                            moveClip(p, clip.id, startTicks, track.id),
                          );
                        } catch (error) {
                          setStatusMessage(
                            error instanceof Error ? error.message : "Move failed",
                          );
                        }
                      }}
                      title={label}
                    >
                      {selected ? (
                        <>
                          <span
                            className={styles.trimHandle}
                            data-edge="left"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              const originX = e.clientX;
                              const originIn = clip.sourceInTicks;
                              const originOut = clip.sourceOutTicks;
                              const originStart = clip.startTicks;
                              const before = useProjectStore.getState().project;
                              useHistoryStore.getState().pushHistory(before);
                              const onMove = (ev: PointerEvent) => {
                                const deltaTicks = Math.round(
                                  ((ev.clientX - originX) / pxPerSecond) * 1_000_000,
                                );
                                const nextIn = Math.min(
                                  originOut - 100_000,
                                  Math.max(0, originIn + deltaTicks),
                                );
                                const applied = nextIn - originIn;
                                let next = trimClip(before, clip.id, nextIn, originOut);
                                next = moveClip(next, clip.id, originStart + applied, track.id);
                                useProjectStore.getState().setProject(next, { dirty: true });
                              };
                              const onUp = () => {
                                window.removeEventListener("pointermove", onMove);
                                window.removeEventListener("pointerup", onUp);
                              };
                              window.addEventListener("pointermove", onMove);
                              window.addEventListener("pointerup", onUp);
                            }}
                          />
                          <span
                            className={`${styles.trimHandle} ${styles.trimHandleRight}`}
                            data-edge="right"
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              e.currentTarget.setPointerCapture(e.pointerId);
                              const originX = e.clientX;
                              const originIn = clip.sourceInTicks;
                              const originOut = clip.sourceOutTicks;
                              const before = useProjectStore.getState().project;
                              useHistoryStore.getState().pushHistory(before);
                              const onMove = (ev: PointerEvent) => {
                                const deltaTicks = Math.round(
                                  ((ev.clientX - originX) / pxPerSecond) * 1_000_000,
                                );
                                const nextOut = Math.max(originIn + 100_000, originOut + deltaTicks);
                                const next = trimClip(before, clip.id, originIn, nextOut);
                                useProjectStore.getState().setProject(next, { dirty: true });
                              };
                              const onUp = () => {
                                window.removeEventListener("pointermove", onMove);
                                window.removeEventListener("pointerup", onUp);
                              };
                              window.addEventListener("pointermove", onMove);
                              window.addEventListener("pointerup", onUp);
                            }}
                          />
                        </>
                      ) : null}
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div
            ref={playheadRef}
            className={styles.playhead}
            style={{ left: playheadSeconds * pxPerSecond }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              beginScrub(e.clientX);
            }}
          />
        </div>
      </div>
    </div>
  );
}
