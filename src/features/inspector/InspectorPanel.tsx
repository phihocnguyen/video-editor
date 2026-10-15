import {
  addTextClip,
  createDefaultTextStyle,
  normalizeTextAnimation,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { TextEffectThumb } from "../effects/TextEffectThumb";
import { TEXT_EFFECT_PRESETS } from "../library/presets";
import styles from "./InspectorPanel.module.css";

interface InspectorPanelProps {
  mode: "text" | "subtitles";
}

/** Left-rail library panels (add text / stubs). Clip props live in PropertiesPanel. */
export function InspectorPanel({ mode }: InspectorPanelProps) {
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

  if (mode === "subtitles") {
    return (
      <div className={styles.panel}>
        <h2>Subtitles</h2>
        <p className={styles.hint}>Use Text for titles. Dedicated subtitle track comes later.</p>
      </div>
    );
  }

  function handleAddPreset(preset: (typeof TEXT_EFFECT_PRESETS)[number]) {
    let createdId = "";
    commitProjectChange((project) => {
      const next = addTextClip(project, {
        startTicks: useEditorUiStore.getState().playheadTicks,
        text: {
          ...createDefaultTextStyle(preset.text.content),
          ...preset.text,
          textAnimation: normalizeTextAnimation(preset.text.textAnimation ?? null),
        },
      });
      createdId = next.clips[next.clips.length - 1]?.id ?? "";
      return next;
    });
    if (createdId) setSelectedClipIds([createdId]);
    setStatusMessage(`Added · ${preset.label}`);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <h2>Text</h2>
      </div>
      <p className={styles.hint}>
        Click a look to add title text at the playhead. Edit style and animation in Properties.
      </p>
      <div className={styles.filterGrid}>
        {TEXT_EFFECT_PRESETS.map((preset) => {
          const anim = normalizeTextAnimation(preset.text.textAnimation ?? null);
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              className={styles.filterBtn}
              onClick={() => handleAddPreset(preset)}
            >
              <TextEffectThumb
                label={preset.text.content}
                color={preset.text.color ?? "#FFE566"}
                swatch={preset.swatch}
                animIn={anim.in}
              />
              <span className={styles.filterLabel}>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
