import { useMemo, useState } from "react";
import {
  addTextClip,
  createDefaultTextStyle,
  updateClipText,
  updateClipTransform,
  type TextStyle,
} from "../../domain";
import {
  listFontOptions,
  pickBrowserFontFile,
  registerCustomFontFile,
} from "../../lib/fonts";
import { isTauriRuntime } from "../../lib/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { ClipProps } from "./ClipProps";
import styles from "./InspectorPanel.module.css";

interface InspectorPanelProps {
  mode: "text" | "canvas" | "clip" | "subtitles";
}

export function InspectorPanel({ mode }: InspectorPanelProps) {
  const canvas = useProjectStore((s) => s.project.canvas);
  const clips = useProjectStore((s) => s.project.clips);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [fontOptions, setFontOptions] = useState(() => listFontOptions());

  const selectedTextClip = useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    const clip = clips.find((c) => c.id === id && c.kind === "text");
    return clip ?? null;
  }, [clips, selectedClipIds]);

  const selectedClip = useMemo(() => {
    const id = selectedClipIds[0];
    if (!id) return null;
    return clips.find((c) => c.id === id) ?? null;
  }, [clips, selectedClipIds]);

  if (mode === "clip") {
    return (
      <div className={styles.panel}>
        <h2>Clip</h2>
        {!selectedClip ? (
          <p className={styles.hint}>
            Select a video or image clip on the timeline to edit opacity, speed, and effects.
          </p>
        ) : selectedClip.kind === "text" ? (
          <p className={styles.hint}>
            Text clips use the Text panel. Switch to Text or pick a media clip for effects.
          </p>
        ) : (
          <ClipProps clip={selectedClip} />
        )}
      </div>
    );
  }

  if (mode === "canvas") {
    return (
      <div className={styles.panel}>
        <h2>Canvas</h2>
        <div className={styles.section}>
          <label className={styles.label}>Size</label>
          <div className={styles.row}>
            <Field label="W" value={String(canvas.width)} readOnly />
            <Field label="H" value={String(canvas.height)} readOnly />
          </div>
          <label className={styles.label}>Frame rate</label>
          <Field label="FPS" value={String(canvas.frameRate)} readOnly />
        </div>
        {selectedClip ? <ClipProps clip={selectedClip} /> : null}
      </div>
    );
  }

  if (mode === "subtitles") {
    return (
      <div className={styles.panel}>
        <h2>Subtitles</h2>
        <p className={styles.hint}>Use Text for titles. Dedicated subtitle track comes later.</p>
      </div>
    );
  }

  const text = selectedTextClip?.text ?? createDefaultTextStyle();

  function applyText(next: TextStyle) {
    if (!selectedTextClip) return;
    commitProjectChange((project) => updateClipText(project, selectedTextClip.id, next));
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

      {!selectedTextClip ? (
        <p className={styles.hint}>Add text or select a text clip on the timeline.</p>
      ) : (
        <>
          <ClipProps clip={selectedTextClip} />
          <div className={styles.section}>
            <label className={styles.label}>Content</label>
            <textarea
              className={styles.textarea}
              rows={3}
              value={text.content}
              onChange={(e) => applyText({ ...text, content: e.target.value })}
            />
          </div>

          <div className={styles.section}>
            <label className={styles.label}>Font</label>
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
              <button type="button" className={styles.secondary} onClick={() => void handleBrowseFont()}>
                Browse…
              </button>
            </div>
            <div className={styles.row}>
              <label className={styles.field}>
                <span>Px</span>
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
          </div>

          <div className={styles.section}>
            <label className={styles.label}>Fill</label>
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
          </div>

          <div className={styles.section}>
            <label className={styles.label}>Position</label>
            <div className={styles.row}>
              <label className={styles.field}>
                <span>X</span>
                <input
                  type="number"
                  value={Math.round(selectedTextClip.transform.x)}
                  onChange={(e) =>
                    commitProjectChange((project) =>
                      updateClipTransform(project, selectedTextClip.id, {
                        ...selectedTextClip.transform,
                        x: Number(e.target.value) || 0,
                      }),
                    )
                  }
                />
              </label>
              <label className={styles.field}>
                <span>Y</span>
                <input
                  type="number"
                  value={Math.round(selectedTextClip.transform.y)}
                  onChange={(e) =>
                    commitProjectChange((project) =>
                      updateClipTransform(project, selectedTextClip.id, {
                        ...selectedTextClip.transform,
                        y: Number(e.target.value) || 0,
                      }),
                    )
                  }
                />
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  readOnly = false,
}: {
  label: string;
  value: string;
  readOnly?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={value} readOnly={readOnly} disabled={readOnly} />
    </label>
  );
}
