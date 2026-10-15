import {
  addTextClip,
  createDefaultTextStyle,
  normalizeTextAnimation,
  normalizeTextStyle,
  updateClipText,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { TextEffectThumb } from "../effects/TextEffectThumb";
import { TEXT_EFFECT_PRESETS } from "../library/presets";
import styles from "./InspectorPanel.module.css";

interface InspectorPanelProps {
  mode: "text" | "subtitles";
}

/** Left-rail library panels (add / apply text looks). Clip props live in PropertiesPanel. */
export function InspectorPanel({ mode }: InspectorPanelProps) {
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const project = useProjectStore((s) => s.project);

  const selectedTextId =
    selectedClipIds.length === 1 ? selectedClipIds[0]! : null;
  const selectedText = selectedTextId
    ? project.clips.find((c) => c.id === selectedTextId && c.kind === "text")
    : null;

  if (mode === "subtitles") {
    return (
      <div className={styles.panel}>
        <h2>Subtitles</h2>
        <p className={styles.hint}>
          Use Text for titles. Dedicated subtitle track comes later.
        </p>
      </div>
    );
  }

  function handlePreset(preset: (typeof TEXT_EFFECT_PRESETS)[number]) {
    if (selectedText && selectedTextId) {
      const current = normalizeTextStyle(selectedText.text);
      const content = current.content.trim()
        ? current.content
        : preset.text.content;
      commitProjectChange((p) =>
        updateClipText(
          p,
          selectedTextId,
          normalizeTextStyle({
            ...createDefaultTextStyle(content),
            ...preset.text,
            content,
            textAnimation: normalizeTextAnimation(
              preset.text.textAnimation ?? null,
            ),
          }),
        ),
      );
      setStatusMessage(`Applied · ${preset.label}`);
      return;
    }

    let createdId = "";
    commitProjectChange((p) => {
      const next = addTextClip(p, {
        startTicks: useEditorUiStore.getState().playheadTicks,
        text: {
          ...createDefaultTextStyle(preset.text.content),
          ...preset.text,
          textAnimation: normalizeTextAnimation(
            preset.text.textAnimation ?? null,
          ),
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
        {selectedText
          ? "Click a look to apply it to the selected text."
          : "Click a look to add title text at the playhead."}
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
              onClick={() => handlePreset(preset)}
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
