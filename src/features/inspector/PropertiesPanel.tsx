import {
  useEffect,
  useRef,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  BLEND_MODE_OPTIONS,
  clipDisplayTitle,
  clipDurationTicks,
  findMatchingFilterTemplate,
  effectsAtProgress,
  findKeyframeNear,
  getParamTrack,
  interpolateParamEased,
  mediaGeometry,
  mediaCenter,
  normalizeBlendMode,
  normalizeClipTransition,
  normalizeTextAnimation,
  normalizeTextStyle,
  paramHasKeyframes,
  progressFromTicks,
  DEFAULT_CLIP_EFFECTS,
  findPreviousClipOnTrack,
  setClipEffectKeyframes,
  setEffectKeyframeEasing,
  setEffectParamAtPlayhead,
  setParamTrackPoints,
  EASING_OPTIONS,
  type EasingType,
  toggleEffectKeyframeAtPlayhead,
  TEXT_ANIM_OPTIONS,
  TRANSITION_DEFS,
  TRANSITION_GROUPS,
  transitionDef,
  applyTransformPatch,
  findTransformKeyframeNear,
  getTransformTrack,
  paramHasTransformKeyframes,
  setClipLinkLocked,
  transformAtProgress,
  toggleTransformKeyframeAtPlayhead,
  updateClipEffects,
  updateClipText,
  updateClipTransition,
  updateClipVolume,
  upsertParamKeyframe,
  withListStyle,
  type BlendMode,
  type Clip,
  type EffectKeyframe,
  type EffectParamKey,
  type TransformParamKey,
  type TextAnimType,
  type TextStyle,
  type TransitionType,
} from "../../domain";
import { cn } from "../../lib/utils";
import {
  listFontOptions,
  pickBrowserFontFile,
  registerCustomFontFile,
} from "../../lib/fonts";
import { isTauriRuntime } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CloseIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  PlayIcon,
} from "../../components/icons";
import { PresetGrid, type PresetItem } from "../effects/PresetGrid";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./InspectorPanel.module.css";

const TRANSITION_ITEMS: PresetItem[] = TRANSITION_DEFS.map((d) => ({
  id: d.type,
  label: d.label,
  hint: d.hint,
  group: d.group,
}));

const EFFECT_PARAM_LABELS: Partial<Record<EffectParamKey, string>> = {
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  blur: "Blur",
  vignette: "Vignette",
  sharpen: "Sharpen",
  grayscale: "Grayscale",
  strobeFrames: "Strobe",
  zoom: "Zoom",
  shake: "Shake",
};

function EffectCurveGraph({
  points,
  easing,
  fallback,
  progress,
  editable = false,
  valueMin,
  valueMax,
  onCommitPoints,
  onAddPoint,
  onRemovePoint,
}: {
  points: EffectKeyframe[];
  easing: EasingType;
  fallback: number;
  progress: number;
  editable?: boolean;
  valueMin?: number;
  valueMax?: number;
  onCommitPoints?: (points: EffectKeyframe[]) => void;
  onAddPoint?: (atProgress: number, value: number) => void;
  onRemovePoint?: (id: string) => void;
}) {
  const W = 240;
  const H = 64;
  const padX = 8;
  const padY = 8;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draftRef = useRef<EffectKeyframe[] | null>(null);
  const [draft, setDraft] = useState<EffectKeyframe[] | null>(null);
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!draggingRef.current) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [points]);

  const shown = draft ?? points;
  const values = shown.length ? shown.map((p) => p.value) : [fallback];
  const min = valueMin ?? Math.min(...values, fallback, 0);
  const max = valueMax ?? Math.max(...values, fallback + 0.0001);
  const range = Math.max(0.0001, max - min);
  const x = (u: number) => padX + u * (W - padX * 2);
  const y = (v: number) => H - padY - ((v - min) / range) * (H - padY * 2);
  const valueAt = (u: number) =>
    shown.length
      ? interpolateParamEased(shown, u, shown[0]!.value, easing)
      : fallback;
  let path = `M${x(0).toFixed(2)} ${y(valueAt(0)).toFixed(2)}`;
  for (let i = 1; i <= 96; i += 1) {
    const u = i / 96;
    path += ` L${x(u).toFixed(2)} ${y(valueAt(u)).toFixed(2)}`;
  }
  const headX = x(clamp(progress, 0, 1));

  function pointFromEvent(event: {
    clientX: number;
    clientY: number;
    currentTarget: SVGSVGElement;
  }) {
    const rect = event.currentTarget.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / Math.max(1, rect.width)) * W;
    const vy = ((event.clientY - rect.top) / Math.max(1, rect.height)) * H;
    const atProgress = clamp((vx - padX) / (W - padX * 2), 0, 1);
    const value =
      min +
      clamp((H - padY - vy) / (H - padY * 2), 0, 1) * range;
    return { atProgress, value };
  }

  function updateDraft(next: EffectKeyframe[]) {
    draftRef.current = next;
    setDraft(next);
  }

  function beginDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    id: string,
  ) {
    if (!editable || !onCommitPoints) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    draggingRef.current = id;
    updateDraft(points.map((point) => ({ ...point })));
  }

  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    const current = draftRef.current;
    if (!current) return;
    event.preventDefault();
    const nextPoint = pointFromEvent(event);
    updateDraft(
      current.map((point) =>
        point.id === draggingRef.current
          ? {
              ...point,
              atProgress: nextPoint.atProgress,
              value: nextPoint.value,
            }
          : point,
      ),
    );
  }

  function endDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const id = draggingRef.current;
    if (!id) return;
    event.preventDefault();
    const committed = draftRef.current;
    draggingRef.current = null;
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    draftRef.current = null;
    setDraft(null);
    if (committed && onCommitPoints) onCommitPoints(committed);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={cn(
        "h-16 w-full text-primary",
        editable && "touch-none select-none",
      )}
      preserveAspectRatio="none"
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        if (!editable || !onAddPoint) return;
        const nextPoint = pointFromEvent(event);
        onAddPoint(nextPoint.atProgress, nextPoint.value);
      }}
      aria-hidden={!editable}
    >
      <rect width={W} height={H} fill="transparent" />
      <path
        d={`M${padX} ${H / 2} H${W - padX}`}
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.12"
      />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      {shown.map((point) => (
        <circle
          key={point.id}
          cx={x(clamp(point.atProgress, 0, 1))}
          cy={y(point.value)}
          r={editable ? 3.4 : 2.6}
          fill="currentColor"
          className={editable ? "cursor-grab active:cursor-grabbing" : undefined}
          onPointerDown={(event) => beginDrag(event, point.id)}
          onDoubleClick={(event) => {
            if (!editable || !onRemovePoint) return;
            event.preventDefault();
            event.stopPropagation();
            onRemovePoint(point.id);
          }}
        />
      ))}
      <line
        x1={headX}
        y1="3"
        x2={headX}
        y2={H - 3}
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 3"
        opacity="0.65"
      />
    </svg>
  );
}

