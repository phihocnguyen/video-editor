/**
 * Interactive overlay for media (video/image) layers on the preview stage.
 *
 * Renders a transparent, correctly-sized/rotated box over each visible media
 * layer so it can be selected, moved (drag), resized (corner handle) and rotated
 * (top handle) — matching the text-overlay interaction model.
 *
 * Actual media pixels are rendered by `CompositeLayers`; this layer only handles
 * pointer interaction and the selection chrome.
 */

import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  layerStackZ,
  updateClipTransform,
  type Clip,
  type MediaAsset,
} from "../../domain";
import { mediaGeometry } from "../../domain/mediaTransform";
import { useHistoryStore } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./PreviewPanel.module.css";

export interface MediaOverlayItem {
  clip: Clip;
  asset: MediaAsset;
  trackOrder: number;
}

interface MediaOverlayLayerProps {
  items: MediaOverlayItem[];
  canvasWidth: number;
  canvasHeight: number;
  stageRef: RefObject<HTMLDivElement | null>;
}

type GestureMode = "move" | "resize" | "rotate";

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

export function MediaOverlayLayer({
  items,
  canvasWidth,
  canvasHeight,
  stageRef,
}: MediaOverlayLayerProps) {
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);

  const dragRef = useRef<{
    mode: GestureMode;
    clipId: string;
    grabX: number;
    grabY: number;
    startX: number;
    startY: number;
    startScaleX: number;
    startScaleY: number;
    startRotation: number;
    startDist: number;
    startAngle: number;
  } | null>(null);

  function beginGesture(
    event: ReactPointerEvent,
    clip: Clip,
    asset: MediaAsset,
    mode: GestureMode,
  ) {
    event.stopPropagation();
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    setPlaying(false);
    setSelectedClipIds([clip.id]);
    setActivePanel("clip");

    const before = useProjectStore.getState().project;
    useHistoryStore.getState().pushHistory(before);

    const geom = mediaGeometry(clip.transform, canvasWidth, canvasHeight, asset);
    const point = clientToCanvas(
      stage,
      event.clientX,
      event.clientY,
      canvasWidth,
      canvasHeight,
    );

    dragRef.current = {
      mode,
      clipId: clip.id,
      grabX: point.x - geom.centerX,
      grabY: point.y - geom.centerY,
      startX: geom.centerX,
      startY: geom.centerY,
      startScaleX: geom.scaleX,
      startScaleY: geom.scaleY,
      startRotation: geom.rotation,
      startDist: Math.max(8, Math.hypot(point.x - geom.centerX, point.y - geom.centerY)),
      startAngle:
        (Math.atan2(point.y - geom.centerY, point.x - geom.centerX) * 180) / Math.PI,
    };

    const onMove = (ev: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const st = stageRef.current;
      if (!drag || !st) return;
      const p = clientToCanvas(st, ev.clientX, ev.clientY, canvasWidth, canvasHeight);
      const project = useProjectStore.getState().project;
      const current = project.clips.find((c) => c.id === drag.clipId);
      if (!current) return;

      if (drag.mode === "move") {
        const nextX = Math.min(canvasWidth, Math.max(0, p.x - drag.grabX));
        const nextY = Math.min(canvasHeight, Math.max(0, p.y - drag.grabY));
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

      if (drag.mode === "rotate") {
        const angle =
          (Math.atan2(p.y - drag.startY, p.x - drag.startX) * 180) / Math.PI;
        const delta = angle - drag.startAngle;
        useProjectStore.getState().setProject(
          updateClipTransform(project, drag.clipId, {
            ...current.transform,
            rotation: Math.round(drag.startRotation + delta),
          }),
          { dirty: true },
        );
        return;
      }

      // resize — proportional scale from the layer centre.
      const dist = Math.max(8, Math.hypot(p.x - drag.startX, p.y - drag.startY));
      const ratio = dist / drag.startDist;
      const sx = Math.min(20, Math.max(0.02, drag.startScaleX * ratio));
      const sy = Math.min(20, Math.max(0.02, drag.startScaleY * ratio));
      useProjectStore.getState().setProject(
        updateClipTransform(project, drag.clipId, {
          ...current.transform,
          scaleX: sx,
          scaleY: sy,
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

  return (
    <>
      {items.map(({ clip, asset, trackOrder }) => {
        const selected = selectedClipIds.includes(clip.id);
        const geom = mediaGeometry(clip.transform, canvasWidth, canvasHeight, asset);
        const leftPct = (geom.centerX / canvasWidth) * 100;
        const topPct = (geom.centerY / canvasHeight) * 100;
        const widthPct = (geom.boxWidth / canvasWidth) * 100;
        const heightPct = (geom.boxHeight / canvasHeight) * 100;

        return (
          <div
            key={clip.id}
            className={selected ? styles.mediaLayerSelected : styles.mediaLayer}
            style={{
              left: `${leftPct}%`,
              top: `${topPct}%`,
              width: `${widthPct}%`,
              height: `${heightPct}%`,
              transform: `translate(-50%, -50%) rotate(${geom.rotation}deg)`,
              zIndex: layerStackZ(trackOrder, "mediaHit"),
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              beginGesture(e, clip, asset, "move");
            }}
          >
            {selected ? (
              <>
                <button
                  type="button"
                  className={styles.mediaHandleRotate}
                  title="Rotate"
                  aria-label="Rotate layer"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    beginGesture(e, clip, asset, "rotate");
                  }}
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
                    <path
                      d="M9.5 4.5A4 4 0 1 0 10 6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.mediaHandleResize}
                  title="Resize"
                  aria-label="Resize layer"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    beginGesture(e, clip, asset, "resize");
                  }}
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
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
