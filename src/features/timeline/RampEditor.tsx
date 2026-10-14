import { useEffect, useMemo, useRef } from "react";
import {
  MAX_RAMP_SPEED,
  MIN_RAMP_SPEED,
  getRampProfile,
  rampSpeedRangeLabel,
  type SpeedPoint,
} from "../../domain/speedRamp";
import { clampRampSpeed } from "../../domain/speedRamp";
import type { Clip } from "../../domain/project";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import {
  addRampPointAtPlayhead,
  moveRampPoint,
  removeRampPoint,
  setRampPointSpeed,
} from "../../domain/timelineCommands";
import { PlusIcon, RampIcon, TrashIcon } from "../../components/icons";
import styles from "./RampEditor.module.css";

interface RampEditorProps {
  clip: Clip;
  widthPx: number;
  heightPx: number;
}

const PAD_X = 8;
const PAD_Y = 6;

/**
 * Speed-curve overlay on the selected clip.
 *
 * The curve is drawn only between the first and last ramp point. Outside that
 * range the clip plays at 1× (no curve). Every anchor is freely draggable.
 */
export function RampEditor({ clip, widthPx, heightPx }: RampEditorProps) {
  const speedRange = useMemo(() => rampSpeedRangeLabel(clip.speedRamp), [clip.speedRamp]);
  const ramp = useMemo(
    () => getRampProfile(clip.speedRamp)?.ramp ?? null,
    [clip.speedRamp],
  );
  const dragRef = useRef(false);
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

  function handleAddPoint() {
    const playhead = useEditorUiStore.getState().playheadTicks;
    try {
      commitProjectChange(
        (p) => addRampPointAtPlayhead(p, clip.id, playhead, 1.5).project,
      );
      useEditorUiStore.getState().setStatusMessage("Ramp point added at playhead");
    } catch (error) {
      useEditorUiStore
        .getState()
        .setStatusMessage(error instanceof Error ? error.message : "Add point failed");
    }
  }

  function beginDragPoint(event: React.PointerEvent, point: SpeedPoint) {
    event.stopPropagation();
    event.preventDefault();
    const surface = event.currentTarget.parentElement;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    dragRef.current = true;

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const progress = Math.min(1, Math.max(0, (x - PAD_X) / plotW));
      const speed = yToSpeed(y);
      commitProjectChange((p) =>
        setRampPointSpeed(p, clip.id, point.id, Number(speed.toFixed(3))),
      );
      commitProjectChange((p) =>
        moveRampPoint(p, clip.id, point.id, Number(progress.toFixed(4))),
      );
    };
    const onUp = () => {
      dragRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleRemovePoint(point: SpeedPoint) {
    commitProjectChange((p) => removeRampPoint(p, clip.id, point.id));
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
          className={styles.anchor}
          style={{
            left: progressToX(point.atProgress),
            top: speedToY(point.speed),
          }}
          title={`${point.speed.toFixed(2)}× @ ${(point.atProgress * 100).toFixed(0)}% — drag to adjust`}
          onPointerDown={(e) => beginDragPoint(e, point)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            handleRemovePoint(point);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleRemovePoint(point);
          }}
        />
      ))}

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