function EasingPicker({
  current,
  label,
  disabled,
  onSelect,
}: {
  current: EasingType;
  label: string;
  disabled?: boolean;
  onSelect: (easing: EasingType) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {EASING_OPTIONS.map((option) => {
        const active = current === option.id;
        return (
          <button
            key={option.id}
            type="button"
            title={option.label}
            aria-label={`${label} ${option.label}`}
            aria-pressed={active}
            disabled={disabled}
            className={cn(
              "grid size-6 place-items-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-35",
              active
                ? "border-primary bg-primary/15 text-primary"
                : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
            onClick={() => onSelect(option.id)}
          >
            <svg width="18" height="14" viewBox="0 0 28 18" fill="none" aria-hidden>
              <path
                d={option.path}
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

type AlignEdge = "left" | "centerH" | "right" | "top" | "middle" | "bottom";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function PencilIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M11.2 2.4l2.4 2.4-8.2 8.2H3v-2.4l8.2-8.2zM9.8 3.8l2.4 2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6 3.5 10.5 8 6 12.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DistributeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 3h12M2 13h12M5 6h6v4H5z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** CapCut-style filled opacity bar (not a native range input). */
function OpacityBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function setFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    onChange(Math.round(t * 100) / 100);
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    setFromClientX(e.clientX);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  const pct = Math.round(clamp(value, 0, 1) * 100);

  return (
    <div
      ref={trackRef}
      className={styles.opacityBar}
      role="slider"
      tabIndex={0}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label="Opacity"
      title="Opacity"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(clamp(value - 0.01, 0, 1));
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(clamp(value + 0.01, 0, 1));
        }
      }}
    >
      <div className={styles.opacityFill} style={{ width: `${pct}%` }} />
      <span className={styles.opacityValue}>{pct}</span>
    </div>
  );
}

function StepperField({
  label,
  value,
  display,
  step = 1,
  min,
  max,
  onChange,
  keyframeActive,
  keyframeOn,
  onToggleKeyframe,
}: {
  label: string;
  value: number;
  display?: string;
  step?: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** Show CapCut-style ◇ control. */
  keyframeActive?: boolean;
  /** Diamond filled when a keyframe sits at the playhead. */
  keyframeOn?: boolean;
  onToggleKeyframe?: () => void;
}) {
  const [draft, setDraft] = useState(display ?? String(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(display ?? String(value));
  }, [display, value, editing]);

  function commitDraft(raw: string) {
    const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed)) {
      setDraft(display ?? String(value));
      return;
    }
    onChange(clamp(parsed, min, max));
  }

  return (
    <div className="flex w-full items-center justify-between gap-2">
      <span className="min-w-0 shrink truncate text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {onToggleKeyframe ? (
          <button
            type="button"
            title={
              keyframeOn
                ? "Remove keyframe at playhead"
                : keyframeActive
                  ? "Add keyframe at playhead"
                  : "Add keyframe at playhead (starts animating this param)"
            }
            aria-label={`Keyframe ${label}`}
            aria-pressed={Boolean(keyframeOn)}
            className={
              keyframeOn
                ? "grid h-8 w-7 place-items-center rounded-md text-primary"
                : keyframeActive
                  ? "grid h-8 w-7 place-items-center rounded-md text-foreground/80 hover:bg-accent"
                  : "grid h-8 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            }
            onClick={onToggleKeyframe}
          >
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
              <path
                d="M6 1.2 L10.8 6 L6 10.8 L1.2 6 Z"
                fill={keyframeOn ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="grid h-8 w-[148px] shrink-0 grid-cols-[32px_1fr_32px] items-center overflow-hidden rounded-lg border border-border bg-secondary">
          <button
            type="button"
            className="grid h-full place-items-center text-base leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(clamp(value - step, min, max))}
          >
            −
          </button>
          <input
            className="h-full w-full min-w-0 border-x border-border bg-transparent px-1 text-center text-xs font-semibold tabular-nums text-foreground outline-none focus-visible:bg-accent/40"
            value={editing ? draft : (display ?? String(value))}
            aria-label={label}
            onFocus={() => {
              setEditing(true);
              setDraft(String(value));
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(false);
              commitDraft(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setDraft(display ?? String(value));
                setEditing(false);
                e.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            className="grid h-full place-items-center text-base leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(clamp(value + step, min, max))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function AlignIcon({ kind }: { kind: AlignEdge }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
  };
  switch (kind) {
    case "left":
      return (
        <svg {...common}>
          <path d="M2 2v12M5 5h8v6H5z" />
        </svg>
      );
    case "centerH":
      return (
        <svg {...common}>
          <path d="M8 2v12M4 5h8v6H4z" />
        </svg>
      );
    case "right":
      return (
        <svg {...common}>
          <path d="M14 2v12M3 5h8v6H3z" />
        </svg>
      );
    case "top":
      return (
        <svg {...common}>
          <path d="M2 2h12M5 5h6v8H5z" />
        </svg>
      );
    case "middle":
      return (
        <svg {...common}>
          <path d="M2 8h12M5 4h6v8H5z" />
        </svg>
      );
    case "bottom":
      return (
        <svg {...common}>
          <path d="M2 14h12M5 3h6v8H5z" />
        </svg>
      );
  }
}

function FlipHIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 2v12M3 5l4 3-4 3V5zM13 5l-4 3 4 3V5z" />
    </svg>
  );
}

function FlipVIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 8h12M5 3l3 4 3-4H5zM5 13l3-4 3 4H5z" />
    </svg>
  );
}

/** Shown when nothing is selected. */
function NoSelectionPanel() {
  return (
    <div className={styles.propsPanel}>
      <div className={styles.propsEmpty}>
        <p className={styles.propsEmptyTitle}>Properties</p>
        <p className={styles.propsEmptyHint}>Select a clip to edit its properties.</p>
      </div>
    </div>
  );
}

/** Selection-driven CapCut-style properties column (right of preview). */
export function PropertiesPanel() {
  const project = useProjectStore((s) => s.project);
  const clips = project.clips;
  const assets = project.assets;
  const canvas = project.canvas;
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [fontOptions, setFontOptions] = useState(() => listFontOptions());
  const [sizeOpen, setSizeOpen] = useState(false);
  const [roundCorners, setRoundCorners] = useState(0);
  const [strokeVisible, setStrokeVisible] = useState(false);
  const [fillVisible, setFillVisible] = useState(true);

  const clip = useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    return clips.find((c) => c.id === id) ?? null;
  }, [clips, selectedClipIds]);

  useEffect(() => {
    setRoundCorners(0);
    setStrokeVisible(false);
    setFillVisible(true);
    setSizeOpen(false);
  }, [clip?.id]);

  if (!clip) {
    return <NoSelectionPanel />;
  }

  const selected = clip;
  if (selected.kind === "filter") {
    const look = findMatchingFilterTemplate(selected.effects);
    return (
      <div className={styles.propsPanel}>
        <div className={styles.propsEmpty}>
          <p className={styles.propsEmptyTitle}>{look?.label ?? "Filter"}</p>
          <p className={styles.propsEmptyHint}>
            This wash sits on its own track. Trim or move the clip to cover only the section you want.
          </p>
        </div>
      </div>
    );
  }
  const asset =
    (selected.assetId ? assets.find((a) => a.id === selected.assetId) : null) ?? null;
  const isText = selected.kind === "text";
  const isAudio = !isText && asset?.kind === "audio";
  const isVisual = isText || (!isAudio && selected.kind === "media");
  const showVolume = selected.kind === "media" && Boolean(asset?.hasAudio || isAudio);
  const showEffects = selected.kind === "media" && !isAudio;
  const clipProgress = progressFromTicks(
    selected.startTicks,
    clipDurationTicks(selected),
    playheadTicks,
  );
  const effects = effectsAtProgress(
    selected.effects,
    selected.effectKeyframes,
    clipProgress,
  );
  const shakeTrack = getParamTrack(selected.effectKeyframes, "shake");
  const shakeEasing = shakeTrack?.easing ?? "linear";
  const shakeKeyframeHere = Boolean(
    shakeTrack && findKeyframeNear(shakeTrack.points, clipProgress),
  );
  const transition = normalizeClipTransition(selected.transitionIn);

  function kfProps(param: EffectParamKey) {
    const track = getParamTrack(selected.effectKeyframes, param);
    const on = Boolean(track && findKeyframeNear(track.points, clipProgress));
    return {
      keyframeActive: paramHasKeyframes(selected.effectKeyframes, param),
      keyframeOn: on,
      onToggleKeyframe: () =>
        commitProjectChange((p) =>
          toggleEffectKeyframeAtPlayhead(p, selected.id, param, playheadTicks),
        ),
    };
  }

  function setParam(param: EffectParamKey, value: number) {
    commitProjectChange((p) =>
      setEffectParamAtPlayhead(p, selected.id, param, value, playheadTicks),
    );
  }

  function toggleShakeKeyframe() {
    if (shakeKeyframeHere) {
      commitProjectChange((p) =>
        toggleEffectKeyframeAtPlayhead(
          p,
          selected.id,
          "shake",
          playheadTicks,
        ),
      );
      return;
    }
    commitProjectChange((p) => {
      const clip = p.clips.find((item) => item.id === selected.id);
      if (!clip) return p;
      const value = effectsAtProgress(
        clip.effects,
        clip.effectKeyframes,
        clipProgress,
      ).shake;
      return setClipEffectKeyframes(
        p,
        selected.id,
        upsertParamKeyframe(
          clip.effectKeyframes,
          "shake",
          clipProgress,
          value,
        ),
      );
    });
  }

  function commitShakePoints(points: EffectKeyframe[]) {
    commitProjectChange((p) => {
      const clip = p.clips.find((item) => item.id === selected.id);
      if (!clip) return p;
      return setClipEffectKeyframes(
        p,
        selected.id,
        setParamTrackPoints(
          clip.effectKeyframes,
          "shake",
          points,
          shakeTrack?.easing,
        ),
      );
    });
  }

  function addShakePoint(atProgress: number, value: number) {
    commitProjectChange((p) => {
      const clip = p.clips.find((item) => item.id === selected.id);
      if (!clip) return p;
      return setClipEffectKeyframes(
        p,
        selected.id,
        upsertParamKeyframe(
          clip.effectKeyframes,
          "shake",
          atProgress,
          value,
        ),
      );
    });
  }

  function removeShakePoint(id: string) {
    commitProjectChange((p) => {
      const clip = p.clips.find((item) => item.id === selected.id);
      if (!clip) return p;
      const track = getParamTrack(clip.effectKeyframes, "shake");
      return setClipEffectKeyframes(
        p,
        selected.id,
        setParamTrackPoints(
          clip.effectKeyframes,
          "shake",
          (track?.points ?? []).filter((point) => point.id !== id),
          shakeTrack?.easing,
        ),
      );
    });
  }
  const prev = findPreviousClipOnTrack(project, selected.id);
  const canTransition = showEffects && Boolean(prev);
  const text = normalizeTextStyle(selected.text);
  const title = clipDisplayTitle(project, selected, asset);
  const fillKind = isText ? "Text" : asset?.kind === "image" ? "Image" : "Video";

  const resolved = transformAtProgress(
    selected.transform,
    selected.transformKeyframes,
    clipProgress,
  );
  const xTracked = paramHasTransformKeyframes(selected.transformKeyframes, "x");
  const yTracked = paramHasTransformKeyframes(selected.transformKeyframes, "y");
  const geom = isVisual && !isText
    ? mediaGeometry(resolved, canvas.width, canvas.height, asset)
    : null;
  const baseCenter = isText
    ? { x: selected.transform.x, y: selected.transform.y }
    : mediaCenter(selected.transform, canvas.width, canvas.height);
  const center = {
    x: xTracked ? resolved.x : baseCenter.x,
    y: yTracked ? resolved.y : baseCenter.y,
  };
  if (geom && (xTracked || yTracked)) {
    geom.centerX = center.x;
    geom.centerY = center.y;
  }

  function patchTransform(patch: Partial<Clip["transform"]>) {
    commitProjectChange((p) =>
      applyTransformPatch(p, selected.id, patch, playheadTicks),
    );
  }

  function transformDiamond(param: TransformParamKey) {
    const track = getTransformTrack(selected.transformKeyframes, param);
    const on = Boolean(track && findTransformKeyframeNear(track.points, clipProgress));
    const active = paramHasTransformKeyframes(selected.transformKeyframes, param);
    return (
      <button
        type="button"
        title={on ? "Remove keyframe at playhead" : "Add keyframe at playhead"}
        aria-label={`Keyframe ${param}`}
        aria-pressed={on}
        className={
          on
            ? "grid h-7 w-6 place-items-center rounded-md text-primary"
            : active
              ? "grid h-7 w-6 place-items-center rounded-md text-foreground/80 hover:bg-accent"
              : "grid h-7 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        }
        onClick={() =>
          commitProjectChange((p) =>
            toggleTransformKeyframeAtPlayhead(p, selected.id, param, playheadTicks),
          )
        }
      >
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden>
          <path
            d="M6 1.2 L10.8 6 L6 10.8 L1.2 6 Z"
            fill={on ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  function align(edge: AlignEdge) {
    if (!isVisual) return;
    if (isText) {
      let x = selected.transform.x;
      let y = selected.transform.y;
      if (edge === "left") x = canvas.width * 0.15;
      if (edge === "centerH") x = canvas.width / 2;
      if (edge === "right") x = canvas.width * 0.85;
      if (edge === "top") y = canvas.height * 0.2;
      if (edge === "middle") y = canvas.height / 2;
      if (edge === "bottom") y = canvas.height * 0.8;
      patchTransform({ x, y });
      return;
    }
    const g = mediaGeometry(selected.transform, canvas.width, canvas.height, asset);
    let x = g.centerX;
    let y = g.centerY;
    if (edge === "left") x = g.boxWidth / 2;
    if (edge === "centerH") x = canvas.width / 2;
    if (edge === "right") x = canvas.width - g.boxWidth / 2;
    if (edge === "top") y = g.boxHeight / 2;
    if (edge === "middle") y = canvas.height / 2;
    if (edge === "bottom") y = canvas.height - g.boxHeight / 2;
    patchTransform({ x, y });
  }

  function applyText(next: TextStyle) {
    commitProjectChange((p) => updateClipText(p, selected.id, next));
  }

  async function handleBrowseFont() {
    try {
      if (isTauriRuntime()) {
        const selectedPath = await open({
          multiple: false,
          filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
        });
        if (typeof selectedPath !== "string") return;
        const name = selectedPath.split(/[/\\]/).pop() ?? "Custom Font";
        const family = name.replace(/\.(ttf|otf|woff2?)$/i, "");
        const option = {
          id: `custom-${crypto.randomUUID()}`,
          family,
          path: selectedPath,
          source: "custom" as const,
        };
        setFontOptions((prevOpts) => [...prevOpts, option]);
        applyText({ ...text, fontFamily: family, fontPath: selectedPath });
        setStatusMessage(`Font selected · ${family}`);
        return;
      }
      const file = await pickBrowserFontFile();
      if (!file) return;
      const option = await registerCustomFontFile(file);
      setFontOptions(listFontOptions());
      applyText({ ...text, fontFamily: option.family, fontPath: null });
      setStatusMessage(`Font loaded · ${option.family}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Font browse failed");
    }
  }

  const edges: AlignEdge[] = ["left", "centerH", "right", "top", "middle", "bottom"];

  return (
    <div className={styles.propsPanel}>
      <header className={styles.propsHeader}>
        <button
          type="button"
          className={styles.propsClose}
          title="Deselect"
          aria-label="Close properties"
          onClick={() => setSelectedClipIds([])}
        >
          <CloseIcon size={14} />
        </button>
        <div className={styles.propsTitleBlock}>
          <div className={styles.propsTitleRow}>
            <strong className={styles.propsTitle} title={title}>
              {title}
            </strong>
            <span className={styles.propsEditIcon} aria-hidden>
              <PencilIcon />
            </span>
          </div>
        </div>
      </header>

      {isVisual ? (
            <Section title="Layer">
              <div className={styles.alignRow}>
                {edges.map((edge) => (
                  <button
                    key={edge}
                    type="button"
                    className={styles.alignBtn}
                    title={`Align ${edge}`}
                    onClick={() => align(edge)}
                  >
                    <AlignIcon kind={edge} />
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.alignBtn}
                  title="Distribute"
                  disabled
                >
                  <DistributeIcon />
                </button>
              </div>

              <div className={styles.layerRow}>
                <label className={styles.rotateField} title="Rotation degrees">
                  {transformDiamond("rotation")}
                  <input
                    type="number"
                    step={1}
                    value={Math.round(resolved.rotation)}
                    onChange={(e) =>
                      patchTransform({ rotation: Number(e.target.value) || 0 })
                    }
                  />
                  <span className={styles.unit}>°</span>
                  <ChevronDownIcon size={12} />
                </label>
                <div className={styles.flipGroup}>
                  <button
                    type="button"
                    className={styles.alignBtn}
                    title="Flip horizontal"
                    onClick={() =>
                      patchTransform({
                        scaleX: -(
                          (isText
                            ? selected.transform.scaleX
                            : geom?.scaleX ?? selected.transform.scaleX) || 1
                        ),
                      })
                    }
                  >
                    <FlipHIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.alignBtn}
                    title="Flip vertical"
                    onClick={() =>
                      patchTransform({
                        scaleY: -(
                          (isText
                            ? selected.transform.scaleY
                            : geom?.scaleY ?? selected.transform.scaleY) || 1
                        ),
                      })
                    }
                  >
                    <FlipVIcon />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {transformDiamond("opacity")}
                <div className="min-w-0 flex-1">
                  <OpacityBar
                    value={resolved.opacity}
                    onChange={(opacity) => patchTransform({ opacity })}
                  />
                </div>
              </div>

              <label className={styles.blendSelect} title="Blend mode">
                <select
                  value={normalizeBlendMode(selected.transform.blendMode)}
                  onChange={(e) =>
                    patchTransform({ blendMode: e.target.value as BlendMode })
                  }
                >
                  {BLEND_MODE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className={styles.propRow}>
                <span className={styles.propLabel}>Transform</span>
                <button
                  type="button"
                  className={styles.navBtnCompact}
                  aria-expanded={sizeOpen}
                  onClick={() => setSizeOpen((v) => !v)}
                >
                  Position &amp; Size
                  <ChevronRightIcon />
                </button>
              </div>

              {sizeOpen ? (
                <div className={styles.sizeBlock}>
                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span className="inline-flex items-center gap-0.5">
                        X{transformDiamond("x")}
                      </span>
                      <input
                        type="number"
                        value={Math.round(center.x)}
                        onChange={(e) =>
                          patchTransform({ x: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      <span className="inline-flex items-center gap-0.5">
                        Y{transformDiamond("y")}
                      </span>
                      <input
                        type="number"
                        value={Math.round(center.y)}
                        onChange={(e) =>
                          patchTransform({ y: Number(e.target.value) || 0 })
                        }
                      />
                    </label>
                  </div>
                  {!isText ? (
                    <div className={styles.row}>
                      <label className={styles.field}>
                        <span className="inline-flex items-center gap-0.5">
                          Scale X{transformDiamond("scaleX")}
                        </span>
                        <input
                          type="number"
                          min={0.02}
                          max={20}
                          step={0.01}
                          value={Number(Math.abs(geom?.scaleX ?? 1).toFixed(2))}
                          onChange={(e) => {
                            const mag = Math.max(0.02, Number(e.target.value) || 1);
                            const sign = (geom?.scaleX ?? 1) < 0 ? -1 : 1;
                            patchTransform({ scaleX: mag * sign });
                          }}
                        />
                      </label>
                      <label className={styles.field}>
                        <span className="inline-flex items-center gap-0.5">
                          Scale Y{transformDiamond("scaleY")}
                        </span>
                        <input
                          type="number"
                          min={0.02}
                          max={20}
                          step={0.01}
                          value={Number(Math.abs(geom?.scaleY ?? 1).toFixed(2))}
                          onChange={(e) => {
                            const mag = Math.max(0.02, Number(e.target.value) || 1);
                            const sign = (geom?.scaleY ?? 1) < 0 ? -1 : 1;
                            patchTransform({ scaleY: mag * sign });
                          }}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Section>
          ) : null}

          {isVisual && !isText ? (
            <Section title="Shape">
              <div className={styles.propRow}>
                <span className={styles.propLabel}>Shape</span>
                <button type="button" className={styles.navBtnCompact}>
                  Rectangle
                  <ChevronRightIcon />
                </button>
              </div>
              <StepperField
                label="Round Corners"
                value={roundCorners}
                display={`${roundCorners} px`}
                min={0}
                max={200}
                step={1}
                onChange={setRoundCorners}
              />
              <button
                type="button"
                className={styles.fullBtn}
                onClick={() => setStatusMessage("Path editing coming soon")}
              >
                Edit Path
              </button>
            </Section>
          ) : null}

          {isText ? (
            <>
              <Section title="Content">
                <textarea
                  className={styles.textarea}
                  rows={3}
                  value={text.content}
                  onChange={(e) => applyText({ ...text, content: e.target.value })}
                />
              </Section>
              <Section title="Font">
                <div className={styles.row}>
                  <select
                    className={styles.select}
                    value={text.fontFamily}
                    onChange={(e) => {
                      const opt = fontOptions.find((f) => f.family === e.target.value);
                      applyText({
                        ...text,
                        fontFamily: e.target.value,
                        fontPath: opt?.path ?? null,
                      });
                    }}
                  >
                    {fontOptions.map((font) => (
                      <option key={font.id} value={font.family}>
                        {font.family}
                        {font.source === "custom" ? " (custom)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => void handleBrowseFont()}
                  >
                    Browse…
                  </button>
                </div>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span>Size</span>
                    <input
                      type="number"
                      min={8}
                      max={400}
                      value={text.fontSize}
                      onChange={(e) =>
                        applyText({ ...text, fontSize: Number(e.target.value) || 64 })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Align</span>
                    <select
                      value={text.align}
                      onChange={(e) =>
                        applyText({
                          ...text,
                          align: e.target.value as TextStyle["align"],
                        })
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </div>
                <div className={styles.row}>
                  <label className={styles.field}>
                    <span>Weight · {text.fontWeight}</span>
                    <input
                      type="range"
                      min={100}
                      max={900}
                      step={50}
                      value={text.fontWeight}
                      onChange={(e) =>
                        applyText({ ...text, fontWeight: Number(e.target.value) || 700 })
                      }
                    />
                  </label>
                </div>
                <div className={styles.formatToggles}>
                  {(
                    [
                      {
                        key: "bold",
                        label: "B",
                        title: "Bold",
                        active: text.fontWeight >= 600,
                        onClick: () =>
                          applyText({
                            ...text,
                            fontWeight: text.fontWeight >= 600 ? 400 : 700,
                          }),
                      },
                      {
                        key: "italic",
                        label: "I",
                        title: "Italic",
                        active: text.italic,
                        onClick: () => applyText({ ...text, italic: !text.italic }),
                      },
                      {
                        key: "underline",
                        label: "U",
                        title: "Underline",
                        active: text.underline,
                        onClick: () => applyText({ ...text, underline: !text.underline }),
                      },
                      {
                        key: "strike",
                        label: "S",
                        title: "Strikethrough",
                        active: text.strikethrough,
                        onClick: () =>
                          applyText({ ...text, strikethrough: !text.strikethrough }),
                      },
                      {
                        key: "bullet",
                        label: "•",
                        title: "Bulleted list",
                        active: text.listStyle === "bullet",
                        onClick: () => applyText(withListStyle(text, "bullet")),
                      },
                      {
                        key: "number",
                        label: "1.",
                        title: "Numbered list",
                        active: text.listStyle === "number",
                        onClick: () => applyText(withListStyle(text, "number")),
                      },
                    ] as const
                  ).map((btn) => (
                    <button
                      key={btn.key}
                      type="button"
                      className={`${styles.formatToggle}${btn.active ? ` ${styles.formatToggleOn}` : ""}`}
                      title={btn.title}
                      aria-pressed={btn.active}
                      onClick={btn.onClick}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="Fill">
                <div className={styles.colorRow}>
                  <input
                    type="color"
                    value={text.color}
                    onChange={(e) => applyText({ ...text, color: e.target.value })}
                  />
                  <input
                    value={text.color}
                    onChange={(e) => applyText({ ...text, color: e.target.value })}
                  />
                </div>
              </Section>
              <Section title="Blend mode">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(
                    [
                      { id: "normal", label: "Normal" },
                      { id: "screen", label: "Screen" },
                      { id: "overlay", label: "Overlay" },
                      { id: "softLight", label: "Soft Light" },
                      { id: "colorDodge", label: "Color Dodge" },
                      { id: "difference", label: "Difference" },
                    ] as const
                  ).map((bm) => {
                    const active = normalizeBlendMode(selected.transform.blendMode) === bm.id;
                    return (
                      <button
                        key={bm.id}
                        type="button"
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors",
                          active
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : "bg-secondary/60 text-secondary-foreground hover:bg-secondary hover:text-foreground",
                        )}
                        onClick={() => patchTransform({ blendMode: bm.id })}
                      >
                        {bm.label}
                      </button>
                    );
                  })}
                </div>
                <label className={styles.blendSelect} title="All blend modes">
                  <select
                    value={normalizeBlendMode(selected.transform.blendMode)}
                    onChange={(e) =>
                      patchTransform({ blendMode: e.target.value as BlendMode })
                    }
                  >
                    {BLEND_MODE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </Section>
              <Section
                title="Background"
                action={
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() =>
                      applyText({
                        ...text,
                        backgroundColor: text.backgroundColor ? null : "#FFFFFF",
                      })
                    }
                  >
                    {text.backgroundColor ? "Remove" : "Add"}
                  </button>
                }
              >
                {text.backgroundColor ? (
                  <div className={styles.stack}>
                    <div className={styles.colorRow}>
                      <input
                        type="color"
                        value={
                          text.backgroundColor.startsWith("#") &&
                          text.backgroundColor.length >= 7
                            ? text.backgroundColor.slice(0, 7)
                            : "#FFFFFF"
                        }
                        onChange={(e) =>
                          applyText({ ...text, backgroundColor: e.target.value })
                        }
                      />
                      <input
                        value={text.backgroundColor}
                        onChange={(e) =>
                          applyText({
                            ...text,
                            backgroundColor: e.target.value || null,
                          })
                        }
                      />
                    </div>
                    <StepperField
                      label="Padding"
                      value={text.backgroundPadding}
                      display={`${Math.round(text.backgroundPadding)}px`}
                      min={0}
                      max={48}
                      step={1}
                      onChange={(backgroundPadding) =>
                        applyText({ ...text, backgroundPadding })
                      }
                    />
                    <StepperField
                      label="Radius"
                      value={text.backgroundRadius}
                      display={`${Math.round(text.backgroundRadius)}px`}
                      min={0}
                      max={40}
                      step={1}
                      onChange={(backgroundRadius) =>
                        applyText({ ...text, backgroundRadius })
                      }
                    />
                  </div>
                ) : null}
              </Section>
              <Section title="Text animation">
                {(() => {
                  const anim = normalizeTextAnimation(text.textAnimation ?? null);
                  const setAnim = (patch: Partial<typeof anim>) =>
                    applyText({
                      ...text,
                      textAnimation: { ...anim, ...patch },
                    });
                  return (
                    <div className={styles.stack}>
                      <div className={styles.row}>
                        <label className={styles.field}>
                          <span>Enter</span>
                          <select
                            value={anim.in}
                            onChange={(e) =>
                              setAnim({ in: e.target.value as TextAnimType })
                            }
                          >
                            {TEXT_ANIM_OPTIONS.map((o) => (
                              <option key={o.type} value={o.type}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={styles.field}>
                          <span>Exit</span>
                          <select
                            value={anim.out}
                            onChange={(e) =>
                              setAnim({ out: e.target.value as TextAnimType })
                            }
                          >
                            {TEXT_ANIM_OPTIONS.map((o) => (
                              <option key={o.type} value={o.type}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <StepperField
                        label="Enter duration"
                        value={anim.inDurationSec}
                        display={`${anim.inDurationSec.toFixed(1)}s`}
                        min={0}
                        max={5}
                        step={0.1}
                        onChange={(inDurationSec) => setAnim({ inDurationSec })}
                      />
                      <StepperField
                        label="Exit duration"
                        value={anim.outDurationSec}
                        display={`${anim.outDurationSec.toFixed(1)}s`}
                        min={0}
                        max={5}
                        step={0.1}
                        onChange={(outDurationSec) => setAnim({ outDurationSec })}
                      />
                      <StepperField
                        label="Fade in"
                        value={effects.fadeInSec}
                        display={`${effects.fadeInSec.toFixed(1)}s`}
                        min={0}
                        max={5}
                        step={0.1}
                        onChange={(fadeInSec) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, { fadeInSec }),
                          )
                        }
                      />
                      <StepperField
                        label="Fade out"
                        value={effects.fadeOutSec}
                        display={`${effects.fadeOutSec.toFixed(1)}s`}
                        min={0}
                        max={5}
                        step={0.1}
                        onChange={(fadeOutSec) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, { fadeOutSec }),
                          )
                        }
                      />
                    </div>
                  );
                })()}
              </Section>
            </>
          ) : null}

          {showEffects ? (
            <Section title="Fill">
              <div className={styles.fillRow}>
                <button
                  type="button"
                  className={`${styles.navBtn} ${!fillVisible ? styles.navBtnMuted : ""}`}
                >
                  <span className={styles.navBtnIcon}>
                    <PlayIcon size={14} />
                  </span>
                  <span className={styles.navBtnLabel}>{fillKind}</span>
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className={styles.iconToggle}
                  title={fillVisible ? "Hide fill" : "Show fill"}
                  aria-pressed={fillVisible}
                  onClick={() => setFillVisible((v) => !v)}
                >
                  {fillVisible ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                </button>
              </div>
            </Section>
          ) : null}

          {isVisual && !isText ? (
            <Section title="Stroke">
              <div className={styles.fillRow}>
                <button
                  type="button"
                  className={`${styles.colorNav} ${!strokeVisible ? styles.navBtnMuted : ""}`}
                  onClick={() => setStatusMessage("Stroke color coming soon")}
                >
                  <span
                    className={styles.colorSwatch}
                    style={{ background: "#ABABAB" }}
                    aria-hidden
                  />
                  <span className={styles.navBtnLabel}>#ABABAB</span>
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className={styles.iconToggle}
                  title={strokeVisible ? "Hide stroke" : "Show stroke"}
                  aria-pressed={strokeVisible}
                  onClick={() => setStrokeVisible((v) => !v)}
                >
                  {strokeVisible ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
                </button>
              </div>
            </Section>
          ) : null}

          {selected.linkedClipId ? (
            <Section title="Link">
              <label className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                <span>Link audio and video</span>
                <input
                  type="checkbox"
                  checked={selected.linkFollow !== false}
                  onChange={(e) =>
                    commitProjectChange((p) =>
                      setClipLinkLocked(p, selected.id, e.target.checked),
                    )
                  }
                />
              </label>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Cuts, trims, and moves follow both sides. Right-click Unlink to
                separate them. Alt-click edits one side.
              </p>
            </Section>
          ) : null}

          {showVolume ? (
            <Section title="Audio">
              <StepperField
                label="Volume"
                value={selected.volume}
                display={`${Math.round(selected.volume * 100)}%`}
                min={0}
                max={2}
                step={0.05}
                onChange={(volume) =>
                  commitProjectChange((p) => updateClipVolume(p, selected.id, volume))
                }
              />
            </Section>
          ) : null}

          {showEffects ? (
            <>
              <Section
                title="Transition in"
                action={
                  canTransition ? (
                    <span className={styles.pill}>{transitionDef(transition.type).label}</span>
                  ) : (
                    <span className={styles.pillMuted}>Needs previous</span>
                  )
                }
              >
                <PresetGrid
                  items={TRANSITION_ITEMS}
                  groups={TRANSITION_GROUPS}
                  value={transition.type}
                  onSelect={(id) => {
                    if (!canTransition && id !== "none") return;
                    commitProjectChange((p) =>
                      updateClipTransition(p, selected.id, {
                        type: id as TransitionType,
                        durationTicks:
                          id === "none"
                            ? transition.durationTicks
                            : Math.max(transition.durationTicks, 600_000),
                      }),
                    );
                  }}
                  footnote={
                    canTransition
                      ? undefined
                      : "Place another clip before this one to enable transitions."
                  }
                />
                {canTransition && transition.type !== "none" ? (
                  <StepperField
                    label="Duration"
                    value={transition.durationTicks / 1_000_000}
                    display={`${(transition.durationTicks / 1_000_000).toFixed(2)}s`}
                    min={0.1}
                    max={2}
                    step={0.05}
                    onChange={(sec) =>
                      commitProjectChange((p) =>
                        updateClipTransition(p, selected.id, {
                          durationTicks: Math.round(sec * 1_000_000),
                        }),
                      )
                    }
                  />
                ) : null}
              </Section>

              <Section
                title="Adjustment"
                action={
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() =>
                      commitProjectChange((p) => {
                        const cleared = updateClipEffects(p, selected.id, {
                          ...DEFAULT_CLIP_EFFECTS,
                        });
                        return setClipEffectKeyframes(cleared, selected.id, null);
                      })
                    }
                  >
                    Reset
                  </button>
                }
              >
                <div className={styles.stack}>
                  <StepperField
                    label="Brightness"
                    value={effects.brightness}
                    display={effects.brightness.toFixed(2)}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(brightness) => setParam("brightness", brightness)}
                    {...kfProps("brightness")}
                  />
                  <StepperField
                    label="Contrast"
                    value={effects.contrast}
                    display={effects.contrast.toFixed(2)}
                    min={0}
                    max={2}
                    step={0.05}
                    onChange={(contrast) => setParam("contrast", contrast)}
                    {...kfProps("contrast")}
                  />
                  <StepperField
                    label="Saturation"
                    value={effects.saturation}
                    display={effects.saturation.toFixed(2)}
                    min={0}
                    max={3}
                    step={0.05}
                    onChange={(saturation) => setParam("saturation", saturation)}
                    {...kfProps("saturation")}
                  />
                  <StepperField
                    label="Blur"
                    value={effects.blur}
                    display={`${effects.blur.toFixed(1)}px`}
                    min={0}
                    max={20}
                    step={0.5}
                    onChange={(blur) => setParam("blur", blur)}
                    {...kfProps("blur")}
                  />
                  <StepperField
                    label="Vignette"
                    value={Math.round(effects.vignette * 100)}
                    display={`${Math.round(effects.vignette * 100)}`}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(pct) => setParam("vignette", pct / 100)}
                    {...kfProps("vignette")}
                  />
                  <StepperField
                    label="Sharpen"
                    value={Math.round(effects.sharpen * 50)}
                    display={`${Math.round(effects.sharpen * 50)}`}
                    min={0}
                    max={100}
                    step={5}
                    onChange={(pct) => setParam("sharpen", pct / 50)}
                    {...kfProps("sharpen")}
                  />
                  <StepperField
                    label="Zoom"
                    value={Math.round(effects.zoom * 100)}
                    display={
                      effects.zoom <= 0.0001
                        ? "Off"
                        : `${Math.round(effects.zoom * 100)}%`
                    }
                    min={0}
                    max={50}
                    step={1}
                    onChange={(pct) => setParam("zoom", pct / 100)}
                    {...kfProps("zoom")}
                  />
                  {effects.zoom > 0.0001 ||
                  paramHasKeyframes(selected.effectKeyframes, "zoom") ? (
                    <StepperField
                      label="Zoom pulse"
                      value={effects.zoomFrames}
                      display={
                        effects.zoomFrames <= 0
                          ? "Steady"
                          : `${effects.zoomFrames}f`
                      }
                      min={0}
                      max={60}
                      step={1}
                      onChange={(zoomFrames) =>
                        commitProjectChange((p) =>
                          updateClipEffects(p, selected.id, {
                            zoomFrames: Math.round(zoomFrames),
                          }),
                        )
                      }
                    />
                  ) : null}
                  <StepperField
                    label="Shake"
                    value={Math.round(effects.shake * 100)}
                    display={
                      effects.shake <= 0.0001
                        ? "Off"
                        : `${Math.round(effects.shake * 100)}%`
                    }
                    min={0}
                    max={20}
                    step={1}
                    onChange={(pct) => setParam("shake", pct / 100)}
                    {...kfProps("shake")}
                  />
                  {effects.shake > 0.0001 ||
                  paramHasKeyframes(selected.effectKeyframes, "shake") ? (
                    <>
                      <StepperField
                        label="Shake speed"
                        value={Math.round(effects.shakeSpeed)}
                        display={`${Math.round(effects.shakeSpeed)}Hz`}
                        min={1}
                        max={30}
                        step={1}
                        onChange={(shakeSpeed) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, {
                              shakeSpeed: Math.round(shakeSpeed),
                            }),
                          )
                        }
                      />
                      <StepperField
                        label="Shake rotation"
                        value={Math.round(effects.shakeRotation)}
                        display={
                          effects.shakeRotation <= 0
                            ? "Off"
                            : `${Math.round(effects.shakeRotation)}°`
                        }
                        min={0}
                        max={15}
                        step={1}
                        onChange={(shakeRotation) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, {
                              shakeRotation: Math.round(shakeRotation),
                            }),
                          )
                        }
                      />
                      <div className="rounded-xl border border-border/70 bg-secondary/25 p-2.5">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Shake curve
                          </span>
                          <button
                            type="button"
                            className="rounded-md border border-border/70 bg-background/60 px-2 py-1 text-[10px] font-semibold text-foreground transition-colors hover:bg-accent"
                            onClick={toggleShakeKeyframe}
                          >
                            {shakeKeyframeHere
                              ? "Remove keyframe"
                              : "Add keyframe"}
                          </button>
                        </div>
                        <EffectCurveGraph
                          points={shakeTrack?.points ?? []}
                          easing={shakeEasing}
                          fallback={effects.shake}
                          progress={clipProgress}
                          editable
                          valueMin={0}
                          valueMax={0.2}
                          onCommitPoints={commitShakePoints}
                          onAddPoint={addShakePoint}
                          onRemovePoint={removeShakePoint}
                        />
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {shakeTrack?.points.length
                              ? `${shakeTrack.points.length} keyframes · drag points`
                              : "Double-click graph to add a keyframe"}
                          </span>
                          <EasingPicker
                            current={shakeEasing}
                            label="Shake"
                            disabled={!shakeTrack?.points.length}
                            onSelect={(easing) =>
                              commitProjectChange((p) =>
                                setEffectKeyframeEasing(
                                  p,
                                  selected.id,
                                  "shake",
                                  easing,
                                ),
                              )
                            }
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                  <StepperField
                    label="Strobe"
                    value={effects.strobeFrames}
                    display={
                      effects.strobeFrames <= 0
                        ? "Off"
                        : `1/${effects.strobeFrames}f`
                    }
                    min={0}
                    max={30}
                    step={1}
                    onChange={(strobeFrames) =>
                      setParam("strobeFrames", Math.round(strobeFrames))
                    }
                    {...kfProps("strobeFrames")}
                  />
                  {effects.strobeFrames > 0 ||
                  paramHasKeyframes(selected.effectKeyframes, "strobeFrames") ? (
                    <div className={styles.colorRow}>
                      <span className={styles.propLabel}>Flash</span>
                      <input
                        type="color"
                        value={effects.strobeColor}
                        onChange={(e) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, {
                              strobeColor: e.target.value,
                            }),
                          )
                        }
                      />
                      <input
                        value={effects.strobeColor}
                        onChange={(e) =>
                          commitProjectChange((p) =>
                            updateClipEffects(p, selected.id, {
                              strobeColor: e.target.value,
                            }),
                          )
                        }
                      />
                    </div>
                  ) : null}
                  {(selected.effectKeyframes?.tracks ?? []).some(
                    (track) =>
                      track.param !== "shake" && track.points.length > 0,
                  ) ? (
                    <div className="mt-1 space-y-2 rounded-lg border border-border/70 bg-secondary/25 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Other curves
                      </div>
                      {(selected.effectKeyframes?.tracks ?? [])
                        .filter(
                          (track) =>
                            track.param !== "shake" && track.points.length > 0,
                        )
                        .map((track) => {
                          const current =
                            track.easing ??
                            (track.param === "zoom" ? "linear" : "hold");
                          return (
                            <div
                              key={track.param}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {EFFECT_PARAM_LABELS[track.param] ?? track.param}
                              </span>
                              <EasingPicker
                                current={current}
                                label={
                                  EFFECT_PARAM_LABELS[track.param] ?? track.param
                                }
                                onSelect={(easing) =>
                                  commitProjectChange((p) =>
                                    setEffectKeyframeEasing(
                                      p,
                                      selected.id,
                                      track.param,
                                      easing,
                                    ),
                                  )
                                }
                              />
                            </div>
                          );
                        })}
                    </div>
                  ) : null}
                  <StepperField
                    label="Fade in"
                    value={effects.fadeInSec}
                    display={`${effects.fadeInSec.toFixed(1)}s`}
                    min={0}
                    max={5}
                    step={0.1}
                    onChange={(fadeInSec) =>
                      commitProjectChange((p) =>
                        updateClipEffects(p, selected.id, { fadeInSec }),
                      )
                    }
                  />
                  <StepperField
                    label="Fade out"
                    value={effects.fadeOutSec}
                    display={`${effects.fadeOutSec.toFixed(1)}s`}
                    min={0}
                    max={5}
                    step={0.1}
                    onChange={(fadeOutSec) =>
                      commitProjectChange((p) =>
                        updateClipEffects(p, selected.id, { fadeOutSec }),
                      )
                    }
                  />
                </div>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={effects.grayscale}
                    onChange={(e) => setParam("grayscale", e.target.checked ? 1 : 0)}
                  />
                  <span>Grayscale</span>
                  <button
                    type="button"
                    className="ml-auto text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                    title="Toggle grayscale keyframe at playhead"
                    onClick={() =>
                      commitProjectChange((p) =>
                        toggleEffectKeyframeAtPlayhead(
                          p,
                          selected.id,
                          "grayscale",
                          playheadTicks,
                        ),
                      )
                    }
                  >
                    {paramHasKeyframes(selected.effectKeyframes, "grayscale") ? "◇ on" : "◇"}
                  </button>
                </label>
              </Section>
            </>
          ) : null}
    </div>
  );
}
