import { useCallback, useEffect, useRef, useState } from "react";
import { closeGapAtPlayhead, deleteClips, findVideoGapAtPlayhead } from "../../domain";
import {
  actionAutosave,
  actionEnsureLibraryProject,
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
import { requestPlay, togglePlay } from "../../lib/playback";
import {
  nudgePlaybackRate,
  editFollowsLink,
  useEditorUiStore,
  type EditorPanel,
} from "../../stores/editorUiStore";
import { commitProjectChange, useHistoryStore } from "../../stores/historyStore";
import { useAppShellStore } from "../../stores/appShellStore";
import { useProjectStore } from "../../stores/projectStore";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { MediaBinPanel } from "../media-bin/MediaBinPanel";
import { TimelinePanel } from "../timeline/TimelinePanel";
import { PreviewPanel } from "../preview/PreviewPanel";
import { InspectorPanel } from "../inspector/InspectorPanel";
import { PropertiesPanel } from "../inspector/PropertiesPanel";
import { ExportPanel } from "../export/ExportPanel";
import { ExportProgressModal } from "../export/ExportProgressModal";
import { PhotosPanel } from "../library/PhotosPanel";
import { ShapePanel } from "../library/ShapePanel";
import { TemplatePanel } from "../library/TemplatePanel";
import {
  AudioIcon,
  ExportIcon,
  MediaIcon,
  PauseIcon,
  PhotosIcon,
  PlayIcon,
  RedoIcon,
  ShapeIcon,
  SubtitlesIcon,
  TemplateIcon,
  TextIcon,
  UndoIcon,
} from "../../components/icons";
import styles from "./EditorShell.module.css";

const RAIL_ITEMS: { id: EditorPanel; label: string; Icon: typeof MediaIcon }[] = [
  { id: "media", label: "Media", Icon: MediaIcon },
  { id: "text", label: "Text", Icon: TextIcon },
  { id: "audio", label: "Audio", Icon: AudioIcon },
  { id: "photos", label: "Photos", Icon: PhotosIcon },
  { id: "shape", label: "Shape", Icon: ShapeIcon },
  { id: "template", label: "Template", Icon: TemplateIcon },
  { id: "subtitles", label: "Subs", Icon: SubtitlesIcon },
];

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/* ---------------------------------------------------------------- menu primitives */

interface MenuItem {
  label: string;
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
}

function MenuDropdown({
  label,
  items,
  open,
  onToggle,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  return (
    <div className={styles.menuRoot}>
      <button
        type="button"
        className={open ? styles.menuTriggerOpen : styles.menuTrigger}
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? (
        <div className={styles.menuPanel} role="menu">
          {items.map((item) => (
            <div key={item.label}>
              {item.separatorBefore ? <div className={styles.menuSep} /> : null}
              <button
                type="button"
                role="menuitem"
                className={item.danger ? styles.menuItemDanger : styles.menuItem}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect();
                  onClose();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut ? <kbd className={styles.menuKbd}>{item.shortcut}</kbd> : null}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- shell */

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
  const snapEnabled = useEditorUiStore((s) => s.snapEnabled);
  const setSnapEnabled = useEditorUiStore((s) => s.setSnapEnabled);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const clearHistory = useHistoryStore((s) => s.clear);
  const pastCount = useHistoryStore((s) => s.past.length);
  const futureCount = useHistoryStore((s) => s.future.length);
  const recent = useRecentProjectsStore((s) => s.recent);
  const rememberRecent = useRecentProjectsStore((s) => s.remember);
  const hydrateSettings = useSettingsStore((s) => s.hydrate);
  const goHome = useAppShellStore((s) => s.goHome);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<{ name: string; version: string } | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.style.setProperty("--timeline-h", `${timelineHeightPx}px`);
  }, [timelineHeightPx]);

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: PointerEvent) => {
      if (menuBarRef.current?.contains(e.target as Node)) return;
      setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

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

  const handleNew = useCallback(() => {
    newProject();
    clearHistory();
    setSelectedClipIds([]);
    setPlaying(false);
    void (async () => {
      try {
        const project = useProjectStore.getState().project;
        const path = await actionEnsureLibraryProject(project);
        if (path) {
          useProjectStore.getState().setProjectPath(path);
          rememberRecent(path, project.name || "Untitled project");
        }
        setStatusMessage("New project · draft saved locally");
      } catch (error) {
        setStatusMessage(formatActionError(error));
      }
    })();
  }, [
    clearHistory,
    newProject,
    rememberRecent,
    setPlaying,
    setSelectedClipIds,
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
            setAppInfo({ name: info.name, version: info.version });
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

  const autosaveGenRef = useRef(0);
  useEffect(() => {
    if (!dirty || !isTauriRuntime()) return;
    const gen = ++autosaveGenRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const current = useProjectStore.getState().project;
          const path = await actionAutosave(current);
          if (!path || gen !== autosaveGenRef.current) return;
          const store = useProjectStore.getState();
          if (!store.projectPath) store.setProjectPath(path);
          store.markClean();
          rememberRecent(path, current.name || "Untitled project");
        } catch {
          /* non-fatal */
        }
      })();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
      autosaveGenRef.current += 1;
    };
  }, [dirty, project, rememberRecent]);

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

      const bare = event.key.toLowerCase();
      if (!mod && !event.altKey && bare === "c") {
        event.preventDefault();
        useEditorUiStore.getState().setTool("razor");
        useEditorUiStore.getState().setStatusMessage("Razor — click a clip to split");
        return;
      }
      if (!mod && !event.altKey && bare === "v") {
        event.preventDefault();
        useEditorUiStore.getState().setTool("select");
        useEditorUiStore.getState().setStatusMessage("Select");
        return;
      }

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
        togglePlay();
        return;
      }

      // Premiere-style shuttle: J slower/back · K pause/play · L faster/forward
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k" || key === "l") {
        event.preventDefault();
        const ui = useEditorUiStore.getState();
        if (key === "k") {
          togglePlay();
          return;
        }
        const next = nudgePlaybackRate(ui.playbackRate, key === "l" ? 1 : -1);
        ui.setPlaybackRate(next);
        requestPlay();
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
        const ui = useEditorUiStore.getState();
        const gap = findVideoGapAtPlayhead(
          useProjectStore.getState().project,
          ui.playheadTicks,
          ui.selectedTrackId,
        );
        if (gap) {
          event.preventDefault();
          commitProjectChange((p) => closeGapAtPlayhead(p, ui.playheadTicks, ui.selectedTrackId));
          setStatusMessage("Closed the gap");
          return;
        }
        const ids = ui.selectedClipIds;
        if (ids.length === 0) return;
        event.preventDefault();
        commitProjectChange((p) =>
          deleteClips(p, ids, { followLink: editFollowsLink(ids) }),
        );
        setSelectedClipIds([]);
        setStatusMessage("Deleted selected clip(s)");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpen, handleSave, redo, setSelectedClipIds, setStatusMessage, undo]);

  const handleProjectsHome = useCallback(() => {
    if (dirty) {
      const ok = window.confirm(
        "Leave editor and return to Projects home?\nUnsaved changes may be lost unless you Save first.",
      );
      if (!ok) return;
    }
    setPlaying(false);
    goHome();
  }, [dirty, goHome, setPlaying]);

  const fileMenu: MenuItem[] = [
    { label: "New project", shortcut: "Ctrl+N", onSelect: handleNew },
    { label: "Open…", shortcut: "Ctrl+O", onSelect: () => void handleOpen() },
    { label: "Save", shortcut: "Ctrl+S", onSelect: () => void handleSave() },
    ...(recent.length > 0 && isTauriRuntime()
      ? [
          {
            label: `Open recent · ${recent[0]!.name || shortPath(recent[0]!.path)}`,
            onSelect: () => void handleOpenRecent(recent[0]!.path),
            separatorBefore: true,
          },
        ]
      : []),
    {
      label: "Projects home",
      onSelect: handleProjectsHome,
      separatorBefore: true,
    },
    { label: "Export…", onSelect: () => setActivePanel("export") },
  ];

  const editMenu: MenuItem[] = [
    { label: "Undo", shortcut: "Ctrl+Z", onSelect: undo, disabled: pastCount === 0 },
    { label: "Redo", shortcut: "Ctrl+Y", onSelect: redo, disabled: futureCount === 0 },
    { label: "Cut", shortcut: "Ctrl+X", onSelect: cutSelectedClips, separatorBefore: true },
    { label: "Copy", shortcut: "Ctrl+C", onSelect: copySelectedClips },
    { label: "Paste", shortcut: "Ctrl+V", onSelect: pasteClipboardClips },
    { label: "Duplicate", shortcut: "Ctrl+D", onSelect: duplicateSelectedClips },
    {
      label: "Delete",
      shortcut: "Del",
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        const ids = useEditorUiStore.getState().selectedClipIds;
        if (ids.length === 0) return;
        commitProjectChange((p) =>
          deleteClips(p, ids, { followLink: editFollowsLink(ids) }),
        );
        setSelectedClipIds([]);
        setStatusMessage("Deleted selected clip(s)");
      },
    },
  ];

  const viewMenu: MenuItem[] = [
    {
      label: snapEnabled ? "Snapping: on" : "Snapping: off",
      onSelect: () => setSnapEnabled(!snapEnabled),
    },
    {
      label:
        tool === "razor" ? "Tool: Razor" : tool === "hand" ? "Tool: Hand" : "Tool: Select",
      onSelect: () => setTool(tool === "select" ? "hand" : "select"),
    },
    {
      label: "Reset timeline zoom",
      separatorBefore: true,
      onSelect: () => useEditorUiStore.getState().setTimelineZoom(1),
    },
  ];

  const helpMenu: MenuItem[] = [
    {
      label: appInfo ? `About ${appInfo.name} v${appInfo.version}` : "About KlipCut",
      onSelect: () =>
        setStatusMessage(
          appInfo
            ? `${appInfo.name} v${appInfo.version} — local, offline desktop editor`
            : "KlipCut — local, offline desktop editor",
        ),
    },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden>
              <svg viewBox="0 0 16 16" width="14" height="14">
                <path d="M4 2.6v10.8l9-5.4-9-5.4Z" fill="currentColor" />
              </svg>
            </span>
            <span className={styles.brandName}>KlipCut</span>
          </div>
          <div className={styles.projectMeta}>
            <input
              className={styles.projectTitle}
              value={project.name}
              onChange={(e) => setProject({ ...project, name: e.target.value })}
              aria-label="Project name"
            />
            <span className={styles.dirty}>
              <span className={dirty ? styles.dotDirty : styles.dotClean} aria-hidden />
              {dirty ? "Unsaved" : "Saved"}
            </span>
          </div>
        </div>

        <nav className={styles.menubar} ref={menuBarRef}>
          <MenuDropdown
            label="File"
            items={fileMenu}
            open={openMenu === "file"}
            onToggle={() => setOpenMenu(openMenu === "file" ? null : "file")}
            onClose={() => setOpenMenu(null)}
          />
          <MenuDropdown
            label="Edit"
            items={editMenu}
            open={openMenu === "edit"}
            onToggle={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
            onClose={() => setOpenMenu(null)}
          />
          <MenuDropdown
            label="View"
            items={viewMenu}
            open={openMenu === "view"}
            onToggle={() => setOpenMenu(openMenu === "view" ? null : "view")}
            onClose={() => setOpenMenu(null)}
          />
          <MenuDropdown
            label="Help"
            items={helpMenu}
            open={openMenu === "help"}
            onToggle={() => setOpenMenu(openMenu === "help" ? null : "help")}
            onClose={() => setOpenMenu(null)}
          />
        </nav>

        <div className={styles.topRight}>
          <div className={styles.historyGroup}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => undo()}
              disabled={pastCount === 0}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => redo()}
              disabled={futureCount === 0}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <RedoIcon />
            </button>
          </div>
          <button
            type="button"
            className={isPlaying ? styles.playToggleActive : styles.playToggle}
            onClick={() => togglePlay()}
            title="Play / Pause (Space)"
            aria-label="Play or pause"
          >
            {isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
          </button>
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => setActivePanel("export")}
            title="Export (MP4)"
          >
            <ExportIcon size={14} />
            Export
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Library">
          {RAIL_ITEMS.map((item) => {
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activePanel === item.id ? styles.railItemActive : styles.railItem}
                onClick={() => setActivePanel(item.id)}
                title={item.label}
              >
                <span className={styles.railIcon}>
                  <Icon size={18} />
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <aside className={styles.side}>
          {activePanel === "media" && <MediaBinPanel />}
          {activePanel === "text" && <InspectorPanel mode="text" />}
          {activePanel === "audio" && <MediaBinPanel filter="audio" />}
          {activePanel === "photos" && <PhotosPanel />}
          {activePanel === "shape" && <ShapePanel />}
          {activePanel === "template" && <TemplatePanel />}
          {activePanel === "subtitles" && <InspectorPanel mode="subtitles" />}
          {activePanel === "export" && <ExportPanel />}
        </aside>

        <section className={styles.main}>
          <PreviewPanel />
        </section>

        {/* Always mounted as its own column so preview/transport never resize or get covered */}
        <aside className={styles.props} aria-label="Properties">
          <PropertiesPanel />
        </aside>
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

      <StatusBar />
      <ExportProgressModal />
    </div>
  );
}

function StatusBar() {
  const statusMessage = useEditorUiStore((s) => s.statusMessage);
  const fps = useProjectStore((s) => s.project.canvas.frameRate);
  const zoom = useEditorUiStore((s) => s.timelineZoom);
  return (
    <footer className={styles.statusBar}>
      <span className={styles.statusDot} aria-hidden />
      <span className={styles.statusText}>{statusMessage}</span>
      <span className={styles.statusRight}>
        <span>{fps > 0 ? `${fps} fps` : "— fps"}</span>
        <span>·</span>
        <span>{zoom.toFixed(1)}× zoom</span>
      </span>
    </footer>
  );
}
