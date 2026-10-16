import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  addMediaClip,
  addRampPointAtPlayhead,
  addTrack,
  applySpeedToRange,
  clipDisplayTitle,
  clipDurationTicks,
  clipHasEffectLook,
  clipShortLabel,
  deleteClips,
  enableSpeedRamp,
  findMatchingFilterTemplate,
  fitFilterFull,
  canFitFilterFull,
  hasActiveRamp,
  hasEffectKeyframes,
  hasTransformKeyframes,
  linkClips,
  linkedClipIds,
  moveClip,
  moveClipLayer,
  moveTrack,
  normalizeClipEffects,
  normalizeClipTransition,
  normalizeEffectKeyframes,
  normalizeTransformKeyframes,
  projectDurationTicks,
  pruneEmptyTrack,
  relockClipDuration,
  removeTrack,
  setClipRamp,
  snapTicks,
  splitClipAt,
  ticksToSeconds,
  TRANSITION_DEFS,
  trimClip,
  unlinkClip,
  updateClipEffects,
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
import {
  DEFAULT_TRACK_HEIGHT_PX,
  editFollowsLink,
  useEditorUiStore,
} from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  DiamondIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  LockOpenIcon,
  MagnetIcon,
  PlusIcon,
  SplitIcon,
  TrashIcon,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "../../components/icons";
