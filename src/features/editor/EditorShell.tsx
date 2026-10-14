import { useEffect, useState } from "react";
import { getAppInfo, type AppInfo } from "../../lib/tauri";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { MediaBinPanel } from "../media-bin/MediaBinPanel";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { ExportPanel } from "../export/ExportPanel";
import styles from "./EditorShell.module.css";

export function EditorShell() {
  const project = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const newProject = useProjectStore((s) => s.newProject);
  const activePanel = useEditorUiStore((s) => s.activePanel);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);
  const statusMessage = useEditorUiStore((s) => s.statusMessage);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await getAppInfo();
        if (!cancelled) {
          setAppInfo(info);
          setStatusMessage(`${info.name} v${info.version} — offline core ready`);
        }
      } catch {
        if (!cancelled) {
          setStatusMessage("UI mode (Tauri bridge unavailable in browser preview)");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setStatusMessage]);

  return (
    <div className={styles.shell}>
      <header className={styles.toolbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>Cutline</span>
          <span className={styles.projectName}>
            {project.name}
            {dirty ? " •" : ""}
          </span>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => newProject()}>
            New
          </button>
          <button type="button" disabled title="Milestone 1">
            Open
          </button>
          <button type="button" disabled title="Milestone 1">
            Save
          </button>
          <button
            type="button"
            className={activePanel === "media" ? styles.active : undefined}
            onClick={() => setActivePanel("media")}
          >
            Media
          </button>
          <button
            type="button"
            className={activePanel === "inspector" ? styles.active : undefined}
            onClick={() => setActivePanel("inspector")}
          >
            Inspector
          </button>
          <button
            type="button"
            className={activePanel === "export" ? styles.active : undefined}
            onClick={() => setActivePanel("export")}
          >
            Export
          </button>
        </div>
      </header>

      <div className={styles.workspace}>
        <aside className={styles.side}>
          {activePanel === "media" && <MediaBinPanel />}
          {activePanel === "inspector" && <InspectorPanel />}
          {activePanel === "export" && <ExportPanel />}
        </aside>
        <section className={styles.preview}>
          <PreviewPanel />
        </section>
      </div>

      <section className={styles.timeline}>
        <TimelinePanel />
      </section>

      <footer className={styles.status}>
        <span>{statusMessage}</span>
        <span>
          {project.canvas.width}×{project.canvas.height} @ {project.canvas.frameRate}fps
          {appInfo ? ` · ${appInfo.offlineCapable ? "offline" : "online"}` : ""}
        </span>
      </footer>
    </div>
  );
}
