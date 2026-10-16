import {
  useEffect,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  blendModeToCss,
  clipDurationTicks,
  layerStackZ,
  paramHasTransformKeyframes,
  progressFromTicks,
  transformAtProgress,
  normalizeClipEffects,
  normalizeTextStyle,
  textAnimVisual,
  ticksToSeconds,
  applyTransformPatch,
  updateClipText,
  type Clip,
} from "../../domain";
import { useHistoryStore } from "../../stores/historyStore";
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

function textDecorationCss(style: {
  underline: boolean;
  strikethrough: boolean;
}): string | undefined {
  const parts: string[] = [];
  if (style.underline) parts.push("underline");
  if (style.strikethrough) parts.push("line-through");
  return parts.length ? parts.join(" ") : undefined;
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
  const textQuickUi = useEditorUiStore((s) => s.textQuickUi);
  const setTextQuickUi = useEditorUiStore((s) => s.setTextQuickUi);
  const patchTextQuickUi = useEditorUiStore((s) => s.patchTextQuickUi);
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
  const editEls = useRef(new Map<string, HTMLDivElement>());
  const liveRef = useRef({ items, canvasWidth, canvasHeight });
  liveRef.current = { items, canvasWidth, canvasHeight };

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
      if (playhead === lastPlayhead && live.items === lastItems && stageW === lastStageW) {
        return;
      }
      lastPlayhead = playhead;
      lastItems = live.items;
      lastStageW = stageW;
      const stageScale = stageW / Math.max(1, live.canvasWidth);
      const editingId =
        useEditorUiStore.getState().textQuickUi?.mode === "edit"
          ? useEditorUiStore.getState().textQuickUi?.clipId
          : null;
      for (const { clip } of live.items) {
        const el = itemEls.current.get(clip.id);
        const style = clip.text;
        if (!el || !style) continue;
        if (editingId === clip.id) continue;
        const dur = Math.max(0.01, ticksToSeconds(clipDurationTicks(clip)));
        const local = Math.max(0, ticksToSeconds(playhead - clip.startTicks));
        const anim = textAnimVisual(
          style.textAnimation ?? null,
          normalizeClipEffects(clip.effects),
          local,
          dur,
        );
        const progress = progressFromTicks(
          clip.startTicks,
          clipDurationTicks(clip),
          playhead,
        );
        const tr = transformAtProgress(clip.transform, clip.transformKeyframes, progress);
        const sx = tr.scaleX || 1;
        const sy = tr.scaleY || 1;
        const posX = paramHasTransformKeyframes(clip.transformKeyframes, "x")
          ? tr.x
          : clip.transform.x;
        const posY = paramHasTransformKeyframes(clip.transformKeyframes, "y")
          ? tr.y
          : clip.transform.y;
        el.style.left = `${(posX / live.canvasWidth) * 100}%`;
        el.style.top = `${(posY / live.canvasHeight) * 100}%`;
        el.style.opacity = String(tr.opacity * anim.opacity);
        el.style.mixBlendMode = blendModeToCss(clip.transform.blendMode);
        el.style.transform =
          `translate(-50%, -50%) translate(${(anim.offsetX * stageScale).toFixed(2)}px, ` +
          `${(anim.offsetY * stageScale).toFixed(2)}px) scale(${(anim.scale * Math.abs(sx)).toFixed(4)}, ${(anim.scale * Math.abs(sy)).toFixed(4)})` +
          `${sx < 0 || sy < 0 ? ` scale(${sx < 0 ? -1 : 1}, ${sy < 0 ? -1 : 1})` : ""}`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed + focus contentEditable when entering edit mode (avoid React-controlled children)
  useEffect(() => {
    if (textQuickUi?.mode !== "edit") return;
    const id = textQuickUi.clipId;
    let tries = 0;
    const focusEdit = () => {
      const el = editEls.current.get(id);
      if (!el) {
        if (tries++ < 8) requestAnimationFrame(focusEdit);
        return;
      }
      const project = useProjectStore.getState().project;
      const content = project.clips.find((c) => c.id === id)?.text?.content ?? "";
      if (el.innerText !== content) el.innerText = content;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    focusEdit();
  }, [textQuickUi?.mode, textQuickUi?.clipId]);

  function previewFontPx(clip: Clip, stage: HTMLDivElement | null): number {
    const style = clip.text!;
    const stageW = stage?.clientWidth ?? canvasWidth;
    const scale = stageW / Math.max(1, canvasWidth);
    return Math.max(10, style.fontSize * scale * Math.abs(clip.transform.scaleX || 1));
  }

  function beginGesture(
    event: ReactPointerEvent,
    clip: Clip,
    mode: "move" | "resize",
  ) {
    if (textQuickUi?.mode === "edit" && textQuickUi.clipId === clip.id) return;
    event.stopPropagation();
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage || !clip.text) return;

    setPlaying(false);
    setSelectedClipIds([clip.id]);
    setTextQuickUi({
      clipId: clip.id,
      mode: "select",
      stylesOpen: false,
      moreOpen: false,
    });

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
          applyTransformPatch(
            project,
            drag.clipId,
            { x: nextX, y: nextY },
            useEditorUiStore.getState().playheadTicks,
          ),
          { dirty: true },
        );
        return;
      }

      const dist = Math.max(
        8,
        Math.hypot(p.x - current.transform.x, p.y - current.transform.y),
      );
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

  function commitEditContent(clipId: string, raw: string) {
    const project = useProjectStore.getState().project;
    const current = project.clips.find((c) => c.id === clipId);
    if (!current?.text) return;
    const content = raw.replace(/\u00a0/g, " ");
    if (content === current.text.content) return;
    useHistoryStore.getState().pushHistory(project);
    useProjectStore.getState().setProject(
      updateClipText(project, clipId, { ...current.text, content }),
      { dirty: true },
    );
  }

  function exitEdit() {
    patchTextQuickUi({ mode: "select" });
  }

  return (
    <>
      {items.map(({ clip, trackOrder }) => {
        const style = normalizeTextStyle(clip.text);
        const selected = selectedClipIds.includes(clip.id);
        const editing =
          selected && textQuickUi?.mode === "edit" && textQuickUi.clipId === clip.id;
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
        const progress = progressFromTicks(
          clip.startTicks,
          clipDurationTicks(clip),
          playheadTicks,
        );
        const tr = transformAtProgress(clip.transform, clip.transformKeyframes, progress);
        const xAbs = paramHasTransformKeyframes(clip.transformKeyframes, "x");
        const yAbs = paramHasTransformKeyframes(clip.transformKeyframes, "y");
        const posX = xAbs ? tr.x : clip.transform.x;
        const posY = yAbs ? tr.y : clip.transform.y;
        const stageW = stageRef.current?.clientWidth ?? canvasWidth;
        const stageScale = stageW / Math.max(1, canvasWidth);
        const sx = tr.scaleX || 1;
        const sy = tr.scaleY || 1;
        const flipScale =
          sx < 0 || sy < 0 ? ` scale(${sx < 0 ? -1 : 1}, ${sy < 0 ? -1 : 1})` : "";

        const contentStyle: CSSProperties = {
          fontFamily: `"${style.fontFamily}", "Manrope Variable", sans-serif`,
          fontSize: `${fontPx}px`,
          fontWeight: style.fontWeight,
          fontStyle: style.italic ? "italic" : "normal",
          textDecoration: textDecorationCss(style),
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
        };

        return (
          <div
            key={clip.id}
            data-text-clip-id={clip.id}
            ref={(el) => {
              if (el) itemEls.current.set(clip.id, el);
              else itemEls.current.delete(clip.id);
            }}
            className={selected ? styles.textBoxSelected : styles.textBox}
            style={{
              left: `${(posX / canvasWidth) * 100}%`,
              top: `${(posY / canvasHeight) * 100}%`,
              opacity: tr.opacity * anim.opacity,
              mixBlendMode: blendModeToCss(
                clip.transform.blendMode,
              ) as CSSProperties["mixBlendMode"],
              transform: `translate(-50%, -50%) translate(${anim.offsetX * stageScale}px, ${anim.offsetY * stageScale}px) scale(${anim.scale * Math.abs(sx)}, ${anim.scale * Math.abs(sy)})${flipScale}`,
              zIndex: layerStackZ(trackOrder, "text"),
              cursor: editing ? "text" : undefined,
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (editing) {
                e.stopPropagation();
                return;
              }
              beginGesture(e, clip, "move");
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setSelectedClipIds([clip.id]);
              setTextQuickUi({
                clipId: clip.id,
                mode: "edit",
                stylesOpen: false,
                moreOpen: false,
              });
            }}
          >
            {editing ? (
              <div
                ref={(el) => {
                  if (el) editEls.current.set(clip.id, el);
                  else editEls.current.delete(clip.id);
                }}
                className={styles.textContent}
                style={{ ...contentStyle, pointerEvents: "auto", outline: "none" }}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Edit text"
                onPointerDown={(e) => e.stopPropagation()}
                onInput={(e: FormEvent<HTMLDivElement>) => {
                  // live preview without history spam
                  const project = useProjectStore.getState().project;
                  const current = project.clips.find((c) => c.id === clip.id);
                  if (!current?.text) return;
                  useProjectStore.getState().setProject(
                    updateClipText(project, clip.id, {
                      ...current.text,
                      content: e.currentTarget.innerText.replace(/\u00a0/g, " "),
                    }),
                    { dirty: true },
                  );
                }}
                onBlur={(e) => {
                  commitEditContent(clip.id, e.currentTarget.innerText);
                  // Keep edit mode when focus moves to the floating format bar
                  // (Bold / color picker). Exit only via Done, Escape, or deselect.
                  const next = e.relatedTarget as Node | null;
                  const bar = document.querySelector("[data-text-quick-access]");
                  if (next && bar?.contains(next)) return;
                }}
                onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitEditContent(clip.id, e.currentTarget.innerText);
                    exitEdit();
                  }
                }}
              />
            ) : (
              <div className={styles.textContent} style={contentStyle}>
                {style.content}
              </div>
            )}

            {selected && !editing
              ? (
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
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}
