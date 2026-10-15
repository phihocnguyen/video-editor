import { useMemo, useState, type ReactNode } from "react";
import {
  createDefaultTextStyle,
  mediaGeometry,
  mediaCenter,
  normalizeClipEffects,
  normalizeClipTransition,
  DEFAULT_CLIP_EFFECTS,
  findPreviousClipOnTrack,
  TRANSITION_DEFS,
  TRANSITION_GROUPS,
  transitionDef,
  updateClipEffects,
  updateClipSpeed,
  updateClipText,
  updateClipTransform,
  updateClipTransition,
  updateClipVolume,
  applySpeedToRange,
  clipDurationTicks,
  type Clip,
  type TextStyle,
  type TransitionType,
} from "../../domain";
import {
  listFontOptions,
  pickBrowserFontFile,
  registerCustomFontFile,
} from "../../lib/fonts";
import { isTauriRuntime } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { CloseIcon } from "../../components/icons";
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

type AlignEdge = "left" | "centerH" | "right" | "top" | "middle" | "bottom";

function SliderField({
  label,
  title,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className={styles.sliderField} title={title}>
      <div className={styles.sliderHead}>
        <span>{label}</span>
        <span className={styles.sliderValue}>{display ?? value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
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

/** Selection-driven CapCut-style properties column (right of preview). */
export function PropertiesPanel() {
  const project = useProjectStore((s) => s.project);
  const clips = project.clips;
  const assets = project.assets;
  const canvas = project.canvas;
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const markInTicks = useEditorUiStore((s) => s.markInTicks);
  const markOutTicks = useEditorUiStore((s) => s.markOutTicks);
  const [fontOptions, setFontOptions] = useState(() => listFontOptions());
  const [sizeOpen, setSizeOpen] = useState(true);

  const clip = useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    return clips.find((c) => c.id === id) ?? null;
  }, [clips, selectedClipIds]);

  if (!clip) return null;

  const selected = clip;
  const asset =
    (selected.assetId ? assets.find((a) => a.id === selected.assetId) : null) ?? null;
  const isText = selected.kind === "text";
  const isAudio = !isText && asset?.kind === "audio";
  const isVisual = isText || (!isAudio && selected.kind === "media");
  const showVolume = selected.kind === "media" && Boolean(asset?.hasAudio || isAudio);
  const showSpeed = selected.kind === "media";
  const showEffects = selected.kind === "media" && !isAudio;
  const effects = normalizeClipEffects(selected.effects);
  const transition = normalizeClipTransition(selected.transitionIn);
  const prev = findPreviousClipOnTrack(project, selected.id);
  const canTransition = showEffects && Boolean(prev);
  const text = selected.text ?? createDefaultTextStyle();
  const title = isText
    ? text.content.trim() || "Text"
    : asset?.name ?? "Clip";
  const kindLabel = isText ? "Text" : asset?.kind ?? "media";

  const geom = isVisual && !isText
    ? mediaGeometry(selected.transform, canvas.width, canvas.height, asset)
    : null;
  const center = isText
    ? { x: selected.transform.x, y: selected.transform.y }
    : mediaCenter(selected.transform, canvas.width, canvas.height);

  function patchTransform(patch: Partial<Clip["transform"]>) {
    commitProjectChange((p) =>
      updateClipTransform(p, selected.id, { ...selected.transform, ...patch }),
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
        const selected = await open({
          multiple: false,
          filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
        });
        if (typeof selected !== "string") return;
        const name = selected.split(/[/\\]/).pop() ?? "Custom Font";
        const family = name.replace(/\.(ttf|otf|woff2?)$/i, "");
        const option = {
          id: `custom-${crypto.randomUUID()}`,
          family,
          path: selected,
          source: "custom" as const,
        };
        setFontOptions((prev) => [...prev, option]);
        applyText({ ...text, fontFamily: family, fontPath: selected });
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

  const clipEnd = selected.startTicks + clipDurationTicks(selected);
  const rangeReady =
    markInTicks != null &&
    markOutTicks != null &&
    markOutTicks > markInTicks &&
    markInTicks < clipEnd &&
    markOutTicks > selected.startTicks;

  function applyRangeSpeed(speed: number) {
    if (!rangeReady || markInTicks == null || markOutTicks == null) {
      setStatusMessage("Set Mark In (I) and Mark Out (O) on the portion to retime");
      return;
    }
    try {
      let midId = selected.id;
      commitProjectChange((p) => {
        const result = applySpeedToRange(
          p,
          selected.id,
          markInTicks,
          markOutTicks,
          speed,
        );
        midId = result.midClipId;
        return result.project;
      });
      setSelectedClipIds([midId]);
      setStatusMessage(`Speed ${speed}× on marked range`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Could not apply speed range",
      );
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
          <strong className={styles.propsTitle} title={title}>
            {title}
          </strong>
          <span className={styles.propsKind}>{kindLabel}</span>
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
          </div>

          <div className={styles.layerRow}>
            <label className={styles.compactField} title="Rotation degrees">
              <span>Rotate</span>
              <input
                type="number"
                step={1}
                value={Math.round(selected.transform.rotation)}
                onChange={(e) =>
                  patchTransform({ rotation: Number(e.target.value) || 0 })
                }
              />
              <span className={styles.unit}>°</span>
            </label>
            {!isText ? (
              <div className={styles.flipGroup}>
                <button
                  type="button"
                  className={styles.alignBtn}
                  title="Flip horizontal"
                  onClick={() =>
                    patchTransform({
                      scaleX: -(geom?.scaleX ?? (selected.transform.scaleX || 1)),
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
                      scaleY: -(geom?.scaleY ?? (selected.transform.scaleY || 1)),
                    })
                  }
                >
                  <FlipVIcon />
                </button>
              </div>
            ) : null}
          </div>

          <SliderField
            label="Opacity"
            title="Layer opacity"
            min={0}
            max={1}
            step={0.01}
            value={selected.transform.opacity}
            display={`${Math.round(selected.transform.opacity * 100)}`}
            onChange={(opacity) => patchTransform({ opacity })}
          />
        </Section>
      ) : null}

      {isVisual ? (
        <Section
          title="Position & size"
          action={
            <button
              type="button"
              className={styles.chevronBtn}
              aria-expanded={sizeOpen}
              onClick={() => setSizeOpen((v) => !v)}
            >
              {sizeOpen ? "−" : "+"}
            </button>
          }
        >
          {sizeOpen ? (
            <>
              <div className={styles.row}>
                <label className={styles.field}>
                  <span>X</span>
                  <input
                    type="number"
                    value={Math.round(center.x)}
                    onChange={(e) =>
                      patchTransform({ x: Number(e.target.value) || 0 })
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span>Y</span>
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
                    <span>Scale X</span>
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
                    <span>Scale Y</span>
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
            </>
          ) : null}
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
        </>
      ) : null}

      {showEffects ? (
        <Section title="Fill">
          <div className={styles.fillChip}>
            <span className={styles.fillDot} aria-hidden />
            <span>{asset?.kind === "image" ? "Image" : "Video"}</span>
          </div>
        </Section>
      ) : null}

      {showVolume || showSpeed ? (
        <Section title="Basic">
          <div className={styles.stack}>
            {showVolume ? (
              <SliderField
                label="Volume"
                title="Clip audio gain"
                min={0}
                max={2}
                step={0.01}
                value={selected.volume}
                display={`${Math.round(selected.volume * 100)}%`}
                onChange={(volume) =>
                  commitProjectChange((p) => updateClipVolume(p, selected.id, volume))
                }
              />
            ) : null}
            {showSpeed ? (
              <>
                <SliderField
                  label="Speed"
                  title="Constant speed for the whole clip"
                  min={0.1}
                  max={4}
                  step={0.05}
                  value={selected.speed}
                  display={`${selected.speed.toFixed(2)}×`}
                  onChange={(speed) => {
                    if (!(speed > 0)) return;
                    commitProjectChange((p) => updateClipSpeed(p, selected.id, speed));
                  }}
                />
                <div className={styles.chipRow}>
                  {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={
                        Math.abs(selected.speed - s) < 0.001
                          ? styles.chipActive
                          : styles.chip
                      }
                      onClick={() =>
                        commitProjectChange((p) => updateClipSpeed(p, selected.id, s))
                      }
                    >
                      {s}×
                    </button>
                  ))}
                </div>
                <div className={styles.blockHead}>
                  <label className={styles.label}>Speed on range</label>
                  <span className={rangeReady ? styles.pill : styles.pillMuted}>
                    {rangeReady ? "In/Out ready" : "Mark In/Out"}
                  </span>
                </div>
                <div className={styles.chipRow}>
                  {[0.25, 0.5, 1.5, 2, 4].map((s) => (
                    <button
                      key={`r-${s}`}
                      type="button"
                      className={styles.chip}
                      disabled={!rangeReady}
                      onClick={() => applyRangeSpeed(s)}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
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
              <SliderField
                label="Duration"
                title="Transition length"
                min={0.1}
                max={2}
                step={0.05}
                value={transition.durationTicks / 1_000_000}
                display={`${(transition.durationTicks / 1_000_000).toFixed(2)}s`}
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
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { ...DEFAULT_CLIP_EFFECTS }),
                  )
                }
              >
                Reset
              </button>
            }
          >
            <div className={styles.stack}>
              <SliderField
                label="Brightness"
                title="1 = original"
                min={0}
                max={2}
                step={0.01}
                value={effects.brightness}
                onChange={(brightness) =>
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { brightness }),
                  )
                }
              />
              <SliderField
                label="Contrast"
                title="1 = original"
                min={0}
                max={2}
                step={0.01}
                value={effects.contrast}
                onChange={(contrast) =>
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { contrast }),
                  )
                }
              />
              <SliderField
                label="Saturation"
                title="1 = original"
                min={0}
                max={3}
                step={0.01}
                value={effects.saturation}
                onChange={(saturation) =>
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { saturation }),
                  )
                }
              />
              <SliderField
                label="Blur"
                title="Blur radius"
                min={0}
                max={20}
                step={0.5}
                value={effects.blur}
                display={`${effects.blur.toFixed(1)}px`}
                onChange={(blur) =>
                  commitProjectChange((p) => updateClipEffects(p, selected.id, { blur }))
                }
              />
              <SliderField
                label="Fade in"
                title="Seconds from clip start"
                min={0}
                max={5}
                step={0.1}
                value={effects.fadeInSec}
                display={`${effects.fadeInSec.toFixed(1)}s`}
                onChange={(fadeInSec) =>
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { fadeInSec }),
                  )
                }
              />
              <SliderField
                label="Fade out"
                title="Seconds to clip end"
                min={0}
                max={5}
                step={0.1}
                value={effects.fadeOutSec}
                display={`${effects.fadeOutSec.toFixed(1)}s`}
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
                onChange={(e) =>
                  commitProjectChange((p) =>
                    updateClipEffects(p, selected.id, { grayscale: e.target.checked }),
                  )
                }
              />
              <span>Grayscale</span>
            </label>
          </Section>
        </>
      ) : null}
    </div>
  );
}
