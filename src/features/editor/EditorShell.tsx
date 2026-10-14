import { useCallback, useEffect } from "react";
import {
  actionAutosave,
  actionOpenProject,
  actionRecoverAutosave,
  actionRefreshMissing,
  actionSaveProject,
  formatActionError,
} from "../../lib/projectActions";
import { getAppInfo, isTauriRuntime } from "../../lib/tauri";
import {
  useEditorUiStore,
  type EditorPanel,
} from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { MediaBinPanel } from "../media-bin/MediaBinPanel";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { ExportPanel } from "../export/ExportPanel";
import styles from "./EditorShell.module.css";

const RAIL_ITEMS: { id: EditorPanel; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "⬆" },
  { id: "canvas", label: "Canvas", icon: "▢" },
  { id: "text", label: "Text", icon: "T" },
  { id: "audio", label: "Audio", icon: "♪" },
  { id: "photos", label: "Photos", icon: "▣" },
  { id: "subtitles", label: "Subs", icon: "≡" },
];

export function EditorShell() {
  const project = useProjectStore((s) => s.project);
  const projectPath = useProjectStore((s) => s.projectPath);
  const dirty = useProjectStore((s) => s.dirty);
  const newProject = useProjectStore((s) => s.newProject);
  const setProject = useProjectStore((s) => s.setProject);
  const setProjectPath = useProjectStore((s) => s.setProjectPath);
  const markClean = useProjectStore((s) => s.markClean);
  const activePanel = useEditorUiStore((s) => s.activePanel);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);
  const tool = useEditorUiStore((s) => s.tool);
  const setTool = useEditorUiStore((s) => s.setTool);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

  const handleOpen = useCallback(async () => {
    try {
      const { project: opened, path } = await actionOpenProject();
      const refreshed = await actionRefreshMissing(opened);
      setProject(refreshed, { dirty: false });
      setProjectPath(path);
      markClean();
      const missing = refreshed.assets.filter((a) => a.missing).length;
      setStatusMessage(
        missing > 0
          ? `Opened · ${missing} missing media file(s)`
          : `Opened${path ? ` · ${path}` : ""}`,
      );
    } catch (error) {
      if (formatActionError(error) !== "Open cancelled") {
        setStatusMessage(formatActionError(error));
      }
    }
  }, [markClean, setProject, setProjectPath, setStatusMessage]);

  const handleSave = useCallback(async () => {
    try {
      const path = await actionSaveProject(project, projectPath);
      setProjectPath(path);
      setProject({ ...project, updatedAt: new Date().toISOString() }, { dirty: false });
      markClean();
      setStatusMessage(path ? `Saved · ${path}` : "Saved (browser download)");
    } catch (error) {
      if (formatActionError(error) !== "Save cancelled") {
        setStatusMessage(formatActionError(error));
      }
    }
  }, [markClean, project, projectPath, setProject, setProjectPath, setStatusMessage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (isTauriRuntime()) {
          const info = await getAppInfo();
          if (!cancelled) {
            setStatusMessage(`${info.name} v${info.version} · offline`);
          }
          const recovered = await actionRecoverAutosave();
          if (!cancelled && recovered && useProjectStore.getState().project.assets.length === 0) {
            // Offer recovery only as status hint for now; user can Open manually later.
            setStatusMessage("Autosave available — use Open or continue editing");
          }
        } else if (!cancelled) {
          setStatusMessage("Browser preview · Save downloads JSON; Import needs desktop app");
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("Browser preview · Tauri bridge offline");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStatusMessage]);

  useEffect(() => {
    if (!dirty || !isTauriRuntime()) return;
    const timer = window.setTimeout(() => {
      void actionAutosave(useProjectStore.getState().project).catch(() => {
        /* non-fatal */
      });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [dirty, project]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <button
            type="button"
            className={styles.brandBtn}
            onClick={() => {
              newProject();
              setStatusMessage("New project");
            }}
            title="New project"
          >
            <span className={styles.brandMark}>▶</span>
          </button>
          <div className={styles.projectMeta}>
            <input
              className={styles.projectTitle}
              value={project.name}
              onChange={(e) =>
                setProject({
                  ...project,
                  name: e.target.value,
                })
              }
              aria-label="Project name"
            />
            <span className={styles.dirty}>{dirty ? "Unsaved" : "Saved"}</span>
          </div>
        </div>

        <div className={styles.topCenter}>
          <div className={styles.toolGroup}>
            <button
              type="button"
              className={tool === "select" ? styles.toolActive : styles.tool}
              onClick={() => setTool("select")}
              title="Select"
            >
              ↖
            </button>
            <button
              type="button"
              className={tool === "hand" ? styles.toolActive : styles.tool}
              onClick={() => setTool("hand")}
              title="Hand"
            >
              ✋
            </button>
          </div>
          <div className={styles.toolGroup}>
            <button type="button" className={styles.tool} onClick={() => void handleOpen()} title="Open">
              Open
            </button>
            <button type="button" className={styles.tool} onClick={() => void handleSave()} title="Save">
              Save
            </button>
          </div>
          <div className={styles.toolGroup}>
            <button type="button" className={styles.tool} disabled title="Undo — Milestone 2">
              ↶
            </button>
            <button type="button" className={styles.tool} disabled title="Redo — Milestone 2">
              ↷
            </button>
          </div>
        </div>

        <div className={styles.topRight}>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => setActivePanel("export")}
            title="Export"
          >
            Export
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Library">
          {RAIL_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                activePanel === item.id ? styles.railItemActive : styles.railItem
              }
              onClick={() => setActivePanel(item.id)}
            >
              <span className={styles.railIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <aside className={styles.side}>
          {activePanel === "media" && <MediaBinPanel />}
          {activePanel === "text" && <InspectorPanel mode="text" />}
          {activePanel === "canvas" && <InspectorPanel mode="canvas" />}
          {activePanel === "audio" && <MediaBinPanel filter="audio" />}
          {activePanel === "photos" && <MediaBinPanel filter="image" />}
          {activePanel === "subtitles" && <InspectorPanel mode="subtitles" />}
          {activePanel === "export" && <ExportPanel />}
        </aside>

        <section className={styles.main}>
          <PreviewPanel />
        </section>
      </div>

      <section className={styles.timeline}>
        <TimelinePanel />
      </section>
    </div>
  );
}
