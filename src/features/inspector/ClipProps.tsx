import {
  applySpeedToRange,
  clipDurationTicks,
  DEFAULT_CLIP_EFFECTS,
  findPreviousClipOnTrack,
  normalizeClipEffects,
  normalizeClipTransition,
  TRANSITION_OPTIONS,
  updateClipEffects,
  updateClipSpeed,
  updateClipTransform,
  updateClipTransition,
  updateClipVolume,
  type Clip,
  type TransitionType,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./InspectorPanel.module.css";

interface ClipPropsProps {
  clip: Clip;
}

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

export function ClipProps({ clip }: ClipPropsProps) {
  const project = useProjectStore((s) => s.project);
  const assets = project.assets;
  const asset = assets.find((a) => a.id === clip.assetId);
  const markInTicks = useEditorUiStore((s) => s.markInTicks);
  const markOutTicks = useEditorUiStore((s) => s.markOutTicks);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const showVolume = clip.kind === "media" && Boolean(asset?.hasAudio);
  const showSpeed = clip.kind === "media";
  const showEffects = clip.kind === "media" && asset?.kind !== "audio";
  const effects = normalizeClipEffects(clip.effects);
  const transition = normalizeClipTransition(clip.transitionIn);
  const prev = findPreviousClipOnTrack(project, clip.id);
  const canTransition = showEffects && Boolean(prev);

  const clipEnd = clip.startTicks + clipDurationTicks(clip);
  const rangeReady =
    markInTicks != null &&
    markOutTicks != null &&
    markOutTicks > markInTicks &&
    markInTicks < clipEnd &&
    markOutTicks > clip.startTicks;

  function applyRangeSpeed(speed: number) {
    if (!rangeReady || markInTicks == null || markOutTicks == null) {
      setStatusMessage("Set Mark In (I) and Mark Out (O) on the portion to retime");
      return;
    }
    try {
      let midId = clip.id;
      commitProjectChange((p) => {
        const result = applySpeedToRange(
          p,
          clip.id,
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

  return (
    <div className={styles.section}>
      <div className={styles.clipTitle}>
        <strong>{clip.kind === "text" ? "Text" : asset?.name ?? "Clip"}</strong>
        <span>{clip.kind === "text" ? "Text clip" : asset?.kind ?? "media"}</span>
      </div>

      <div className={styles.stack}>
        <SliderField
          label="Opacity"
          title="How transparent the clip appears"
          min={0}
          max={1}
          step={0.01}
          value={clip.transform.opacity}
          onChange={(opacity) =>
            commitProjectChange((p) =>
              updateClipTransform(p, clip.id, { ...clip.transform, opacity }),
            )
          }
        />
        {showVolume ? (
          <SliderField
            label="Volume"
            title="Clip audio gain"
            min={0}
            max={2}
            step={0.01}
            value={clip.volume}
            onChange={(volume) =>
              commitProjectChange((p) => updateClipVolume(p, clip.id, volume))
            }
          />
        ) : null}
        {showSpeed ? (
          <>
            <SliderField
              label="Clip speed"
              title="Constant speed for the whole clip (timeline length = source / speed)"
              min={0.1}
              max={4}
              step={0.05}
              value={clip.speed}
              display={`${clip.speed.toFixed(2)}×`}
              onChange={(speed) => {
                if (!(speed > 0)) return;
                commitProjectChange((p) => updateClipSpeed(p, clip.id, speed));
              }}
            />
            <div className={styles.chipRow}>
              {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  className={
                    Math.abs(clip.speed - s) < 0.001
                      ? `${styles.chip} ${styles.chipActive}`
                      : styles.chip
                  }
                  title={`Whole clip → ${s}×`}
                  onClick={() =>
                    commitProjectChange((p) => updateClipSpeed(p, clip.id, s))
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
            <p className={styles.hint}>
              Premiere-style: set <strong>I</strong>/<strong>O</strong> on the
              portion to slow-mo or speed up, then pick a rate. Splits the clip
              and retimes only that segment.
            </p>
            <div className={styles.chipRow}>
              {[0.25, 0.5, 1.5, 2, 4].map((s) => (
                <button
                  key={`r-${s}`}
                  type="button"
                  className={styles.chip}
                  disabled={!rangeReady}
                  title={
                    rangeReady
                      ? `Apply ${s}× between Mark In and Out`
                      : "Set Mark In (I) and Mark Out (O) first"
                  }
                  onClick={() => applyRangeSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {showEffects ? (
        <>
          <div className={styles.blockHead}>
            <label className={styles.label}>Transition in</label>
            {!canTransition ? (
              <span className={styles.pillMuted}>Needs previous clip</span>
            ) : (
              <span className={styles.pill}>
                {TRANSITION_OPTIONS.find((o) => o.type === transition.type)?.label ?? "Cut"}
              </span>
            )}
          </div>
          <div className={styles.chipRow}>
            {TRANSITION_OPTIONS.map((opt) => {
              const active = transition.type === opt.type;
              return (
                <button
                  key={opt.type}
                  type="button"
                  className={active ? styles.chipActive : styles.chip}
                  title={
                    canTransition || opt.type === "none"
                      ? opt.hint
                      : "Place another clip before this one"
                  }
                  disabled={!canTransition && opt.type !== "none"}
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateClipTransition(p, clip.id, {
                        type: opt.type as TransitionType,
                        durationTicks:
                          opt.type === "none"
                            ? transition.durationTicks
                            : Math.max(transition.durationTicks, 600_000),
                      }),
                    )
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
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
                  updateClipTransition(p, clip.id, {
                    durationTicks: Math.round(sec * 1_000_000),
                  }),
                )
              }
            />
          ) : null}

          <div className={styles.blockHead}>
            <label className={styles.label}>Effects</label>
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() =>
                commitProjectChange((p) =>
                  updateClipEffects(p, clip.id, { ...DEFAULT_CLIP_EFFECTS }),
                )
              }
            >
              Reset
            </button>
          </div>
          <div className={styles.stack}>
            <SliderField
              label="Brightness"
              title="1 = original"
              min={0}
              max={2}
              step={0.01}
              value={effects.brightness}
              onChange={(brightness) =>
                commitProjectChange((p) => updateClipEffects(p, clip.id, { brightness }))
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
                commitProjectChange((p) => updateClipEffects(p, clip.id, { contrast }))
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
                commitProjectChange((p) => updateClipEffects(p, clip.id, { saturation }))
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
                commitProjectChange((p) => updateClipEffects(p, clip.id, { blur }))
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
                commitProjectChange((p) => updateClipEffects(p, clip.id, { fadeInSec }))
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
                commitProjectChange((p) => updateClipEffects(p, clip.id, { fadeOutSec }))
              }
            />
          </div>
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={effects.grayscale}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateClipEffects(p, clip.id, { grayscale: e.target.checked }),
                )
              }
            />
            <span>Grayscale</span>
          </label>
        </>
      ) : null}
    </div>
  );
}
