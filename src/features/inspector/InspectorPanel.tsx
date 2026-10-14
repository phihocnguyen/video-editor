import { useMemo, useState } from "react";
import {
  addTextClip,
  createDefaultTextStyle,
  normalizeTextAnimation,
  TEXT_ANIM_GROUPS,
  TEXT_ANIM_PRESETS,
  updateCanvas,
  updateClipAnimation,
  updateClipText,
  updateClipTransform,
  type TextAnimId,
  type TextStyle,
} from "../../domain";
import { PresetGrid, type PresetItem } from "../effects/PresetGrid";
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

const TEXT_ANIM_ITEMS: PresetItem[] = TEXT_ANIM_PRESETS.map((p) => ({
  id: p.id,
  label: p.label,
  hint: p.hint,
  group: p.group,
}));

const CANVAS_PRESETS: { label: string; width: number; height: number; fps: number }[] = [
  { label: "16:9 · 1920×1080", width: 1920, height: 1080, fps: 30 },
  { label: "9:16 · 1080×1920", width: 1080, height: 1920, fps: 30 },
  { label: "1:1 · 1080×1080", width: 1080, height: 1080, fps: 30 },
  { label: "4:5 · 1080×1350", width: 1080, height: 1350, fps: 30 },
  { label: "21:9 · 2560×1080", width: 2560, height: 1080, fps: 30 },
];

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
          <label className={styles.label}>Resolution</label>
          <div className={styles.row}>
            <label className={styles.field}>
              <span>W</span>
              <input
                type="number"
                min={2}
                max={7680}
                value={canvas.width}
                onChange={(e) =>
                  commitProjectChange((p) =>
                    updateCanvas(p, { width: Number(e.target.value) || canvas.width }),
                  )
                }
              />
            </label>
            <label className={styles.field}>
              <span>H</span>
              <input
                type="number"
                min={2}
                max={7680}
                value={canvas.height}
                onChange={(e) =>
                  commitProjectChange((p) =>
                    updateCanvas(p, { height: Number(e.target.value) || canvas.height }),
                  )
                }
              />
            </label>
          </div>
          <div className={styles.chipRow}>
            {CANVAS_PRESETS.map((preset) => {
              const active =
                canvas.width === preset.width && canvas.height === preset.height;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={active ? styles.chipActive : styles.chip}
                  title={`Set sequence to ${preset.label}`}
                  onClick={() =>
                    commitProjectChange((p) =>
                      updateCanvas(p, {
                        width: preset.width,
                        height: preset.height,
                        frameRate: preset.fps,
                      }),
                    )
                  }
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Frame rate</label>
          <label className={styles.field}>
            <span>FPS</span>
            <input
              type="number"
              min={1}
              max={240}
              value={canvas.frameRate}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { frameRate: Number(e.target.value) || canvas.frameRate }),
                )
              }
            />
          </label>
        </div>

        <div className={styles.section}>
          <label className={styles.label}>Background</label>
          <div className={styles.colorRow}>
            <input
              type="color"
              value={canvas.backgroundColor}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { backgroundColor: e.target.value }),
                )
              }
            />
            <input
              value={canvas.backgroundColor}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { backgroundColor: e.target.value }),
                )
              }
            />
          </div>
          <p className={styles.hint}>
            Shown behind every layer in the preview and used as the export base colour.
          </p>
        </div>
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
  const animation = normalizeTextAnimation(selectedTextClip?.animation);

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

          <div className={styles.section}>
            <div className={styles.blockHead}>
              <label className={styles.label}>In animation</label>
            </div>
            <PresetGrid
              items={TEXT_ANIM_ITEMS}
              groups={TEXT_ANIM_GROUPS}
              value={animation.in}
              media="text"
              onSelect={(id) =>
                commitProjectChange((project) =>
                  updateClipAnimation(project, selectedTextClip.id, {
                    in: id as TextAnimId,
                  }),
                )
              }
            />
            <div className={styles.blockHead}>
              <label className={styles.label}>Out animation</label>
            </div>
            <PresetGrid
              items={TEXT_ANIM_ITEMS}
              groups={TEXT_ANIM_GROUPS}
              value={animation.out}
              media="text"
              onSelect={(id) =>
                commitProjectChange((project) =>
                  updateClipAnimation(project, selectedTextClip.id, {
                    out: id as TextAnimId,
                  }),
                )
              }
              footnote="Một số hiệu ứng dùng mặt nạ (wipe/cắt dán) chỉ được mô phỏng gần đúng khi export."
            />
            <label className={styles.sliderField}>
              <div className={styles.sliderHead}>
                <span>Duration</span>
                <span className={styles.sliderValue}>
                  {(animation.durationTicks / 1_000_000).toFixed(2)}s
                </span>
              </div>
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.05}
                value={animation.durationTicks / 1_000_000}
                onChange={(e) =>
                  commitProjectChange((project) =>
                    updateClipAnimation(project, selectedTextClip.id, {
                      durationTicks: Math.round(Number(e.target.value) * 1_000_000),
                    }),
                  )
                }
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}