import { ClipFilmstrip } from "./ClipFilmstrip";
import { ClipWaveform } from "./ClipWaveform";
import { RampEditor } from "./RampEditor";
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

  const clipMenuRef = useRef<HTMLDivElement>(null);
  const trackMenuRef = useRef<HTMLDivElement>(null);

  /** Anchor for a context menu — final top/left is resolved after measure. */
  function placeCtxMenu(clientX: number, clientY: number): { x: number; y: number } {
    return { x: clientX, y: clientY };
  }

  /** Pin menu above the cursor; flip below only if it would clip the top. */
  function fitCtxMenuAbove(
    el: HTMLDivElement | null,
    anchor: { x: number; y: number } | null,
  ) {
    if (!el || !anchor) return;
    const pad = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.x;
    let top = anchor.y - h - 4;
    if (top < pad) top = anchor.y + 4;
    if (top + h > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - h - pad);
    }
    if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
    if (left < pad) left = pad;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  }

  useLayoutEffect(() => {
    fitCtxMenuAbove(clipMenuRef.current, clipMenu);
  }, [clipMenu]);

  useLayoutEffect(() => {
    fitCtxMenuAbove(
      trackMenuRef.current,
      trackMenu ? { x: trackMenu.x, y: trackMenu.y } : null,
    );
  }, [trackMenu]);
  const clipClipboard = useEditorUiStore((s) => s.clipClipboard);
  const markInTicks = useEditorUiStore((s) => s.markInTicks);
  const markOutTicks = useEditorUiStore((s) => s.markOutTicks);
  // Intentionally NOT subscribed to playheadTicks — that re-rendered every clip at 60fps.
  const durationTicks = useEditorUiStore((s) => s.durationTicks);
  const setDurationTicks = useEditorUiStore((s) => s.setDurationTicks);
  const timelineZoom = useEditorUiStore((s) => s.timelineZoom);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const selectedTrackId = useEditorUiStore((s) => s.selectedTrackId);
  const trackHeightsPx = useEditorUiStore((s) => s.trackHeightsPx);
  const snapEnabled = useEditorUiStore((s) => s.snapEnabled);
  const setTimelineZoom = useEditorUiStore((s) => s.setTimelineZoom);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setLinkBypassClipIds = useEditorUiStore((s) => s.setLinkBypassClipIds);
  const setSelectedTrackId = useEditorUiStore((s) => s.setSelectedTrackId);
  const nudgeTrackHeight = useEditorUiStore((s) => s.nudgeTrackHeight);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const setScrubbing = useEditorUiStore((s) => s.setScrubbing);
  const setSnapEnabled = useSettingsStore((s) => s.setSnapEnabled);
  const trackLabelWidthPx = useEditorUiStore((s) => s.trackLabelWidthPx);
  const setTrackLabelWidthPx = useEditorUiStore((s) => s.setTrackLabelWidthPx);

  function trackHeight(trackId: string): number {
    return trackHeightsPx[trackId] ?? DEFAULT_TRACK_HEIGHT_PX;
  }

  // Single selected media clip — target for the speed-ramp overlay/menu.
  const rampTargetClip =
    selectedClipIds.length === 1
      ? clips.find((c) => c.id === selectedClipIds[0] && c.kind === "media") ?? null
      : null;

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
    const d = projectDurationTicks(clips);
    setDurationTicks(d);
    // Clips shortened/deleted under the playhead (trim, delete, split) would
    // otherwise leave the line floating past the lane end — worse the more
    // you zoom. Pull it back inside.
    if (useEditorUiStore.getState().playheadTicks > d) {
      setPlayheadTicks(Math.max(0, d));
    }
  }, [clips, setDurationTicks, setPlayheadTicks]);

  // Drive playhead + timecode via DOM — no React re-render of the lane/clips.
  // While playing, also auto-scroll the lanes so the blue line stays in view
  // and matches the transport progress (only when it leaves the viewport —
  // never fights a manual scroll inside the view).
  useEffect(() => {
    const paint = (ticks: number) => {
      // Belt-and-suspenders with the duration effect above: no path may push
      // the line past the lane end (it would float outside the tracks).
      const durTicks = useEditorUiStore.getState().durationTicks;
      const clamped = Math.max(0, Math.min(durTicks, ticks));
      pendingTicksRef.current = clamped;
      const x = ticksToSeconds(clamped) * pxPerSecondRef.current;
      if (!scrubbingRef.current && playheadRef.current) {
        playheadRef.current.style.left = `${x}px`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.textContent = formatClock(ticksToSeconds(ticks));
      }
      const ui = useEditorUiStore.getState();
      if (ui.isPlaying && !ui.isScrubbing && !scrubbingRef.current) {
        let scroller: HTMLElement | null | undefined = lanesRef.current?.parentElement;
        while (scroller && scroller.scrollWidth <= scroller.clientWidth + 1) {
          scroller = scroller.parentElement;
        }
        if (scroller) {
          const leftVisible = scroller.scrollLeft;
          const rightVisible = leftVisible + scroller.clientWidth;
          if (x < leftVisible + 24 || x > rightVisible - 80) {
            scroller.scrollLeft = Math.max(0, x - 80);
          }
        }
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

  // Wheel routing (Premiere-style, no overlap):
  // - Alt+wheel anywhere on lanes → time zoom (length).
  // - Ctrl/Meta+wheel on the RULER → time zoom.
  // - Ctrl/Meta+wheel on a track lane → track height (handled below).
  // Plain wheel keeps native scroll. Pinch gestures arrive as ctrl+wheel.
  useEffect(() => {
    const lanes = lanesRef.current;
    if (!lanes) return;
    let pending = 1;
    let raf = 0;
    let anchorClientX = 0;
    const findScroller = (): HTMLElement | null => {
      let el: HTMLElement | null = lanes.parentElement;
      while (el && el.scrollWidth <= el.clientWidth + 1) el = el.parentElement;
      return el;
    };
    const apply = () => {
      raf = 0;
      const factor = pending;
      pending = 1;
      if (factor === 1) return;
      const ui = useEditorUiStore.getState();
      const oldZoom = ui.timelineZoom;
      const newZoom = Math.min(8, Math.max(0.25, oldZoom * factor));
      if (newZoom === oldZoom) return;
      const rect = lanes.getBoundingClientRect();
      const cursorX = Math.max(0, anchorClientX - rect.left);
      const scroller = findScroller();
      const scrollLeft = scroller ? scroller.scrollLeft : 0;
      const tSec = (scrollLeft + cursorX) / (64 * oldZoom);
      ui.setTimelineZoom(newZoom);
      requestAnimationFrame(() => {
        const s2 = findScroller();
        if (s2) s2.scrollLeft = Math.max(0, tSec * 64 * newZoom - cursorX);
      });
    };
    const onWheel = (e: WheelEvent) => {
      const wantZoom = e.altKey
        ? true
        : (e.ctrlKey || e.metaKey) &&
          Boolean(
            (e.target as HTMLElement | null)?.closest?.(`.${styles.ruler}`),
          );
      if (!wantZoom) return; // lane Ctrl+wheel belongs to track height below
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      pending *= Math.exp(-dy * 0.0016);
      if (!Number.isFinite(pending)) pending = 1;
      pending = Math.min(4, Math.max(0.25, pending));
      anchorClientX = e.clientX;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    lanes.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      lanes.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

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
    const out: { t: number; major: boolean }[] = [];
    for (let t = 0; t <= durationSeconds + 0.001; t += step) {
      out.push({ t, major: true });
      // Light intermediate ticks halfway between labels for finer reading.
      const half = t + step / 2;
      if (half <= durationSeconds + 0.001) out.push({ t: half, major: false });
    }
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
      splitClipAt(p, id, useEditorUiStore.getState().playheadTicks, {
        followLink: editFollowsLink([id]),
      }),
    );
    setStatusMessage("Split at playhead");
  }

  function handleDelete() {
    if (selectedClipIds.length === 0) {
      setStatusMessage("Select a clip to delete");
      return;
    }
    commitProjectChange((p) =>
      deleteClips(p, selectedClipIds, { followLink: editFollowsLink(selectedClipIds) }),
    );
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
      if (
        target.closest(`.${styles.trimHandle}`) ||
        target.closest(`.${styles.fadeHandle}`)
      ) {
        return;
      }

      const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId);
      if (track?.locked) {
        setStatusMessage("Track is locked");
        return;
      }

      event.stopPropagation();
      event.preventDefault();
      setPlaying(false);
      const alt = event.altKey;
      const ids = alt
        ? [clipId]
        : linkedClipIds(useProjectStore.getState().project, clipId);
      setSelectedClipIds(ids);
      if (alt) setLinkBypassClipIds([clipId]);
      setSelectedTrackId(trackId);

      const clip = useProjectStore.getState().project.clips.find((c) => c.id === clipId);
      if (!clip) return;

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
            { followLink: !alt },
          );
          useProjectStore.getState().setProject(next, { dirty: true });
        } catch {
          try {
            const next = moveClip(
              useProjectStore.getState().project,
              drag.clipId,
              startTicks,
              drag.originTrackId,
              { followLink: !alt },
            );
            useProjectStore.getState().setProject(next, { dirty: true });
          } catch {
            /* keep last good position */
          }
        }
      };

      const onUp = () => {
        const drag = clipDragRef.current;
        clipDragRef.current = null;
        setDraggingClipId(null);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        // Dropped onto another track → remove the now-empty origin lane.
        if (drag && drag.lastTrackId !== drag.originTrackId) {
          const before = useProjectStore.getState().project;
          const pruned = pruneEmptyTrack(before, drag.originTrackId);
          if (pruned !== before) {
            useProjectStore.getState().setProject(pruned, { dirty: true });
            if (useEditorUiStore.getState().selectedTrackId === drag.originTrackId) {
              setSelectedTrackId(drag.lastTrackId);
            }
          }
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [
      setPlaying,
      setLinkBypassClipIds,
      setSelectedClipIds,
      setSelectedTrackId,
      setStatusMessage,
      snapEnabled,
      ticksFromClientX,
      timelineZoom,
      trackIdFromClientY,
    ],
  );

  // Premiere-style track height: Ctrl+= / Ctrl+- / Ctrl+wheel on selected track.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const trackId = useEditorUiStore.getState().selectedTrackId;
      if (!trackId) return;
      const key = e.key;
      if (key === "=" || key === "+") {
        e.preventDefault();
        nudgeTrackHeight(trackId, 12);
      } else if (key === "-" || key === "_") {
        e.preventDefault();
        nudgeTrackHeight(trackId, -12);
      }
    }

    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey) return; // Alt+wheel is time zoom (handled above)
      const target = (e.target as HTMLElement | null) ?? null;
      // Only when pointer is over the timeline panel.
      const panel = target?.closest?.(`.${styles.panel}`);
      if (!panel) return;
      if (target?.closest?.(`.${styles.ruler}`)) return; // ruler Ctrl+wheel is time zoom
      const trackId = useEditorUiStore.getState().selectedTrackId;
      if (!trackId) return;
      e.preventDefault();
      nudgeTrackHeight(trackId, e.deltaY < 0 ? 12 : -12);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [nudgeTrackHeight]);

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.toolGroup}>
            <button type="button" onClick={handleSplit} title="Split at playhead" aria-label="Split">
              <SplitIcon className={styles.toolIcon} />
            </button>
            <button type="button" onClick={handleDelete} title="Delete selected" aria-label="Delete">
              <TrashIcon className={styles.toolIcon} />
            </button>
            <button
              type="button"
              className={snapEnabled ? styles.toolOn : undefined}
              onClick={() => setSnapEnabled(!snapEnabled)}
              title="Snap to clip edges"
              aria-label="Snap to clip edges"
              aria-pressed={snapEnabled}
            >
              <MagnetIcon className={styles.toolIcon} />
            </button>
          </div>
          <span className={styles.timecode}>
            <span ref={timecodeRef}>
              {formatClock(ticksToSeconds(useEditorUiStore.getState().playheadTicks))}
            </span>
            <span> / {formatClock(durationSeconds)}</span>
          </span>
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.toolGroup}>
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
          </div>
          <div className={styles.toolGroup}>
            <button
              type="button"
              onClick={() => setTimelineZoom(timelineZoom - 0.2)}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOutIcon className={styles.toolIcon} />
            </button>
            <input
              type="range"
              className={styles.zoomSlider}
              min={0.25}
              max={8}
              step={0.05}
              value={timelineZoom}
              onChange={(e) => setTimelineZoom(Number(e.target.value))}
              title={`Zoom ${timelineZoom.toFixed(1)}× — Alt+wheel: zoom length · Ctrl+wheel on a track: track height`}
              aria-label="Timeline zoom"
            />
            <button
              type="button"
              onClick={() => setTimelineZoom(timelineZoom + 0.2)}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomInIcon className={styles.toolIcon} />
            </button>
          </div>
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
              className={
                selectedTrackId === track.id
                  ? `${styles.label} ${styles.labelSelected}`
                  : styles.label
              }
              style={{ height: trackHeight(track.id) }}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                setSelectedTrackId(track.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setClipMenu(null);
                setSelectedTrackId(track.id);
                setTrackMenu({
                  trackId: track.id,
                  ...placeCtxMenu(e.clientX, e.clientY),
                });
              }}
            >
              <div className={styles.labelTop}>
                <strong>{track.name}</strong>
                <span className={styles.labelKind}>{track.kind}</span>
              </div>
              <div className={styles.trackControls}>
                <button
                  type="button"
                  title="Move up"
                  aria-label="Move track up"
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
                  <ChevronUpIcon size={13} />
                </button>
                <button
                  type="button"
                  title="Move down"
                  aria-label="Move track down"
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
                  <ChevronDownIcon size={13} />
                </button>
                <button
                  type="button"
                  className={track.muted ? styles.trackCtrlOn : undefined}
                  title={track.muted ? "Unmute" : "Mute"}
                  aria-label="Toggle mute"
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { muted: !track.muted }),
                    )
                  }
                >
                  <VolumeIcon size={13} />
                </button>
                <button
                  type="button"
                  className={!track.visible ? styles.trackCtrlOn : undefined}
                  title={track.visible ? "Hide" : "Show"}
                  aria-label="Toggle visibility"
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { visible: !track.visible }),
                    )
                  }
                >
                  {track.visible ? <EyeIcon size={13} /> : <EyeOffIcon size={13} />}
                </button>
                <button
                  type="button"
                  className={track.locked ? styles.trackCtrlOn : undefined}
                  title={track.locked ? "Unlock" : "Lock"}
                  aria-label="Toggle lock"
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateTrack(p, track.id, { locked: !track.locked }),
                    )
                  }
                >
                  {track.locked ? <LockIcon size={13} /> : <LockOpenIcon size={13} />}
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
            {marks.map((m) =>
              m.major ? (
                <span key={`m-${m.t}`}>
                  <span className={styles.rulerTickMajor} style={{ left: m.t * pxPerSecond }} />
                  <span className={styles.mark} style={{ left: m.t * pxPerSecond }}>
                    {formatClock(m.t).slice(0, 5)}
                  </span>
                </span>
              ) : (
                <span
                  key={`t-${m.t}`}
                  className={styles.rulerTick}
                  style={{ left: m.t * pxPerSecond }}
                />
              ),
            )}
          </div>

          {tracks.map((track) => {
            const trackClips = clips.filter((c) => c.trackId === track.id);
            const h = trackHeight(track.id);
            return (
              <div
                key={track.id}
                className={
                  selectedTrackId === track.id
                    ? `${styles.lane} ${styles.laneSelected}`
                    : styles.lane
                }
                data-kind={track.kind}
                data-track-id={track.id}
                style={{ width: laneWidth, height: h }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if ((e.target as HTMLElement).closest(`.${styles.clip}`)) return;
                  e.preventDefault();
                  setSelectedTrackId(track.id);
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
                    setSelectedTrackId(track.id);
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
                  const label = clipShortLabel(project, clip, asset);
                  const labelTitle = clipDisplayTitle(project, clip, asset);
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
                          const cycle = TRANSITION_DEFS.map((d) => d.type);
                          const idx = cycle.indexOf(
                            tin.type === "none" ? "none" : tin.type,
                          );
                          const nextType =
                            cycle[(idx + 1 + cycle.length) % cycle.length] ?? "none";
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
                          setStatusMessage(
                            nextType === "none"
                              ? "Transition cleared"
                              : `Transition → ${nextType}`,
                          );
                        }}
                      >
                        <span>
                          {tin.type === "none" ? <PlusIcon size={11} /> : <DiamondIcon size={10} />}
                        </span>
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
                      data-kind={
                        clip.kind === "text" ? "text" : clip.kind === "filter" ? "filter" : track.kind
                      }
                      style={{
                        left: start * pxPerSecond,
                        width: clipWidthPx,
                      }}
                      onPointerDown={(e) => beginClipSlide(e, clip.id, track.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrackMenu(null);
                        const alt = e.altKey;
                        const already = selectedClipIds.includes(clip.id);
                        const ids = alt
                          ? [clip.id]
                          : already
                            ? selectedClipIds
                            : linkedClipIds(project, clip.id);
                        setSelectedClipIds(ids);
                        if (alt) setLinkBypassClipIds([clip.id]);
                        setClipMenu(placeCtxMenu(e.clientX, e.clientY));
                      }}
                      title={labelTitle}
                    >
                      {(() => {
                        const showFilmstrip =
                          clip.kind === "media" &&
                          track.kind === "video" &&
                          (asset?.kind === "video" || asset?.kind === "image") &&
                          mediaUrl != null;
                        if (!showFilmstrip || !asset || !mediaUrl) return null;
                        return (
                          <ClipFilmstrip
                            clip={clip}
                            asset={asset}
                            mediaUrl={mediaUrl}
                            widthPx={clipWidthPx}
                          />
                        );
                      })()}
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
                      {hasActiveRamp(clip.speedRamp) ? (
                        <RampEditor
                          clip={clip}
                          widthPx={clipWidthPx}
                          heightPx={42}
                          interactive={selected}
                        />
                      ) : null}
                      {(() => {
                        const canFade =
                          clip.kind === "media" && asset?.kind !== "audio";
                        if (!canFade) return null;
                        const fx = normalizeClipEffects(clip.effects);
                        const durSec = Math.max(
                          0.05,
                          ticksToSeconds(clipDurationTicks(clip)),
                        );
                        const fadeInPx = Math.min(
                          clipWidthPx,
                          fx.fadeInSec * pxPerSecond,
                        );
                        const fadeOutPx = Math.min(
                          clipWidthPx,
                          fx.fadeOutSec * pxPerSecond,
                        );
                        const beginFadeDrag = (
                          e: ReactPointerEvent<HTMLSpanElement>,
                          edge: "in" | "out",
                        ) => {
                          // Vegas-style: Ctrl/Cmd + drag top corner → black fade.
                          if (!e.ctrlKey && !e.metaKey) return;
                          e.stopPropagation();
                          e.preventDefault();
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const originX = e.clientX;
                          const originIn = fx.fadeInSec;
                          const originOut = fx.fadeOutSec;
                          const before = useProjectStore.getState().project;
                          useHistoryStore.getState().pushHistory(before);
                          setStatusMessage(
                            edge === "in"
                              ? "Fade in (black) — drag right to lengthen"
                              : "Fade out (black) — drag left to lengthen",
                          );
                          const onMove = (ev: PointerEvent) => {
                            const deltaSec = (ev.clientX - originX) / pxPerSecond;
                            const maxFade = Math.max(0, durSec - 0.05);
                            if (edge === "in") {
                              const fadeInSec = Math.min(
                                maxFade,
                                Math.max(0, originIn + deltaSec),
                              );
                              const next = updateClipEffects(before, clip.id, {
                                fadeInSec,
                                fadeOutSec: Math.min(originOut, maxFade - fadeInSec),
                              });
                              useProjectStore.getState().setProject(next, { dirty: true });
                            } else {
                              const fadeOutSec = Math.min(
                                maxFade,
                                Math.max(0, originOut - deltaSec),
                              );
                              const next = updateClipEffects(before, clip.id, {
                                fadeOutSec,
                                fadeInSec: Math.min(originIn, maxFade - fadeOutSec),
                              });
                              useProjectStore.getState().setProject(next, { dirty: true });
                            }
                          };
                          const onUp = () => {
                            window.removeEventListener("pointermove", onMove);
                            window.removeEventListener("pointerup", onUp);
                            const live = normalizeClipEffects(
                              useProjectStore
                                .getState()
                                .project.clips.find((c) => c.id === clip.id)?.effects,
                            );
                            setStatusMessage(
                              edge === "in"
                                ? `Fade in ${live.fadeInSec.toFixed(2)}s`
                                : `Fade out ${live.fadeOutSec.toFixed(2)}s`,
                            );
                          };
                          window.addEventListener("pointermove", onMove);
                          window.addEventListener("pointerup", onUp);
                        };
                        return (
                          <>
                            {fadeInPx > 1 ? (
                              <div
                                className={styles.fadeShadeIn}
                                style={{ width: fadeInPx }}
                                aria-hidden
                              />
                            ) : null}
                            {fadeOutPx > 1 ? (
                              <div
                                className={styles.fadeShadeOut}
                                style={{ width: fadeOutPx }}
                                aria-hidden
                              />
                            ) : null}
                            {selected ? (
                              <>
                                <span
                                  className={`${styles.fadeHandle} ${styles.fadeHandleLeft}`}
                                  title="Ctrl+drag: fade in (black)"
                                  onPointerDown={(e) => beginFadeDrag(e, "in")}
                                />
                                <span
                                  className={`${styles.fadeHandle} ${styles.fadeHandleRight}`}
                                  title="Ctrl+drag: fade out (black)"
                                  onPointerDown={(e) => beginFadeDrag(e, "out")}
                                />
                              </>
                            ) : null}
                          </>
                        );
                      })()}
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
                              if (e.altKey) {
                                setSelectedClipIds([clip.id]);
                                setLinkBypassClipIds([clip.id]);
                              }
                              const followLink = !e.altKey && editFollowsLink([clip.id]);
                              const onMove = (ev: PointerEvent) => {
                                const deltaTicks = Math.round(
                                  ((ev.clientX - originX) / pxPerSecond) * 1_000_000,
                                );
                                const nextIn = Math.min(
                                  originOut - 100_000,
                                  Math.max(0, originIn + deltaTicks),
                                );
                                const applied = nextIn - originIn;
                                let next = trimClip(before, clip.id, nextIn, originOut, {
                                  followLink,
                                });
                                next = moveClip(next, clip.id, originStart + applied, track.id, {
                                  followLink,
                                });
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
                              if (e.altKey) {
                                setSelectedClipIds([clip.id]);
                                setLinkBypassClipIds([clip.id]);
                              }
                              const followLink = !e.altKey && editFollowsLink([clip.id]);
                              const onMove = (ev: PointerEvent) => {
                                const deltaTicks = Math.round(
                                  ((ev.clientX - originX) / pxPerSecond) * 1_000_000,
                                );
                                const nextOut = Math.max(originIn + 100_000, originOut + deltaTicks);
                                const next = trimClip(before, clip.id, originIn, nextOut, {
                                  followLink,
                                });
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
                      {clip.kind === "media" && clipHasEffectLook(clip) ? (
                        <span
                          className={`${styles.clipBadge} ${styles.clipFxBadge}`}
                          title={
                            findMatchingFilterTemplate(clip.effects)?.label ??
                            (hasEffectKeyframes(clip.effectKeyframes)
                              ? "Effects + keyframes"
                              : "Effects applied")
                          }
                        >
                          {(() => {
                            const look = findMatchingFilterTemplate(clip.effects);
                            return look && look.id !== "none" ? look.label : "FX";
                          })()}
                        </span>
                      ) : null}
                      {(hasEffectKeyframes(clip.effectKeyframes) ||
                        hasTransformKeyframes(clip.transformKeyframes))
                        ? (() => {
                            const kf = normalizeEffectKeyframes(clip.effectKeyframes);
                            const tf = normalizeTransformKeyframes(clip.transformKeyframes);
                            const marks = new Map<
                              number,
                              { progress: number; params: string[] }
                            >();
                            for (const track of [
                              ...(kf?.tracks ?? []),
                              ...(tf?.tracks ?? []),
                            ]) {
                              for (const p of track.points) {
                                const key = Math.round(p.atProgress * 1000);
                                const existing = marks.get(key);
                                if (existing) {
                                  if (!existing.params.includes(track.param)) {
                                    existing.params.push(track.param);
                                  }
                                } else {
                                  marks.set(key, {
                                    progress: p.atProgress,
                                    params: [track.param],
                                  });
                                }
                              }
                            }
                            const durTicks = clipDurationTicks(clip);
                            return [...marks.entries()].map(([key, mark]) => (
                              <button
                                key={`${clip.id}-ek-${key}`}
                                type="button"
                                className={styles.effectKeyframeMark}
                                style={{ left: `${mark.progress * 100}%` }}
                                title={`Keyframe · ${mark.params.join(", ")} — click to edit`}
                                aria-label={`Effect keyframe at ${(mark.progress * 100).toFixed(0)}%`}
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const ticks =
                                    clip.startTicks +
                                    Math.round(mark.progress * durTicks);
                                  useEditorUiStore.getState().setPlayheadTicks(ticks);
                                  useEditorUiStore
                                    .getState()
                                    .setSelectedClipIds([clip.id]);
                                }}
                              />
                            ));
                          })()
                        : null}
                      {clip.kind === "media" && Math.abs(clip.speed - 1) > 0.001 ? (
                        <span
                          className={styles.clipBadge}
                          title={`Speed ${clip.speed.toFixed(2)}×`}
                        >
                          {clip.speed.toFixed(clip.speed % 1 === 0 ? 0 : 2)}×
                        </span>
                      ) : null}
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

      {clipMenu
        ? createPortal(
            <div
              ref={clipMenuRef}
              className={styles.ctxMenu}
              style={{ left: clipMenu.x, top: clipMenu.y, visibility: "hidden" }}
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
            disabled={!canFitFilterFull(project, selectedClipIds[0])}
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (!id) return;
              commitProjectChange((current) => fitFilterFull(current, id));
              setStatusMessage("Filter covers the full clip");
              setClipMenu(null);
            }}
          >
            Full
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (id) {
                commitProjectChange((p) =>
                  splitClipAt(p, id, useEditorUiStore.getState().playheadTicks, {
                    followLink: editFollowsLink([id]),
                  }),
                );
                setStatusMessage("Split at playhead");
              }
              setClipMenu(null);
            }}
          >
            Split at playhead
          </button>
          <div className={styles.ctxSep} />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (!id) return;
              try {
                commitProjectChange((p) => moveClipLayer(p, id, "up"));
                setStatusMessage("Moved layer up");
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Cannot move layer",
                );
              }
              setClipMenu(null);
            }}
          >
            Move layer up
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (!id) return;
              try {
                commitProjectChange((p) => moveClipLayer(p, id, "down"));
                setStatusMessage("Moved layer down");
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Cannot move layer",
                );
              }
              setClipMenu(null);
            }}
          >
            Move layer down
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
          <div className={styles.ctxSep} />
          <button
            type="button"
            role="menuitem"
            disabled={!rampTargetClip}
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (!id) return;
              try {
                let added = false;
                commitProjectChange((p) => {
                  const clip = p.clips.find((c) => c.id === id);
                  const already = hasActiveRamp(clip?.speedRamp);
                  // First time: 2 points centered on playhead. Otherwise clear.
                  // Duration stays put (source range absorbs it, Premiere-style).
                  if (already) return setClipRamp(p, id, null);
                  added = true;
                  if (!clip) throw new Error("Unknown clipId");
                  const locked = clipDurationTicks(clip);
                  return relockClipDuration(
                    enableSpeedRamp(
                      p,
                      id,
                      useEditorUiStore.getState().playheadTicks,
                    ),
                    id,
                    locked,
                  );
                });
                setStatusMessage(
                  added
                    ? "Speed ramp at playhead — drag points for speed and timing"
                    : "Speed ramp removed",
                );
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Speed ramp failed",
                );
              }
              setClipMenu(null);
            }}
          >
            {hasActiveRamp(rampTargetClip?.speedRamp) ? "Remove speed ramp" : "Add speed ramp"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!rampTargetClip || !hasActiveRamp(rampTargetClip.speedRamp)}
            onClick={() => {
              const id = useEditorUiStore.getState().selectedClipIds[0];
              if (!id) return;
              try {
                commitProjectChange((p) => {
                  const clip = p.clips.find((c) => c.id === id);
                  if (!clip) throw new Error("Unknown clipId");
                  const locked = clipDurationTicks(clip);
                  return relockClipDuration(
                    addRampPointAtPlayhead(
                      p,
                      id,
                      useEditorUiStore.getState().playheadTicks,
                    ).project,
                    id,
                    locked,
                  );
                });
                setStatusMessage("Ramp point added — drag vertically to change speed");
              } catch (error) {
                setStatusMessage(
                  error instanceof Error ? error.message : "Add point failed",
                );
              }
              setClipMenu(null);
            }}
          >
            Add ramp point at playhead
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setStatusMessage("Properties open on the right");
              setClipMenu(null);
            }}
          >
            Clip properties
          </button>
          <div className={styles.ctxSep} />
          {selectedClipIds.some((id) =>
            project.clips.some((c) => c.id === id && c.linkedClipId),
          ) ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const ids = useEditorUiStore.getState().selectedClipIds;
                commitProjectChange((p) => {
                  let next = p;
                  for (const id of ids) next = unlinkClip(next, id);
                  return next;
                });
                setStatusMessage("Unlinked");
                setClipMenu(null);
              }}
            >
              Unlink
            </button>
          ) : null}
          {selectedClipIds.length === 2 &&
          project.clips.filter(
            (c) =>
              selectedClipIds.includes(c.id) && c.kind === "media" && !c.linkedClipId,
          ).length === 2 ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const ids = useEditorUiStore.getState().selectedClipIds;
                const a = ids[0];
                const b = ids[1];
                if (!a || !b) return;
                commitProjectChange((p) => linkClips(p, a, b));
                setStatusMessage("Linked");
                setClipMenu(null);
              }}
            >
              Link
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={styles.ctxDanger}
            onClick={() => {
              const ids = useEditorUiStore.getState().selectedClipIds;
              if (ids.length > 0) {
                commitProjectChange((p) =>
                  deleteClips(p, ids, { followLink: editFollowsLink(ids) }),
                );
                setSelectedClipIds([]);
                setStatusMessage("Deleted");
              }
              setClipMenu(null);
            }}
          >
            Delete
            <kbd className={styles.ctxKbd}>Del</kbd>
          </button>
            </div>,
            document.body,
          )
        : null}

      {trackMenu
        ? createPortal(
            <div
              ref={trackMenuRef}
              className={styles.ctxMenu}
              style={{ left: trackMenu.x, top: trackMenu.y, visibility: "hidden" }}
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
                    commitProjectChange((p) =>
                      moveTrack(p, trackMenu.trackId, "up"),
                    );
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
                    commitProjectChange((p) =>
                      moveTrack(p, trackMenu.trackId, "down"),
                    );
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
                      project.tracks.find((t) => t.id === trackMenu.trackId)
                        ?.name ?? "track";
                    commitProjectChange((p) => removeTrack(p, trackMenu.trackId));
                    setStatusMessage(`Deleted ${name}`);
                  } catch (error) {
                    setStatusMessage(
                      error instanceof Error
                        ? error.message
                        : "Cannot delete track",
                    );
                  }
                  setTrackMenu(null);
                }}
              >
                Delete track
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
