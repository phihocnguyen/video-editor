import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  clampRampSpeed,
  getRampProfile,
  type SpeedPoint,
} from "../../domain/speedRamp";
import type { Clip, ProjectDocument } from "../../domain/project";
import {
  clipDurationTicks,
  removeRampPoint,
  relockClipDuration,
  updateRampPointLocked,
} from "../../domain/timelineCommands";
import type { Tick } from "../../domain/time";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import { TrashIcon } from "../../components/icons";
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
const DRAG_THRESHOLD_PX = 4;

/** Click-menu speeds as % of 1× (slow → fast). */
const SPEED_PERCENT_OPTIONS = [25, 50, 75, 100, 150, 200, 300] as const;

/**
 * Speed-curve overlay on the selected clip.
 *
 * Click a point → pick speed % / delete. Double-click → reset to 1×.
 * Drag still reshapes the curve; timeline duration stays locked.
 */
export function RampEditor({ clip, widthPx, heightPx, interactive = true }: RampEditorProps) {
  const ramp = useMemo(
    () => getRampProfile(clip.speedRamp)?.ramp ?? null,
    [clip.speedRamp],
  );
  const dragRef = useRef<RampGesture | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  /** Anchor currently pinned against the media end (duration lock) — amber. */
  const [blockedPointId, setBlockedPointId] = useState<string | null>(null);
  /** Viewport coords — menu is portaled so clip `overflow:hidden` cannot crop it. */
  const [menu, setMenu] = useState<{
    pointId: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const plotW = Math.max(1, widthPx - PAD_X * 2);
  const plotH = Math.max(1, heightPx - PAD_Y * 2);

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
    // Resolution follows the drawn width (~3px/segment) so the polyline reads as
    // a smooth curve even on wide clips, and always include the exact anchor
    // positions so the line visibly passes through each point.
    const samples = Math.min(240, Math.max(64, Math.round(plotW / 3)));
    const stops = new Set<number>();
    for (let i = 0; i <= samples; i += 1) stops.add(i / samples);
    for (const p of ramp.points) stops.add(Math.min(1, Math.max(0, p.atProgress)));
    let d = "";
    let first = true;
    for (const p of [...stops].sort((a, b) => a - b)) {
      const x = PAD_X + p * plotW;
      const y = speedToY(profile.speedAtProgress(p));
      d += `${first ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
      first = false;
    }
    return d.trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ramp, plotW, plotH]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest(`.${styles.pointMenu}`)) return;
      setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menu]);

  useEffect(
    () => () => {
      if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
    },
    [],
  );

  if (!ramp) return null;

  const progressToX = (atProgress: number) => PAD_X + atProgress * plotW;
  const menuPoint = menu
    ? ramp.points.find((p) => p.id === menu.pointId) ?? null
    : null;

  const SNAP_SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

  function snapSpeed(speed: number): number {
    for (const s of SNAP_SPEEDS) {
      if (Math.abs(speed - s) / Math.max(0.2, s) < 0.06) return s;
    }
    return speed;
  }

  interface RampGesture {
    pointId: string;
    lockedDuration: Tick;
    plotW: number;
    rect: DOMRect;
    startX: number;
    startY: number;
    dragging: boolean;
    historyPushed: boolean;
    pending: { progress: number; speed: number } | null;
    raf: number;
  }

  function applyGesturePatch(
    project: ProjectDocument,
    g: RampGesture,
    patch: { progress: number; speed: number },
  ): { project: ProjectDocument; constrained: boolean } {
    return updateRampPointLocked(
      project,
      clip.id,
      g.pointId,
      {
        atProgress: Number(patch.progress.toFixed(4)),
        speed: Number(snapSpeed(patch.speed).toFixed(3)),
      },
      g.lockedDuration,
    );
  }

  function isNoopPatch(cur: Clip, next: Clip, pointId: string): boolean {
    if (cur.sourceInTicks !== next.sourceInTicks) return false;
    if (cur.sourceOutTicks !== next.sourceOutTicks) return false;
    const a = cur.speedRamp?.points.find((p) => p.id === pointId);
    const b = next.speedRamp?.points.find((p) => p.id === pointId);
    if (!a || !b) return false;
    return a.atProgress === b.atProgress && a.speed === b.speed;
  }

  function setPointSpeed(pointId: string, speed: number) {
    let constrained = false;
    commitProjectChange((p) => {
      const cur = p.clips.find((c) => c.id === clip.id);
      const locked = clipDurationTicks(cur ?? clip);
      const result = updateRampPointLocked(
        p,
        clip.id,
        pointId,
        { speed: clampRampSpeed(speed) },
        locked,
      );
      constrained = result.constrained;
      return result.project;
    });
    setBlockedPointId(constrained ? pointId : null);
  }

  function handleRemovePoint(pointId: string) {
    commitProjectChange((p) => {
      const cur = p.clips.find((c) => c.id === clip.id);
      const locked = clipDurationTicks(cur ?? clip);
      const next = removeRampPoint(p, clip.id, pointId);
      if (!next.clips.find((c) => c.id === clip.id)?.speedRamp) return next;
      return relockClipDuration(next, clip.id, locked);
    });
  }

  function openPointMenu(point: SpeedPoint, anchorEl?: HTMLElement | null) {
    const rect = anchorEl?.getBoundingClientRect();
    const clientX = rect
      ? rect.left + rect.width / 2
      : progressToX(point.atProgress);
    const clientY = rect ? rect.top : speedToY(point.speed);
    setMenu({ pointId: point.id, clientX, clientY });
  }

  function beginPointPointer(event: React.PointerEvent, point: SpeedPoint) {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    setMenu(null);
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const store = useProjectStore.getState();
    const live = store.project.clips.find((c) => c.id === clip.id) ?? clip;
    const gesture: RampGesture = {
      pointId: point.id,
      lockedDuration: clipDurationTicks(live),
      plotW,
      rect: surface.getBoundingClientRect(),
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      historyPushed: false,
      pending: null,
      raf: 0,
    };
    dragRef.current = gesture;
    setBlockedPointId(null);
    document.body.style.cursor = "grabbing";

    const flush = () => {
      gesture.raf = 0;
      const patch = gesture.pending;
      if (!patch) return;
      gesture.pending = null;
      if (!gesture.historyPushed) {
        useHistoryStore.getState().pushHistory(useProjectStore.getState().project);
        gesture.historyPushed = true;
      }
      const st = useProjectStore.getState();
      const cur = st.project.clips.find((c) => c.id === clip.id);
      const { project: next, constrained } = applyGesturePatch(st.project, gesture, patch);
      const nextClip = next.clips.find((c) => c.id === clip.id);
      const pinnedId = constrained && nextClip ? gesture.pointId : null;
      setBlockedPointId((prev) => (prev === pinnedId ? prev : pinnedId));
      if (cur && nextClip && isNoopPatch(cur, nextClip, gesture.pointId)) return;
      st.setProject(next, { dirty: true });
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - gesture.startX;
      const dy = ev.clientY - gesture.startY;
      if (
        !gesture.dragging &&
        dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        gesture.dragging = true;
        if (clickTimerRef.current != null) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
      }
      if (!gesture.dragging) return;
      const x = ev.clientX - gesture.rect.left;
      const y = ev.clientY - gesture.rect.top;
      gesture.pending = {
        progress: Math.min(1, Math.max(0, (x - PAD_X) / gesture.plotW)),
        speed: yToSpeed(y),
      };
      if (!gesture.raf) gesture.raf = requestAnimationFrame(flush);
    };

    const endGesture = () => {
      if (gesture.raf) cancelAnimationFrame(gesture.raf);
      gesture.raf = 0;
      if (gesture.dragging && gesture.pending) {
        const patch = gesture.pending;
        gesture.pending = null;
        if (!gesture.historyPushed) {
          useHistoryStore.getState().pushHistory(useProjectStore.getState().project);
          gesture.historyPushed = true;
        }
        const st = useProjectStore.getState();
        const cur = st.project.clips.find((c) => c.id === clip.id);
        const { project: next, constrained } = applyGesturePatch(st.project, gesture, patch);
        const nextClip = next.clips.find((c) => c.id === clip.id);
        if (constrained && nextClip) setBlockedPointId(gesture.pointId);
        if (!cur || !nextClip || !isNoopPatch(cur, nextClip, gesture.pointId)) {
          st.setProject(next, { dirty: true });
        }
      } else if (!gesture.dragging) {
        // Click (no drag): open speed menu after a beat so double-click can cancel.
        const livePoint =
          useProjectStore
            .getState()
            .project.clips.find((c) => c.id === clip.id)
            ?.speedRamp?.points.find((p) => p.id === point.id) ?? point;
        const anchor = document.querySelector(
          `[data-ramp-point="${point.id}"]`,
        ) as HTMLElement | null;
        if (clickTimerRef.current != null) window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null;
          openPointMenu(livePoint, anchor);
        }, 160);
      }
      if (dragRef.current === gesture) dragRef.current = null;
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endGesture);
      window.removeEventListener("pointercancel", endGesture);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
  }

  return (
    <div
      className={styles.overlay}
      style={{ width: widthPx, height: heightPx }}
    >
      <svg className={styles.svg} width={widthPx} height={heightPx}>
        <rect
          x={PAD_X}
          y={PAD_Y}
          width={plotW}
          height={plotH}
          className={styles.plotBg}
          rx={3}
        />
        <line
          x1={PAD_X}
          x2={PAD_X + plotW}
          y1={speedToY(1)}
          y2={speedToY(1)}
          className={styles.refLine}
        />
        <path d={curvePath} className={styles.curve} />
      </svg>

      {ramp.points.map((point) => (
        <button
          key={point.id}
          type="button"
          tabIndex={interactive ? undefined : -1}
          className={[
            styles.anchor,
            interactive ? "" : styles.anchorReadOnly,
            menu?.pointId === point.id ? styles.anchorActive : "",
            blockedPointId === point.id ? styles.anchorBlocked : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-ramp-point={point.id}
          style={{
            left: progressToX(point.atProgress),
            top: speedToY(point.speed),
          }}
          title={`${Math.round(point.speed * 100)}% — click for speed, drag to adjust, double-click for 100%`}
          onPointerDown={interactive ? (e) => beginPointPointer(e, point) : undefined}
          onDoubleClick={
            interactive
              ? (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (clickTimerRef.current != null) {
                    window.clearTimeout(clickTimerRef.current);
                    clickTimerRef.current = null;
                  }
                  setMenu(null);
                  setPointSpeed(point.id, 1);
                }
              : undefined
          }
          onContextMenu={
            interactive
              ? (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (clickTimerRef.current != null) {
                    window.clearTimeout(clickTimerRef.current);
                    clickTimerRef.current = null;
                  }
                  openPointMenu(point, e.currentTarget);
                }
              : undefined
          }
        />
      ))}

      {menu && menuPoint
        ? createPortal(
            <div
              className={[
                styles.pointMenu,
                menu.clientY < 96 ? styles.pointMenuBelow : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                left: Math.min(
                  window.innerWidth - 12,
                  Math.max(12, menu.clientX),
                ),
                top: Math.max(12, menu.clientY),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className={styles.pointMenuLabel}>Speed</div>
              <div className={styles.pointMenuRow}>
                {SPEED_PERCENT_OPTIONS.map((pct) => {
                  const active = Math.abs(menuPoint.speed * 100 - pct) < 3;
                  return (
                    <button
                      key={pct}
                      type="button"
                      className={[styles.pctBtn, active ? styles.pctBtnActive : ""]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => {
                        setPointSpeed(menu.pointId, pct / 100);
                        setMenu(null);
                      }}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => {
                  handleRemovePoint(menu.pointId);
                  setMenu(null);
                }}
              >
                <TrashIcon size={12} />
                Delete point
              </button>
            </div>,
            document.body,
          )
        : null}
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
