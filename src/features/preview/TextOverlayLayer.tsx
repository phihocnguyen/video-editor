import {
  useEffect,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  blendModeToCss,
  clipDurationTicks,
  deleteClips,
  layerStackZ,
  normalizeClipEffects,
  textAnimVisual,
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
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);

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
  const itemEls = useRef(new Map<string, HTMLDivElement>());
  const liveRef = useRef({ items, canvasWidth, canvasHeight });
  liveRef.current = { items, canvasWidth, canvasHeight };

  // Drive text animation imperatively at display rate. Routing every frame
  // through React (listPlayhead) capped text motion at ~10fps and felt
  // choppy — same lesson as the ramp playhead hairline. React still owns
  // mount/unmount/positioning; this loop only refreshes opacity/transform.
  useEffect(() => {
    let raf = 0;
    let lastPlayhead = -1;
    let lastItems: TextOverlayItem[] | null = null;
    let lastStageW = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const live = liveRef.current;
      if (live.items.length === 0) return;
      const playhead = useEditorUiStore.getState().playheadTicks;
      const stage = stageRef.current;
      const stageW = stage?.clientWidth ?? live.canvasWidth;
      // Static while paused: skip redundant DOM writes entirely.
      if (playhead === lastPlayhead && live.items === lastItems && stageW === lastStageW) {
        return;
      }
      lastPlayhead = playhead;
      lastItems = live.items;
      lastStageW = stageW;
      const stageScale = stageW / Math.max(1, live.canvasWidth);
      for (const { clip } of live.items) {
        const el = itemEls.current.get(clip.id);
        const style = clip.text;
        if (!el || !style) continue;
        const dur = Math.max(0.01, ticksToSeconds(clipDurationTicks(clip)));
        const local = Math.max(0, ticksToSeconds(playhead - clip.startTicks));
        const anim = textAnimVisual(
          style.textAnimation ?? null,
          normalizeClipEffects(clip.effects),
          local,
          dur,
        );
        el.style.opacity = String(clip.transform.opacity * anim.opacity);
        el.style.mixBlendMode = blendModeToCss(clip.transform.blendMode);
        el.style.transform =
          `translate(-50%, -50%) translate(${(anim.offsetX * stageScale).toFixed(2)}px, ` +
          `${(anim.offsetY * stageScale).toFixed(2)}px) scale(${anim.scale.toFixed(4)})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const durationSec = Math.max(
          0.01,
          ticksToSeconds(clipDurationTicks(clip)),
        );
        const localSec = Math.max(
          0,
          ticksToSeconds(playheadTicks - clip.startTicks),
        );
        const anim = textAnimVisual(
          style.textAnimation ?? null,
          normalizeClipEffects(clip.effects),
          localSec,
          durationSec,
        );
        const stageW = stageRef.current?.clientWidth ?? canvasWidth;
        const stageScale = stageW / Math.max(1, canvasWidth);

        return (
          <div
            key={clip.id}
            ref={(el) => {
              if (el) itemEls.current.set(clip.id, el);
              else itemEls.current.delete(clip.id);
            }}
            className={selected ? styles.textBoxSelected : styles.textBox}
            style={{
              left: `${(clip.transform.x / canvasWidth) * 100}%`,
              top: `${(clip.transform.y / canvasHeight) * 100}%`,
              opacity: clip.transform.opacity * anim.opacity,
              mixBlendMode: blendModeToCss(
                clip.transform.blendMode,
              ) as CSSProperties["mixBlendMode"],
              transform: `translate(-50%, -50%) translate(${anim.offsetX * stageScale}px, ${anim.offsetY * stageScale}px) scale(${anim.scale})`,
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
                fontWeight: style.fontWeight,
                color: style.color,
                textAlign: style.align,
                ...(style.backgroundColor
                  ? {
                      display: "inline",
                      backgroundColor: style.backgroundColor,
                      padding: `${Math.max(2, style.backgroundPadding * stageScale)}px ${Math.max(4, style.backgroundPadding * 1.35 * stageScale)}px`,
                      borderRadius: `${Math.max(0, style.backgroundRadius * stageScale)}px`,
                      boxDecorationBreak: "clone" as const,
                      WebkitBoxDecorationBreak: "clone" as const,
                    }
                  : null),
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
                {(
                  [
                    ["cornerNW", "Resize from top-left"],
                    ["cornerNE", "Resize from top-right"],
                    ["cornerSW", "Resize from bottom-left"],
                    ["cornerSE", "Resize from bottom-right"],
                  ] as const
                ).map(([cls, label]) => (
                  <button
                    key={cls}
                    type="button"
                    className={`${styles.cornerHandle} ${styles[cls]}`}
                    title="Resize text"
                    aria-label={label}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      beginGesture(e, clip, "resize");
                    }}
                  />
                ))}
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
