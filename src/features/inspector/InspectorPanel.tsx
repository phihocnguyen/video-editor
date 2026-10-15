import {
  addTextClip,
  createDefaultTextStyle,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
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

  function handleAddText() {
    let createdId = "";
    commitProjectChange((project) => {
      const next = addTextClip(project, {
        startTicks: useEditorUiStore.getState().playheadTicks,
        text: createDefaultTextStyle("Title text"),
      });
      createdId = next.clips[next.clips.length - 1]?.id ?? "";
      return next;
    });
    if (createdId) setSelectedClipIds([createdId]);
    setStatusMessage("Text clip added");
  }

  return (
    <div className={styles.panel}>
      <div className={styles.headerRow}>
        <h2>Text</h2>
        <button type="button" className={styles.primary} onClick={handleAddText}>
          + Add text
        </button>
      </div>
      <p className={styles.hint}>
        Add a title on the timeline. Select it to edit style, position, and opacity in the
        properties panel on the right.
      </p>
    </div>
  );
}
