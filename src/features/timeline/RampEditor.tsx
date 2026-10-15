import { useEffect, useMemo, useRef } from "react";
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  getRampProfile,
  rampSpeedRangeLabel,
  type SpeedPoint,
} from "../../domain/speedRamp";
import { clampRampSpeed } from "../../domain/speedRamp";
import type { Clip, ProjectDocument } from "../../domain/project";
import type { Tick } from "../../domain/time";
import { clipDurationTicks } from "../../domain/timelineCommands";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  addRampPointAtPlayhead,
  relockClipDuration,
  removeRampPoint,
  updateRampPointLocked,
} from "../../domain/timelineCommands";
import { PlusIcon, RampIcon, TrashIcon } from "../../components/icons";
import styles from "./RampEditor.module.css";

interface RampEditorProps {
  clip: Clip;
  widthPx: number;
  heightPx: number;
  /** False renders a live read-only curve (visible without selection). */
  interactive?: boolean;
}

const PAD_X = 8;
const PAD_Y = 6;

/**
 * Speed-curve overlay on the selected clip.
 *
 * The curve is drawn only between the first and last ramp point. Outside that
 * range the clip plays at 1× (no curve). Every anchor is freely draggable.
 */
export function RampEditor({ clip, widthPx, heightPx, interactive = true }: RampEditorProps) {
  const speedRange = useMemo(() => rampSpeedRangeLabel(clip.speedRamp), [clip.speedRamp]);
  const ramp = useMemo(
    () => getRampProfile(clip.speedRamp)?.ramp ?? null,
    [clip.speedRamp],
  );
  const dragRef = useRef<RampGesture | null>(null);
  /** Points currently blocked at the media wall (amber) — mutated during
      drags, read at render; the drag's own setProject drives re-renders. */
  const blockedRef = useRef<Set<string>>(new Set());
  const playheadLineRef = useRef<SVGLineElement>(null);

  const plotW = Math.max(1, widthPx - PAD_X * 2);
  const plotH = Math.max(1, heightPx - PAD_Y * 2);

  // Log-scale speed→y so slow-mo and fast-forward both stay legible.
  const speedToY = (speed: number) => {
    const t =
      (Math.log(clampRampSpeed(speed)) - Math.log(MIN_RAMP_SPEED)) /
      (Math.log(MAX_RAMP_SPEED) - Math.log(MIN_RAMP_SPEED));
    return PAD_Y + (1 - t) * plotH;
  };
  const yToSpeed = (y: number) => {
    const t = 1 - (y - PAD_Y) / plotH;
    return clampRampSpeed(
      Math.exp(Math.log(MIN_RAMP_SPEED) + t * (Math.log(MAX_RAMP_SPEED) - Math.log(MIN_RAMP_SPEED))),
    );
  };

  const curvePath = useMemo(() => {
    if (!ramp || ramp.points.length < 2) return "";
    const profile = getRampProfile(ramp);
    if (!profile) return "";
    const lo = ramp.points[0].atProgress;
    const hi = ramp.points[ramp.points.length - 1].atProgress;
    const samples = 48;
    let d = "";
    for (let i = 0; i <= samples; i += 1) {
      const p = lo + (i / samples) * (hi - lo);
      const x = PAD_X + p * plotW;
      const y = speedToY(profile.speedAtProgress(p));
      d += `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    return d.trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ramp, plotW, plotH]);

  if (!ramp) return null;

  const progressToX = (atProgress: number) => PAD_X + atProgress * plotW;
  const lo = ramp.points[0].atProgress;
  const hi = ramp.points[ramp.points.length - 1].atProgress;

  /** True when the duration lock hit the media end (duration had to change). */
  function lockWasClamped(locked: Tick): boolean {
    const after = useProjectStore
      .getState()
      .project.clips.find((c) => c.id === clip.id);
    return !!after && Math.abs(clipDurationTicks(after) - locked) > 1;
  }

  function handleAddPoint() {
    const playhead = useEditorUiStore.getState().playheadTicks;
    try {
      let locked: Tick = 0;
      commitProjectChange((p) => {
        const cur = p.clips.find((c) => c.id === clip.id);
        locked = clipDurationTicks(cur ?? clip);
        const added = addRampPointAtPlayhead(p, clip.id, playhead, 1.5).project;
        // New anchors must not stretch the track either.
        return relockClipDuration(added, clip.id, locked);
      });
      useEditorUiStore
        .getState()
        .setStatusMessage(
          lockWasClamped(locked)
            ? "Reached end of media — clip shortened"
            : "Ramp point added at playhead",
        );
    } catch (error) {
      useEditorUiStore
        .getState()
        .setStatusMessage(error instanceof Error ? error.message : "Add point failed");
    }
  }

  interface RampGesture {
    pointId: string;
    /** Timeline duration locked at dragstart — the track never stretches. */
    lockedDuration: Tick;
    plotW: number;
    rect: DOMRect;
    /** The anchor button (pointer-captured) for live blocked feedback. */
    btn: HTMLElement;
    pending: { progress: number; speed: number } | null;
    raf: number;
    /** Latched when the media wall blocked the patch (status on release). */
    hitWall: boolean;
  }

  function applyGesturePatch(
    project: ProjectDocument,
    g: RampGesture,
    patch: { progress: number; speed: number },
  ) {
    // Duration-locked edit: the point is blocked at the media wall instead
    // of stretching the track (Premiere behavior).
    const { project: next, constrained } = updateRampPointLocked(
      project,
      clip.id,
      g.pointId,
      {
        atProgress: Number(patch.progress.toFixed(4)),
        speed: Number(patch.speed.toFixed(3)),
      },
      g.lockedDuration,
    );
    if (constrained) {
      g.hitWall = true;
      blockedRef.current.add(g.pointId);
    } else {
      blockedRef.current.delete(g.pointId);
    }
    return next;
  }

  /**
   * True when a flush would change nothing (pinned at a neighbor clamp, the
   * media wall, or identical values). Skipping `setProject` avoids a full
   * timeline re-render + project-wide normalize per frame while pushing
   * against a clamp — that storm is the visible "stuck" stutter.
   */
  function isNoopPatch(cur: Clip, next: Clip, pointId: string): boolean {
    if (cur.sourceInTicks !== next.sourceInTicks) return false;
    if (cur.sourceOutTicks !== next.sourceOutTicks) return false;
    const a = cur.speedRamp?.points.find((p) => p.id === pointId);
    const b = next.speedRamp?.points.find((p) => p.id === pointId);
    if (!a || !b) return false;
    return a.atProgress === b.atProgress && a.speed === b.speed;
  }

  function beginDragPoint(event: React.PointerEvent, point: SpeedPoint) {
    event.stopPropagation();
    event.preventDefault();
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    // Snapshot geometry + duration at dragstart and reuse for the whole
    // gesture: with the duration locked the overlay never resizes mid-drag,
    // so the cursor mapping stays exact (no grab drift / jitter).
    const store = useProjectStore.getState();
    const live = store.project.clips.find((c) => c.id === clip.id) ?? clip;
    useHistoryStore.getState().pushHistory(store.project);
    const gesture: RampGesture = {
      pointId: point.id,
      lockedDuration: clipDurationTicks(live),
      plotW,
      rect: surface.getBoundingClientRect(),
      btn: event.currentTarget as HTMLElement,
      pending: null,
      raf: 0,
      hitWall: false,
    };
    dragRef.current = gesture;
    document.body.style.cursor = "grabbing";

    const flush = () => {
      gesture.raf = 0;
      const patch = gesture.pending;
      if (!patch) return;
      gesture.pending = null;
      const st = useProjectStore.getState();
      const cur = st.project.clips.find((c) => c.id === clip.id);
      const next = applyGesturePatch(st.project, gesture, patch);
      const nextClip = next.clips.find((c) => c.id === clip.id);
      if (cur && nextClip && isNoopPatch(cur, nextClip, gesture.pointId)) return;
      st.setProject(next, { dirty: true });
    };
    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - gesture.rect.left;
      const y = ev.clientY - gesture.rect.top;
      gesture.pending = {
        progress: Math.min(1, Math.max(0, (x - PAD_X) / gesture.plotW)),
        speed: yToSpeed(y),
      };
      // One live update per frame — no history spam, no layout thrash.
      if (!gesture.raf) gesture.raf = requestAnimationFrame(flush);
    };
    const endGesture = () => {
      if (gesture.raf) cancelAnimationFrame(gesture.raf);
      gesture.raf = 0;
      // Apply the trailing patch synchronously so the final position lands.
      if (gesture.pending) {
        const patch = gesture.pending;
        gesture.pending = null;
        const st = useProjectStore.getState();
        const cur = st.project.clips.find((c) => c.id === clip.id);
        const next = applyGesturePatch(st.project, gesture, patch);
        const nextClip = next.clips.find((c) => c.id === clip.id);
        if (!cur || !nextClip || !isNoopPatch(cur, nextClip, gesture.pointId)) {
          st.setProject(next, { dirty: true });
        }
      }
      if (gesture.hitWall) {
        useEditorUiStore
          .getState()
          .setStatusMessage("Reached end of media — release to continue");
      }
      if (dragRef.current === gesture) dragRef.current = null;
      blockedRef.current.delete(gesture.pointId);
      // No re-render follows when the last flush was a no-op — clean the
      // amber state off the DOM node directly.
      gesture.btn.classList.remove(styles.anchorBlocked);
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
  }

  function handleRemovePoint(point: SpeedPoint) {
    commitProjectChange((p) => {
      const cur = p.clips.find((c) => c.id === clip.id);
      const locked = clipDurationTicks(cur ?? clip);
      const next = removeRampPoint(p, clip.id, point.id);
      const after = next.clips.find((c) => c.id === clip.id);
      // Clearing the ramp restores natural speed (duration may change);
      // otherwise keep the track stable.
      if (!after?.speedRamp) return next;
      return relockClipDuration(next, clip.id, locked);
    });
  }

  // Drive the playhead hairline via DOM — do NOT React-subscribe to playheadTicks
  // (that re-rendered this overlay at 60fps and tanked preview).
  useEffect(() => {
    if (!ramp) return;
    const profile = getRampProfile(ramp);
    if (!profile) return;
    const span = Math.max(1, clip.sourceOutTicks - clip.sourceInTicks);
    const paint = (ticks: number) => {
      const line = playheadLineRef.current;
      if (!line) return;
      const local = Math.max(0, ticks - clip.startTicks);
      const total = span * profile.durationFactor;
      const progress =
        local >= total
          ? 1
          : Math.min(1, Math.max(0, profile.progressAtIntegralFactor(local / span)));
      const x = PAD_X + progress * plotW;
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
    };
    paint(useEditorUiStore.getState().playheadTicks);
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks !== prev.playheadTicks) paint(s.playheadTicks);
    });
  }, [ramp, clip.startTicks, clip.sourceInTicks, clip.sourceOutTicks, plotW]);

  return (
    <div className={styles.overlay} style={{ width: widthPx, height: heightPx }}>
      <svg className={styles.svg} width={widthPx} height={heightPx}>
        <rect
          x={PAD_X}
          y={PAD_Y}
          width={plotW}
          height={plotH}
          className={styles.plotBg}
          rx={3}
        />
        {/* 1× reference line */}
        <line
          x1={PAD_X}
          x2={PAD_X + plotW}
          y1={speedToY(1)}
          y2={speedToY(1)}
          className={styles.refLine}
        />
        {/* Outside the ramp region: flat 1× (no curve). */}
        {lo > 0.01 ? (
          <line
            x1={progressToX(0)}
            x2={progressToX(lo)}
            y1={speedToY(1)}
            y2={speedToY(1)}
            className={styles.flatOutside}
          />
        ) : null}
        {hi < 0.99 ? (
          <line
            x1={progressToX(hi)}
            x2={progressToX(1)}
            y1={speedToY(1)}
            y2={speedToY(1)}
            className={styles.flatOutside}
          />
        ) : null}
        <path d={curvePath} className={styles.curve} />
        <line
          ref={playheadLineRef}
          x1={PAD_X}
          x2={PAD_X}
          y1={PAD_Y}
          y2={PAD_Y + plotH}
          className={styles.playheadLine}
        />
      </svg>

      {ramp.points.map((point) => (
        <button
          key={point.id}
          type="button"
          tabIndex={interactive ? undefined : -1}
          className={[
            styles.anchor,
            interactive ? "" : styles.anchorReadOnly,
            blockedRef.current.has(point.id) ? styles.anchorBlocked : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            left: progressToX(point.atProgress),
            top: speedToY(point.speed),
          }}
          title={`${point.speed.toFixed(2)}× @ ${(point.atProgress * 100).toFixed(0)}% — drag to adjust`}
          onPointerDown={interactive ? (e) => beginDragPoint(e, point) : undefined}
          onDoubleClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  handleRemovePoint(point);
                }
              : undefined
          }
          onContextMenu={
            interactive
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleRemovePoint(point);
                }
              : undefined
          }
        />
      ))}

      {interactive ? (
        <div className={styles.toolbar}>
          <span className={styles.badge} title="Speed range on this clip">
            <RampIcon size={12} />
            {speedRange ?? "ramp"}
          </span>
          <button
            type="button"
            className={styles.toolBtn}
            title="Add ramp point at playhead"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={handleAddPoint}
          >
            <PlusIcon size={12} />
            Point
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Trash affordance kept for keyboard/menu discoverability. */
export const RampTrashIcon = TrashIcon;

/** Exposed for tests / callers that only need a tick mapping. */
export function rampTicksForProgress(clip: Clip, atProgress: number): number {
  const span = Math.max(1, clip.sourceOutTicks - clip.sourceInTicks);
  const profile = getRampProfile(clip.speedRamp);
  if (!profile) return clip.startTicks + Math.round(atProgress * span);
  return Math.round(clip.startTicks + span * profile.integralFactor(atProgress));
}
