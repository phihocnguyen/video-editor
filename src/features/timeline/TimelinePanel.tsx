import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  addMediaClip,
  addTrack,
  applySpeedToRange,
  clipDurationTicks,
  deleteClips,
  moveClip,
  moveTrack,
  normalizeClipTransition,
  projectDurationTicks,
  removeTrack,
  snapTicks,
  splitClipAt,
  ticksToSeconds,
  trimClip,
  updateClipTransition,
  updateTrack,
} from "../../domain";
import {
  copySelectedClips,
  cutSelectedClips,
  duplicateSelectedClips,
  pasteClipboardClips,
} from "../../lib/clipClipboard";
import { resolveMediaUrl } from "../../lib/mediaUrl";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { ClipFilmstrip } from "./ClipFilmstrip";
import { ClipWaveform } from "./ClipWaveform";
import styles from "./TimelinePanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function TimelinePanel() {
  const project = useProjectStore((s) => s.project);
  const tracks = useMemo(
    () => [...project.tracks].sort((a, b) => a.order - b.order),
    [project.tracks],
  );
  const clips = project.clips;
  const assets = project.assets;
  const [trackMenu, setTrackMenu] = useState<{
    trackId: string;
    x: number;
    y: number;
  } | null>(null);
  const [clipMenu, setClipMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const clipClipboard = useEditorUiStore((s) => s.clipClipboard);
  const markInTicks = useEditorUiStore((s) => s.markInTicks);
  const markOutTicks = useEditorUiStore((s) => s.markOutTicks);
  // Intentionally NOT subscribed to playheadTicks — that re-rendered every clip at 60fps.
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
  const trackLabelWidthPx = useEditorUiStore((s) => s.trackLabelWidthPx);
  const setTrackLabelWidthPx = useEditorUiStore((s) => s.setTrackLabelWidthPx);

  const lanesRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timecodeRef = useRef<HTMLSpanElement>(null);
  const scrubbingRef = useRef(false);
  const rafRef = useRef(0);
  const pendingTicksRef = useRef(useEditorUiStore.getState().playheadTicks);
  const pxPerSecondRef = useRef(64);
  const scrubMoveRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const scrubEndRef = useRef<() => void>(() => undefined);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const clipDragRef = useRef<{
    clipId: string;
    originTrackId: string;
    grabOffsetTicks: number;
    lastTrackId: string;
  } | null>(null);

  const pxPerSecond = 64 * timelineZoom;
  pxPerSecondRef.current = pxPerSecond;
  const durationSeconds = ticksToSeconds(durationTicks);
  const laneWidth = Math.max(800, durationSeconds * pxPerSecond);

  useEffect(() => {
    setDurationTicks(projectDurationTicks(clips));
  }, [clips, setDurationTicks]);

  // Drive playhead + timecode via DOM — no React re-render of the lane/clips.
  useEffect(() => {
    const paint = (ticks: number) => {
      pendingTicksRef.current = ticks;
      const x = ticksToSeconds(ticks) * pxPerSecondRef.current;
      if (!scrubbingRef.current && playheadRef.current) {
        playheadRef.current.style.left = `${x}px`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = formatClock(ticksToSeconds(ticks));
      }
    };
    paint(useEditorUiStore.getState().playheadTicks);
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks !== prev.playheadTicks) paint(s.playheadTicks);
    });
  }, []);

  // Keep playhead X in sync when zoom changes (no playhead store subscription).
  useEffect(() => {
    const ticks = pendingTicksRef.current;
    if (playheadRef.current) {
      playheadRef.current.style.left = `${ticksToSeconds(ticks) * pxPerSecond}px`;
    }
  }, [pxPerSecond]);

  useEffect(() => {
    if (!clipMenu && !trackMenu) return;
    const close = () => {
      setClipMenu(null);
      setTrackMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [clipMenu, trackMenu]);

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
          extraTargets: [useEditorUiStore.getState().playheadTicks],
        });
      }
      return Math.max(0, Math.min(durationTicks, ticks));
    },
    [clips, durationTicks, laneWidth, pxPerSecond, snapEnabled, timelineZoom],
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
    commitProjectChange((p) =>
      splitClipAt(p, id, useEditorUiStore.getState().playheadTicks),
    );
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

  const trackIdFromClientY = useCallback((clientY: number) => {
    const lanes = lanesRef.current;
    if (!lanes) return null;
    const els = lanes.querySelectorAll<HTMLElement>("[data-track-id]");
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return el.dataset.trackId ?? null;
      }
    }
    return null;
  }, []);

  const beginClipSlide = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, clipId: string, trackId: string) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest(`.${styles.trimHandle}`)) return;

      const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId);
      if (track?.locked) {
        setStatusMessage("Track is locked");
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      setPlaying(false);
      setSelectedClipIds([clipId]);

      const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId);
      if (!clip) return;

      // Open Clip / Text side panel so effects & props are visible.
      if (clip.kind === "text") {
        useEditorUiStore.getState().setActivePanel("text");
      } else {
        const asset = useProjectStore
          .getState()
          .project.assets.find((a) => a.id === clip.assetId);
        if (asset?.kind !== "audio") {
          useEditorUiStore.getState().setActivePanel("clip");
        }
      }

      const pointerTicks = ticksFromClientX(event.clientX);
      const grabOffsetTicks = pointerTicks - clip.startTicks;
      const before = useProjectStore.getState().project;
      useHistoryStore.getState().pushHistory(before);

      clipDragRef.current = {
        clipId,
        originTrackId: trackId,
        grabOffsetTicks,
        lastTrackId: trackId,
      };
      setDraggingClipId(clipId);

      const onMove = (ev: PointerEvent) => {
        const drag = clipDragRef.current;
        if (!drag) return;
        let startTicks = ticksFromClientX(ev.clientX) - drag.grabOffsetTicks;
        startTicks = Math.max(0, startTicks);
        const hoverTrackId = trackIdFromClientY(ev.clientY) ?? drag.lastTrackId;
        drag.lastTrackId = hoverTrackId;

        if (snapEnabled) {
          const others = useProjectStore
            .getState()
            .project.clips.filter((c) => c.id !== drag.clipId);
          startTicks = snapTicks(startTicks, others, {
            thresholdTicks: Math.round((0.15 * 1_000_000) / Math.max(0.5, timelineZoom)),
            extraTargets: [useEditorUiStore.getState().playheadTicks],
          });
        }

        try {
          const next = moveClip(
            useProjectStore.getState().project,
            drag.clipId,
            startTicks,
            hoverTrackId,
          );
          useProjectStore.getState().setProject(next, { dirty: true });
        } catch {
          try {
            const next = moveClip(
              useProjectStore.getState().project,
              drag.clipId,
              startTicks,
              drag.originTrackId,
            );
            useProjectStore.getState().setProject(next, { dirty: true });
          } catch {
            /* keep last good position */
          }
        }
      };

      const onUp = () => {
        clipDragRef.current = null;
        setDraggingClipId(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [
      setPlaying,
      setSelectedClipIds,
      setStatusMessage,
      snapEnabled,
      ticksFromClientX,
      timelineZoom,
      trackIdFromClientY,
    ],
  );

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
            <span ref={timecodeRef}>
              {formatClock(ticksToSeconds(useEditorUiStore.getState().playheadTicks))}
            </span>
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

      <div
        className={styles.scroll}
        style={{ ["--track-label-w" as string]: `${trackLabelWidthPx}px` }}
      >
        <div
          className={styles.labels}
          onClick={() => {
            setTrackMenu(null);
            setClipMenu(null);
          }}
        >
          <button
            type="button"
            className={styles.labelSplit}
            aria-label="Resize track labels"
            title="Drag to resize track labels"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              const startX = e.clientX;
              const startW = trackLabelWidthPx;
              const onMove = (ev: PointerEvent) => {
                setTrackLabelWidthPx(startW + (ev.clientX - startX));
              };
              const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
              };
              window.addEventListener("pointermove", onMove);
              window.addEventListener("pointerup", onUp);
            }}
          />
          <div className={styles.rulerSpacer} />
          {tracks.map((track) => (
            <div
              key={track.id}
              className={styles.label}
              onContextMenu={(e) => {
                e.preventDefault();
                setClipMenu(null);
                setTrackMenu({ trackId: track.id, x: e.clientX, y: e.clientY });
              }}
            >
              <div className={styles.labelTop}>
                <strong>{track.name}</strong>
              </div>
              <div className={styles.trackControls}>
                <button
                  type="button"
                  title="Move up"
                  onClick={() => {
                    try {
                      commitProjectChange((p) => moveTrack(p, track.id, "up"));
                    } catch (error) {
                      setStatusMessage(
                        error instanceof Error ? error.message : "Cannot move",
                      );
                    }
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  title="Move down"
                  onClick={() => {
                    try {
                      commitProjectChange((p) => moveTrack(p, track.id, "down"));
                    } catch (error) {
                      setStatusMessage(
                        error instanceof Error ? error.message : "Cannot move",
                      );
                    }
                  }}
                >
                  ↓
                </button>
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
                data-track-id={track.id}
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
                {trackClips
                  .slice()
                  .sort((a, b) => a.startTicks - b.startTicks)
                  .map((clip, clipIndex, ordered) => {
                  const start = ticksToSeconds(clip.startTicks);
                  const dur = ticksToSeconds(clipDurationTicks(clip));
                  const asset = assets.find((a) => a.id === clip.assetId);
                  const selected = selectedClipIds.includes(clip.id);
                  const dragging = draggingClipId === clip.id;
                  const label =
                    clip.kind === "text"
                      ? clip.text?.content || "Text"
                      : asset?.name ?? "Clip";
                  const tin = normalizeClipTransition(clip.transitionIn);
                  const prev = clipIndex > 0 ? ordered[clipIndex - 1] : null;
                  const showTx =
                    Boolean(prev) &&
                    track.kind === "video" &&
                    clip.kind === "media" &&
                    asset?.kind !== "audio";
                  const clipWidthPx = Math.max(24, dur * pxPerSecond);
                  const mediaUrl =
                    asset && !asset.missing
                      ? resolveMediaUrl(asset.path, asset.id)
                      : null;
                  const sourceInSec = ticksToSeconds(clip.sourceInTicks);
                  const sourceOutSec = ticksToSeconds(clip.sourceOutTicks);
                  const showFilmstrip =
                    clip.kind === "media" &&
                    track.kind === "video" &&
                    mediaUrl &&
                    (asset?.kind === "video" || asset?.kind === "image");
                  const showWaveform =
                    clip.kind === "media" &&
                    track.kind === "audio" &&
                    mediaUrl &&
                    (asset?.kind === "audio" || asset?.hasAudio);
                  return (
                    <div key={clip.id}>
                    {showTx ? (
                      <button
                        type="button"
                        className={
                          tin.type !== "none"
                            ? `${styles.transitionMark} ${styles.transitionMarkOn}`
                            : styles.transitionMark
                        }
                        style={{ left: start * pxPerSecond }}
                        title={
                          tin.type === "none"
                            ? "Add transition"
                            : `Transition: ${tin.type} · click to cycle`
                        }
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          const cycle = [
                            "none",
                            "dissolve",
                            "fade",
                            "wipeLeft",
                            "wipeRight",
                          ] as const;
                          const idx = cycle.indexOf(
                            tin.type === "none" ? "none" : tin.type,
                          );
                          const nextType = cycle[(idx + 1) % cycle.length];
                          commitProjectChange((p) =>
                            updateClipTransition(p, clip.id, {
                              type: nextType,
                              durationTicks:
                                nextType === "none"
                                  ? tin.durationTicks
                                  : Math.max(tin.durationTicks, 600_000),
                            }),
                          );
                          setSelectedClipIds([clip.id]);
                          useEditorUiStore.getState().setActivePanel("clip");
                          setStatusMessage(
                            nextType === "none"
                              ? "Transition cleared"
                              : `Transition → ${nextType}`,
                          );
                        }}
                      >
                        <span>{tin.type === "none" ? "+" : "◆"}</span>
                      </button>
                    ) : null}
                    <div
                      className={[
                        styles.clip,
                        selected ? styles.clipSelected : "",
                        dragging ? styles.clipDragging : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-kind={clip.kind === "text" ? "text" : track.kind}
                      style={{
                        left: start * pxPerSecond,
                        width: clipWidthPx,
                      }}
                      onPointerDown={(e) => beginClipSlide(e, clip.id, track.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrackMenu(null);
                        const ids = selectedClipIds.includes(clip.id)
                          ? selectedClipIds
                          : [clip.id];
                        setSelectedClipIds(ids);
                        setClipMenu({ x: e.clientX, y: e.clientY });
                      }}
                      title={label}
                    >
                      {showFilmstrip && asset && mediaUrl ? (
                        <ClipFilmstrip
                          mediaUrl={mediaUrl}
                          filePath={asset.path}
                          kind={asset.kind === "image" ? "image" : "video"}
                          sourceInSec={sourceInSec}
                          sourceOutSec={sourceOutSec}
                          widthPx={clipWidthPx}
                        />
                      ) : null}
                      {showWaveform && asset && mediaUrl ? (
                        <ClipWaveform
                          cacheKey={asset.id}
                          mediaUrl={mediaUrl}
                          sourceInSec={sourceInSec}
                          sourceOutSec={sourceOutSec}
                          widthPx={clipWidthPx}
                          heightPx={40}
                        />
                      ) : null}
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
                      <span className={styles.clipLabel}>{label}</span>
                    </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div
            ref={playheadRef}
            className={styles.playhead}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              e.preventDefault();
              beginScrub(e.clientX);
            }}
          />
        </div>
      </div>

      {clipMenu ? (
        <div
          className={styles.ctxMenu}
          style={{ left: clipMenu.x, top: clipMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              cutSelectedClips();
              setClipMenu(null);
            }}
          >
            Cut
            <kbd className={styles.ctxKbd}>Ctrl+X</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              copySelectedClips();
              setClipMenu(null);
            }}
          >
            Copy
            <kbd className={styles.ctxKbd}>Ctrl+C</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!clipClipboard?.length}
            onClick={() => {
              pasteClipboardClips();
              setClipMenu(null);
            }}
          >
            Paste
            <kbd className={styles.ctxKbd}>Ctrl+V</kbd>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              duplicateSelectedClips();
              setClipMenu(null);
            }}
          >
            Duplicate
            <kbd className={styles.ctxKbd}>Ctrl+D</kbd>
          </button>
          <div className={styles.ctxSep} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (id) {
                commitProjectChange((p) =>
                  splitClipAt(p, id, useEditorUiStore.getState().playheadTicks),
                );
                setStatusMessage("Split at playhead");
              }
              setClipMenu(null);
            }}
          >
            Split at playhead
          </button>
          <div className={styles.ctxSep} />
          {[0.5, 2].map((speed) => (
            <button
              key={speed}
              type="button"
              role="menuitem"
              disabled={
                markInTicks == null ||
                markOutTicks == null ||
                markOutTicks <= markInTicks
              }
              onClick={() => {
                const id = useEditorUiStore.getState().selectedClipIds[0];
                if (!id || markInTicks == null || markOutTicks == null) return;
                try {
                  let midId = id;
                  commitProjectChange((p) => {
                    const result = applySpeedToRange(
                      p,
                      id,
                      markInTicks,
                      markOutTicks,
                      speed,
                    );
                    midId = result.midClipId;
                    return result.project;
                  });
                  setSelectedClipIds([midId]);
                  setStatusMessage(`Speed ${speed}× on In/Out range`);
                } catch (error) {
                  setStatusMessage(
                    error instanceof Error
                      ? error.message
                      : "Speed range failed",
                  );
                }
                setClipMenu(null);
              }}
            >
              Speed {speed}× on In/Out
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              useEditorUiStore.getState().setActivePanel("clip");
              setStatusMessage("Clip properties");
              setClipMenu(null);
            }}
          >
            Clip properties
          </button>
          <div className={styles.ctxSep} />
          <button
            type="button"
            role="menuitem"
            className={styles.ctxDanger}
            onClick={() => {
              const ids = useEditorUiStore.getState().selectedClipIds;
              if (ids.length > 0) {
                commitProjectChange((p) => deleteClips(p, ids));
                setSelectedClipIds([]);
                setStatusMessage("Deleted");
              }
              setClipMenu(null);
            }}
          >
            Delete
            <kbd className={styles.ctxKbd}>Del</kbd>
          </button>
        </div>
      ) : null}

      {trackMenu ? (
        <div
          className={styles.ctxMenu}
          style={{ left: trackMenu.x, top: trackMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!clipClipboard?.length}
            onClick={() => {
              pasteClipboardClips();
              setTrackMenu(null);
            }}
          >
            Paste
            <kbd className={styles.ctxKbd}>Ctrl+V</kbd>
          </button>
          <div className={styles.ctxSep} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              try {
                commitProjectChange((p) => moveTrack(p, trackMenu.trackId, "up"));
                setStatusMessage("Track moved up");
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Cannot move",
                );
              }
              setTrackMenu(null);
            }}
          >
            Move up
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              try {
                commitProjectChange((p) => moveTrack(p, trackMenu.trackId, "down"));
                setStatusMessage("Track moved down");
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Cannot move",
                );
              }
              setTrackMenu(null);
            }}
          >
            Move down
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.ctxDanger}
            onClick={() => {
              try {
                const name =
                  project.tracks.find((t) => t.id === trackMenu.trackId)?.name ??
                  "track";
                commitProjectChange((p) => removeTrack(p, trackMenu.trackId));
                setStatusMessage(`Deleted ${name}`);
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Cannot delete track",
                );
              }
              setTrackMenu(null);
            }}
          >
            Delete track
          </button>
        </div>
      ) : null}
    </div>
  );
}
