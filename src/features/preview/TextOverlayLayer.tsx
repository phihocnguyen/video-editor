import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clipDurationTicks,
  deleteClips,
  layerStackZ,
  normalizeTextAnimation,
  textAnimationIsDefault,
  textAnimationVisual,
  ticksToSeconds,
  updateClipText,
  updateClipTransform,
  type Clip,
} from "../../domain";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./PreviewPanel.module.css";

export interface TextOverlayItem {
  clip: Clip;
  trackOrder: number;
}

interface TextOverlayLayerProps {
  items: TextOverlayItem[];
  canvasWidth: number;
  canvasHeight: number;
  stageRef: RefObject<HTMLDivElement | null>;
  /** Current playhead, for computing text in/out animation progress. */
  playheadTicks: number;
}

function clientToCanvas(
  stage: HTMLDivElement,
  clientX: number,
  clientY: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const rect = stage.getBoundingClientRect();
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * canvasWidth;
  const y = ((clientY - rect.top) / Math.max(1, rect.height)) * canvasHeight;
  return { x, y };
}

export function TextOverlayLayer({
  items,
  canvasWidth,
  canvasHeight,
  stageRef,
  playheadTicks,
}: TextOverlayLayerProps) {
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);

  // The parent's `playheadTicks` is throttled (updates only when the visible
  // layer set changes) so playback stays cheap. Text animations need a live
  // clock, but only while an animation window is actually on screen — so we
  // subscribe per-frame just for that case and fall back to the prop otherwise.
  const hasActiveAnimation = items.some(
    (it) => it.clip.animation && !textAnimationIsDefault(normalizeTextAnimation(it.clip.animation)),
  );
  const [livePlayhead, setLivePlayhead] = useState(playheadTicks);
  useEffect(() => {
    if (!hasActiveAnimation) return;
    setLivePlayhead(useEditorUiStore.getState().playheadTicks);
    return useEditorUiStore.subscribe((s, prev) => {
      if (s.playheadTicks !== prev.playheadTicks) setLivePlayhead(s.playheadTicks);
    });
  }, [hasActiveAnimation]);
  const animPlayhead = hasActiveAnimation ? livePlayhead : playheadTicks;

  const dragRef = useRef<{
    mode: "move" | "resize";
    clipId: string;
    originX: number;
    originY: number;
    startTx: number;
    startTy: number;
    startFont: number;
    startDist: number;
  } | null>(null);

  function previewFontPx(clip: Clip, stage: HTMLDivElement | null): number {
    const style = clip.text!;
    const stageW = stage?.clientWidth ?? canvasWidth;
    const scale = stageW / Math.max(1, canvasWidth);
    return Math.max(10, style.fontSize * scale * clip.transform.scaleX);
  }

  function beginGesture(
    event: ReactPointerEvent,
    clip: Clip,
    mode: "move" | "resize",
  ) {
    event.stopPropagation();
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage || !clip.text) return;

    setPlaying(false);
    setSelectedClipIds([clip.id]);
    setActivePanel("text");

    const before = useProjectStore.getState().project;
    useHistoryStore.getState().pushHistory(before);

    const point = clientToCanvas(
      stage,
      event.clientX,
      event.clientY,
      canvasWidth,
      canvasHeight,
    );
    const dx = point.x - clip.transform.x;
    const dy = point.y - clip.transform.y;
    const dist = Math.max(8, Math.hypot(dx, dy));

    dragRef.current = {
      mode,
      clipId: clip.id,
      originX: point.x - clip.transform.x,
      originY: point.y - clip.transform.y,
      startTx: clip.transform.x,
      startTy: clip.transform.y,
      startFont: clip.text.fontSize,
      startDist: dist,
    };

    const onMove = (ev: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const st = stageRef.current;
      if (!drag || !st) return;
      const p = clientToCanvas(st, ev.clientX, ev.clientY, canvasWidth, canvasHeight);
      const project = useProjectStore.getState().project;
      const current = project.clips.find((c) => c.id === drag.clipId);
      if (!current?.text) return;

      if (drag.mode === "move") {
        const nextX = Math.min(canvasWidth, Math.max(0, p.x - drag.originX));
        const nextY = Math.min(canvasHeight, Math.max(0, p.y - drag.originY));
        useProjectStore.getState().setProject(
          updateClipTransform(project, drag.clipId, {
            ...current.transform,
            x: nextX,
            y: nextY,
          }),
          { dirty: true },
        );
        return;
      }

      const dist = Math.max(8, Math.hypot(p.x - current.transform.x, p.y - current.transform.y));
      const ratio = dist / drag.startDist;
      const nextFont = Math.round(Math.min(400, Math.max(12, drag.startFont * ratio)));
      useProjectStore.getState().setProject(
        updateClipText(project, drag.clipId, {
          ...current.text,
          fontSize: nextFont,
        }),
        { dirty: true },
      );
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleDelete(event: ReactMouseEvent, clipId: string) {
    event.stopPropagation();
    event.preventDefault();
    commitProjectChange((p) => deleteClips(p, [clipId]));
    setSelectedClipIds([]);
    setStatusMessage("Deleted text");
  }

  return (
    <>
      {items.map(({ clip, trackOrder }) => {
        const style = clip.text!;
        const selected = selectedClipIds.includes(clip.id);
        const fontPx = previewFontPx(clip, stageRef.current);
        const localSec = Math.max(
          0,
          ticksToSeconds(animPlayhead - clip.startTicks),
        );
        const durSec = Math.max(
          0.01,
          ticksToSeconds(clipDurationTicks(clip)),
        );
        const anim = textAnimationVisual(clip.animation, localSec, durSec);
        const transform = ["translate(-50%, -50%)", anim.transform]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={clip.id}
            className={selected ? styles.textBoxSelected : styles.textBox}
            style={{
              left: `${(clip.transform.x / canvasWidth) * 100}%`,
              top: `${(clip.transform.y / canvasHeight) * 100}%`,
              opacity: clip.transform.opacity * anim.opacity,
              transform,
              clipPath: anim.clipPath,
              filter: anim.blurPx > 0.05 ? `blur(${anim.blurPx.toFixed(1)}px)` : undefined,
              zIndex: layerStackZ(trackOrder, "text"),
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              beginGesture(e, clip, "move");
            }}
          >
            <div
              className={styles.textContent}
              style={{
                fontFamily: `"${style.fontFamily}", "Manrope Variable", sans-serif`,
                fontSize: `${fontPx}px`,
                fontWeight: 700,
                color: style.color,
                textAlign: style.align,
              }}
            >
              {style.content}
            </div>

            {selected ? (
              <>
                <button
                  type="button"
                  className={styles.textHandleDelete}
                  title="Delete text"
                  aria-label="Delete text"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => handleDelete(e, clip.id)}
                >
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                    <path
                      d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.textHandleResize}
                  title="Resize text"
                  aria-label="Resize text"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    beginGesture(e, clip, "resize");
                  }}
                >
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
                    <path
                      d="M4 2h6v6M8 4H2v6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
