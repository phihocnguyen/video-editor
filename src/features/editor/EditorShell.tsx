import { useCallback, useEffect } from "react";
import { deleteClips } from "../../domain";
import {
  actionAutosave,
  actionOpenProject,
  actionOpenProjectAtPath,
  actionRecoverAutosave,
  actionRefreshMissing,
  actionSaveProject,
  formatActionError,
} from "../../lib/projectActions";
import {
  copySelectedClips,
  cutSelectedClips,
  duplicateSelectedClips,
  pasteClipboardClips,
} from "../../lib/clipClipboard";
import { getAppInfo, isTauriRuntime } from "../../lib/tauri";
import {
  nudgePlaybackRate,
  useEditorUiStore,
  type EditorPanel,
} from "../../stores/editorUiStore";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { MediaBinPanel } from "../media-bin/MediaBinPanel";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { ExportPanel } from "../export/ExportPanel";
import styles from "./EditorShell.module.css";

const RAIL_ITEMS: { id: EditorPanel; label: string; icon: string }[] = [
  { id: "media", label: "Media", icon: "⬆" },
  { id: "clip", label: "Clip", icon: "◆" },
  { id: "canvas", label: "Canvas", icon: "▢" },
  { id: "text", label: "Text", icon: "T" },
  { id: "audio", label: "Audio", icon: "♪" },
  { id: "photos", label: "Photos", icon: "▣" },
  { id: "subtitles", label: "Subs", icon: "≡" },
];

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

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
  const timelineHeightPx = useEditorUiStore((s) => s.timelineHeightPx);
  const tool = useEditorUiStore((s) => s.tool);
  const setTool = useEditorUiStore((s) => s.setTool);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const clearHistory = useHistoryStore((s) => s.clear);
  const pastCount = useHistoryStore((s) => s.past.length);
  const futureCount = useHistoryStore((s) => s.future.length);
  const recent = useRecentProjectsStore((s) => s.recent);
  const rememberRecent = useRecentProjectsStore((s) => s.remember);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);

  useEffect(() => {
    document.documentElement.style.setProperty("--timeline-h", `${timelineHeightPx}px`);
  }, [timelineHeightPx]);

  const loadOpened = useCallback(
    async (opened: { project: typeof project; path: string | null }) => {
      const refreshed = await actionRefreshMissing(opened.project);
      setProject(refreshed, { dirty: false });
      setProjectPath(opened.path);
      markClean();
      clearHistory();
      setSelectedClipIds([]);
      setPlaying(false);
      if (opened.path) {
        rememberRecent(opened.path, refreshed.name || shortPath(opened.path));
      }
      const missing = refreshed.assets.filter((a) => a.missing).length;
      setStatusMessage(
        missing > 0
          ? `Opened · ${missing} missing media file(s)`
          : `Opened${opened.path ? ` · ${opened.path}` : ""}`,
      );
    },
    [
      clearHistory,
      markClean,
      rememberRecent,
      setPlaying,
      setProject,
      setProjectPath,
      setSelectedClipIds,
      setStatusMessage,
    ],
  );

  const handleOpen = useCallback(async () => {
    try {
      const opened = await actionOpenProject();
      await loadOpened(opened);
    } catch (error) {
      if (formatActionError(error) !== "Open cancelled") {
        setStatusMessage(formatActionError(error));
      }
    }
  }, [loadOpened, setStatusMessage]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      try {
        const opened = await actionOpenProjectAtPath(path);
        await loadOpened(opened);
      } catch (error) {
        setStatusMessage(formatActionError(error));
      }
    },
    [loadOpened, setStatusMessage],
  );

  const handleSave = useCallback(async () => {
    try {
      const path = await actionSaveProject(project, projectPath);
      setProjectPath(path);
      setProject({ ...project, updatedAt: new Date().toISOString() }, { dirty: false });
      markClean();
      if (path) {
        rememberRecent(path, project.name || shortPath(path));
      }
      setStatusMessage(path ? `Saved · ${path}` : "Saved (browser download)");
    } catch (error) {
      if (formatActionError(error) !== "Save cancelled") {
        setStatusMessage(formatActionError(error));
      }
    }
  }, [
    markClean,
    project,
    projectPath,
    rememberRecent,
    setProject,
    setProjectPath,
    setStatusMessage,
  ]);

  useEffect(() => {
    hydrateSettings();
  }, [hydrateSettings]);

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (mod && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handleOpen();
        return;
      }
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (
        (mod && event.key.toLowerCase() === "y") ||
        (mod && event.shiftKey && event.key.toLowerCase() === "z")
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (typing) return;

      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedClips();
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        event.preventDefault();
        cutSelectedClips();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteClipboardClips();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedClips();
        return;
      }

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setPlaying(!useEditorUiStore.getState().isPlaying);
        return;
      }

      // Premiere-style shuttle: J slower/back · K pause/play · L faster/forward
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k" || key === "l") {
        event.preventDefault();
        const ui = useEditorUiStore.getState();
        if (key === "k") {
          if (ui.isPlaying) {
            ui.setPlaying(false);
          } else {
            if (Math.abs(ui.playbackRate) < 0.01) ui.setPlaybackRate(1);
            else if (ui.playbackRate < 0) ui.setPlaybackRate(Math.abs(ui.playbackRate));
            ui.setPlaying(true);
          }
          return;
        }
        const next = nudgePlaybackRate(ui.playbackRate, key === "l" ? 1 : -1);
        ui.setPlaybackRate(next);
        ui.setPlaying(true);
        ui.setStatusMessage(
          next === 1
            ? "Play 1×"
            : next > 0
              ? `Fast forward ${next}×`
              : `Rewind ${Math.abs(next)}×`,
        );
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const ids = useEditorUiStore.getState().selectedClipIds;
        if (ids.length === 0) return;
        event.preventDefault();
        commitProjectChange((p) => deleteClips(p, ids));
        setSelectedClipIds([]);
        setStatusMessage("Deleted selected clip(s)");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpen, handleSave, redo, setPlaying, setSelectedClipIds, setStatusMessage, undo]);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <button
            type="button"
            className={styles.brandBtn}
            onClick={() => {
              newProject();
              clearHistory();
              setSelectedClipIds([]);
              setPlaying(false);
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
            <button
              type="button"
              className={styles.tool}
              onClick={() => void handleOpen()}
              title="Open (Ctrl+O)"
            >
              Open
            </button>
            <button
              type="button"
              className={styles.tool}
              onClick={() => void handleSave()}
              title="Save (Ctrl+S)"
            >
              Save
            </button>
            {recent.length > 0 && isTauriRuntime() && (
              <label className={styles.recentWrap} title="Recent projects">
                <span className={styles.recentLabel}>Recent</span>
                <select
                  className={styles.recentSelect}
                  value=""
                  onChange={(e) => {
                    const path = e.target.value;
                    if (path) void handleOpenRecent(path);
                  }}
                >
                  <option value="" disabled>
                    Open recent…
                  </option>
                  {recent.map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.name || shortPath(entry.path)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className={styles.toolGroup}>
            <button
              type="button"
              className={styles.tool}
              onClick={() => undo()}
              disabled={pastCount === 0}
              title="Undo (Ctrl+Z)"
            >
              ↶
            </button>
            <button
              type="button"
              className={styles.tool}
              onClick={() => redo()}
              disabled={futureCount === 0}
              title="Redo (Ctrl+Y)"
            >
              ↷
            </button>
            <button
              type="button"
              className={isPlaying ? styles.toolActive : styles.tool}
              onClick={() => setPlaying(!isPlaying)}
              title="Play / Pause (Space)"
            >
              {isPlaying ? "❚❚" : "▶"}
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
          {activePanel === "clip" && <InspectorPanel mode="clip" />}
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

      <button
        type="button"
        className={styles.splitHandle}
        aria-label="Resize timeline"
        title="Drag to resize preview / timeline"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const startY = e.clientY;
          const startH = useEditorUiStore.getState().timelineHeightPx;
          const onMove = (ev: PointerEvent) => {
            // Drag up → taller timeline
            const next = startH - (ev.clientY - startY);
            useEditorUiStore.getState().setTimelineHeightPx(next);
            document.documentElement.style.setProperty(
              "--timeline-h",
              `${useEditorUiStore.getState().timelineHeightPx}px`,
            );
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      />

      <section className={styles.timeline}>
        <TimelinePanel />
      </section>
    </div>
  );
}
