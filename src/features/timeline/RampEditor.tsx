import { useMemo, useRef } from "react";
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  createSpeedPoint,
  getRampProfile,
  rampSpeedRangeLabel,
  type SpeedPoint,
} from "../../domain/speedRamp";
import { clampRampSpeed } from "../../domain/speedRamp";
import type { Clip, ProjectDocument } from "../../domain/project";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  addRampPointAtPlayhead,
  removeRampPoint,
  setClipRamp,
  updateRampPoint,
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

  /** Common speeds the drag snaps to (within 6%) so 0.5×/1×/2× land exactly. */
  const SNAP_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

  function snapSpeed(speed: number): number {
    for (const s of SNAP_SPEEDS) {
      if (Math.abs(speed - s) / Math.max(0.2, s) < 0.06) return s;
    }
    return speed;
  }

  function handleAddPoint() {
    const playhead = useEditorUiStore.getState().playheadTicks;
    try {
      commitProjectChange((p) => addRampPointAtPlayhead(p, clip.id, playhead, 1.5).project);
      useEditorUiStore.getState().setStatusMessage("Ramp point added at playhead");
    } catch (error) {
      useEditorUiStore
        .getState()
        .setStatusMessage(error instanceof Error ? error.message : "Add point failed");
    }
  }

  /** One-tap curves: replace anchors, keep the same source range. Duration follows speed. */
  function applyPreset(kind: "slow" | "normal" | "fast" | "up" | "down") {
    try {
      commitProjectChange((p) => {
        const cur = p.clips.find((c) => c.id === clip.id);
        if (!cur) return p;
        switch (kind) {
          case "slow":
            return setClipRamp(p, clip.id, {
              points: [createSpeedPoint(0, 0.5), createSpeedPoint(1, 0.5)],
            });
          case "fast":
            return setClipRamp(p, clip.id, {
              points: [createSpeedPoint(0, 2), createSpeedPoint(1, 2)],
            });
          case "up":
            return setClipRamp(p, clip.id, {
              points: [
                createSpeedPoint(0, 0.5),
                createSpeedPoint(0.5, 1),
                createSpeedPoint(1, 2),
              ],
            });
          case "down":
            return setClipRamp(p, clip.id, {
              points: [
                createSpeedPoint(0, 2),
                createSpeedPoint(0.5, 1),
                createSpeedPoint(1, 0.5),
              ],
            });
          default:
            return setClipRamp(p, clip.id, null);
        }
      });
      useEditorUiStore.getState().setStatusMessage(
        kind === "normal" ? "Speed reset to 1×" : `Ramp preset: ${kind}`,
      );
    } catch (error) {
      useEditorUiStore
        .getState()
        .setStatusMessage(error instanceof Error ? error.message : "Preset failed");
    }
  }

  interface RampGesture {
    pointId: string;
    plotW: number;
    rect: DOMRect;
    pending: { progress: number; speed: number } | null;
    raf: number;
  }

  function applyGesturePatch(
    project: ProjectDocument,
    g: RampGesture,
    patch: { progress: number; speed: number },
  ) {
    // Free-duration edit: speed changes stretch/shrink the clip on the
    // timeline (source range untouched, so nothing ever "blocks at a wall").
    return updateRampPoint(project, clip.id, g.pointId, {
      atProgress: Number(patch.progress.toFixed(4)),
      speed: Number(snapSpeed(patch.speed).toFixed(3)),
    });
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
    useHistoryStore.getState().pushHistory(store.project);
    const gesture: RampGesture = {
      pointId: point.id,
      plotW,
      rect: surface.getBoundingClientRect(),
      pending: null,
      raf: 0,
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

  function handleRemovePoint(point: SpeedPoint) {
    commitProjectChange((p) => removeRampPoint(p, clip.id, point.id));
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
      </svg>

      {ramp.points.map((point) => (
        <button
          key={point.id}
          type="button"
          tabIndex={interactive ? undefined : -1}
          className={[
            styles.anchor,
            interactive ? "" : styles.anchorReadOnly,
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
          {(
            [
              ["slow", "½×"],
              ["normal", "1×"],
              ["fast", "2×"],
              ["up", "↗"],
              ["down", "↘"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className={styles.toolBtn}
              title={
                kind === "slow"
                  ? "Slow motion 0.5× (clip gets longer)"
                  : kind === "fast"
                    ? "Fast 2× (clip gets shorter)"
                    : kind === "normal"
                      ? "Reset to normal speed"
                      : kind === "up"
                        ? "Ramp up: slow → fast"
                        : "Ramp down: fast → slow"
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => applyPreset(kind)}
            >
              {label}
            </button>
          ))}
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
