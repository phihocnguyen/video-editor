import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CutlineLogo } from "@/components/CutlineLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ImportIcon, InfoIcon, MediaIcon, TrashIcon } from "@/components/icons";
import {
  actionDeleteLibraryProject,
  actionEnsureLibraryProject,
  actionListLibraryProjects,
  actionOpenProject,
  actionOpenProjectAtPath,
  formatActionError,
} from "../../lib/projectActions";
import { isTauriRuntime, type LibraryProjectInfo } from "../../lib/tauri";
import { useAppShellStore } from "../../stores/appShellStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";

/*
 * Spacing scale used everywhere in this file (Tailwind units = 4px):
 *   2 (8px)  – tight gaps inside controls
 *   3 (12px) – gaps between icon and label, between buttons
 *   4 (16px) – default gap / sidebar padding / header → content
 *   6 (24px) – grid gaps, hero inner gap
 *   8 (32px) – page padding, hero padding, space between sections
 */

type RailTab = "home" | "drafts";
type ViewMode = "grid" | "list";

/* ───────── icons ───────── */

type IconProps = { size?: number };

const Svg = ({ size = 18, children }: IconProps & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
    {children}
  </svg>
);

const PlusIcon = ({ size }: IconProps) => (
  <Svg size={size}>
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </Svg>
);
const HomeGlyph = ({ size }: IconProps) => (
  <Svg size={size}>
    <path
      d="M4 11.2 12 4l8 7.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-7.8Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </Svg>
);
const DraftsGlyph = ({ size }: IconProps) => (
  <Svg size={size}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="m10.5 9.6 4 2.4-4 2.4V9.6Z" fill="currentColor" />
  </Svg>
);
const SearchGlyph = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
    <path d="m16 16 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
);
const GridGlyph = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
  </Svg>
);
const ListGlyph = ({ size = 16 }: IconProps) => (
  <Svg size={size}>
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </Svg>
);
const PlayGlyph = ({ size = 18 }: IconProps) => (
  <Svg size={size}>
    <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
  </Svg>
);
const SpinnerGlyph = ({ size = 22 }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
    className="shrink-0 animate-spin"
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path
      d="M21 12a9 9 0 0 0-9-9"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
);

/* ───────── helpers ───────── */

function shortPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 14) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Placeholder frame: two-tone gradient, vignette, mini timeline strip. */
function DraftThumb({ seed, label, className }: { seed: string; label: string; className?: string }) {
  const hue = hueFor(seed);
  return (
    <div
      className={cn("relative aspect-video w-full overflow-hidden", className)}
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, hsl(${hue} 62% 38%) 0%, transparent 60%), linear-gradient(140deg, hsl(${(hue + 50) % 360} 50% 22%), hsl(${(hue + 90) % 360} 45% 10%))`,
      }}
    >
      <span className="absolute inset-0 grid place-items-center text-[clamp(1.5rem,4vw,2.5rem)] font-black text-white/20 select-none">
        {label.slice(0, 1).toUpperCase()}
      </span>
      <div className="absolute inset-x-2 bottom-2 flex h-[3px] gap-px overflow-hidden rounded-full bg-black/40">
        <span className="w-[40%] bg-white/55" />
        <span className="w-[25%] bg-white/25" />
        <span className="w-[35%] bg-white/15" />
      </div>
    </div>
  );
}

/** Decorative timeline for the hero banner. Purely visual. */
function HeroTimeline() {
  const video = [
    { w: 26, h: 205 },
    { w: 16, h: 160 },
    { w: 30, h: 262 },
    { w: 22, h: 30 },
  ];
  const overlay = [
    { o: 12, w: 20, h: 330 },
    { o: 8, w: 26, h: 280 },
  ];
  const bars = Array.from({ length: 64 }, (_, i) =>
    Math.round(30 + 55 * Math.abs(Math.sin(i * 0.62) * Math.cos(i * 0.21))),
  );
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 hidden w-[55%] flex-col justify-center gap-2 px-8 lg:flex"
      style={{
        maskImage: "linear-gradient(90deg, transparent 0%, #000 30%)",
        WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 30%)",
      }}
    >
      <div className="flex h-4 items-end justify-between border-b border-white/10 pb-1">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={cn("w-px bg-white/25", i % 4 === 0 ? "h-2.5" : "h-1.5")} />
        ))}
      </div>

      <div className="flex h-8">
        {overlay.map((c, i) => (
          <div
            key={i}
            className="h-full rounded-md"
            style={{
              marginLeft: `${c.o}%`,
              width: `${c.w}%`,
              background: `linear-gradient(90deg, hsl(${c.h} 70% 55%), hsl(${c.h + 20} 70% 42%))`,
            }}
          />
        ))}
      </div>

      <div className="flex h-16 gap-1">
        {video.map((c, i) => (
          <div
            key={i}
            className="relative overflow-hidden rounded-lg ring-1 ring-white/10"
            style={{
              width: `${c.w}%`,
              background: `linear-gradient(135deg, hsl(${c.h} 55% 42%), hsl(${c.h + 40} 50% 18%))`,
            }}
          >
            <div className="absolute inset-0 flex opacity-30">
              {Array.from({ length: 5 }, (_, k) => (
                <span key={k} className="h-full flex-1 border-r border-black/40" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex h-9 items-center gap-[2px] rounded-md bg-emerald-400/10 px-2">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full bg-emerald-400/70"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>

      <div className="absolute top-8 bottom-8 left-[52%] w-px bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.6)]">
        <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-white" />
      </div>
    </div>
  );
}

/* ───────── screen ───────── */

export function HomeScreen() {
  const goEditor = useAppShellStore((s) => s.goEditor);
  const homeTipDismissed = useAppShellStore((s) => s.homeTipDismissed);
  const dismissHomeTip = useAppShellStore((s) => s.dismissHomeTip);
  const newProject = useProjectStore((s) => s.newProject);
  const setProject = useProjectStore((s) => s.setProject);
  const setProjectPath = useProjectStore((s) => s.setProjectPath);
  const markClean = useProjectStore((s) => s.markClean);
  const clearHistory = useHistoryStore((s) => s.clear);
  const recent = useRecentProjectsStore((s) => s.recent);
  const rememberRecent = useRecentProjectsStore((s) => s.remember);
  const removeRecent = useRecentProjectsStore((s) => s.remove);

  const [rail, setRail] = useState<RailTab>("home");
  const [view, setView] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [library, setLibrary] = useState<LibraryProjectInfo[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("Untitled project");
  const [busy, setBusy] = useState<string | null>(null);
  const topRef = useRef<HTMLElement | null>(null);
  const recentRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const refreshLibrary = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLibrary([]);
      return;
    }
    try {
      const entries = await actionListLibraryProjects();
      setLibrary(entries);
      for (const entry of entries.slice(0, 12)) {
        rememberRecent(entry.path, entry.name);
      }
    } catch {
      /* ignore — recent localStorage still works */
    }
  }, [rememberRecent]);

  useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  const enterEditor = useCallback(() => {
    clearHistory();
    goEditor();
  }, [clearHistory, goEditor]);

  useEffect(() => {
    if (!createOpen) return;
    const id = window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 30);
    return () => window.clearTimeout(id);
  }, [createOpen]);

  const openCreateDialog = useCallback(() => {
    if (busy) return;
    setCreateName("Untitled project");
    setCreateOpen(true);
    setStatus(null);
    setStatusError(false);
  }, [busy]);

  const handleCreateConfirm = useCallback(async () => {
    const name = createName.trim() || "Untitled project";
    setCreateOpen(false);
    setBusy("Creating project…");
    setStatus(null);
    setStatusError(false);
    newProject(name, { width: 1920, height: 1080, frameRate: 30 });
    try {
      const project = useProjectStore.getState().project;
      const path = await actionEnsureLibraryProject(project);
      if (path) {
        useProjectStore.getState().setProjectPath(path);
        rememberRecent(path, project.name || name);
      }
      enterEditor();
    } catch (error) {
      setBusy(null);
      setStatus(formatActionError(error));
      setStatusError(true);
    }
  }, [createName, enterEditor, newProject, rememberRecent]);

  const loadOpened = useCallback(
    async (opened: {
      project: Awaited<ReturnType<typeof actionOpenProject>>["project"];
      path: string | null;
    }) => {
      setProject(opened.project, { dirty: false });
      setProjectPath(opened.path);
      markClean();
      if (opened.path) {
        rememberRecent(opened.path, opened.project.name || shortPath(opened.path));
      }
      enterEditor();
    },
    [enterEditor, markClean, rememberRecent, setProject, setProjectPath],
  );

  const handleOpen = useCallback(async () => {
    if (busy) return;
    try {
      setStatus(null);
      setStatusError(false);
      const opened = await actionOpenProject();
      setBusy("Opening project…");
      await loadOpened(opened);
    } catch (error) {
      setBusy(null);
      const msg = formatActionError(error);
      if (msg === "Open cancelled") {
        setStatus(null);
        return;
      }
      setStatus(msg);
      setStatusError(true);
    }
  }, [busy, loadOpened]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      if (busy) return;
      if (!isTauriRuntime()) {
        setStatus("Opening saved drafts needs the desktop app. Use Open project… for JSON.");
        setStatusError(true);
        return;
      }
      try {
        setBusy("Opening project…");
        setStatus(null);
        setStatusError(false);
        const opened = await actionOpenProjectAtPath(path);
        await loadOpened(opened);
      } catch (error) {
        setBusy(null);
        setStatus(formatActionError(error));
        setStatusError(true);
        removeRecent(path);
      }
    },
    [busy, loadOpened, removeRecent],
  );

  const drafts: Array<{
    path: string;
    name: string;
    openedAt: string;
    projectId?: string;
    canDeleteDisk: boolean;
  }> =
    library.length > 0
      ? library.map((e) => ({
          path: e.path,
          name: e.name,
          openedAt: e.updatedAt || new Date().toISOString(),
          projectId: e.id,
          canDeleteDisk: true,
        }))
      : recent.map((e) => ({ ...e, canDeleteDisk: false }));

  const q = query.trim().toLowerCase();
  const visibleDrafts = q
    ? drafts.filter((d) => (d.name || shortPath(d.path)).toLowerCase().includes(q))
    : drafts;

  const handleDeleteDraft = useCallback(
    async (entry: (typeof drafts)[number]) => {
      try {
        if (entry.canDeleteDisk || entry.projectId) {
          setStatus(`Deleting “${entry.name || shortPath(entry.path)}”…`);
          setStatusError(false);
          await actionDeleteLibraryProject({
            projectId: entry.projectId,
            path: entry.path,
            name: entry.name,
          });
          removeRecent(entry.path);
          await refreshLibrary();
          setStatus(`Deleted “${entry.name || shortPath(entry.path)}”`);
          setStatusError(false);
        } else {
          removeRecent(entry.path);
          setStatus(null);
        }
      } catch (error) {
        const msg = formatActionError(error);
        if (msg === "Delete cancelled") {
          setStatus(null);
          return;
        }
        setStatus(msg);
        setStatusError(true);
      }
    },
    [refreshLibrary, removeRecent],
  );

  const showTip = !homeTipDismissed && drafts.length === 0;

  const scrollTo = (tab: RailTab) => {
    setRail(tab);
    (tab === "drafts" ? recentRef : topRef).current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const navItem =
    "group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors";
  return (
    <div className="grid h-full w-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-1">
      {/* ───── Sidebar ───── */}
      <aside className="flex min-h-0 flex-col gap-6 border-b border-border bg-[var(--bg-rail)] p-4 md:border-r md:border-b-0">
        <div className="flex h-10 items-center gap-3 px-2">
          <CutlineLogo className="size-8" />
          <span className="text-base font-bold tracking-tight">Cutline</span>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Home">
          <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
            Library
          </p>

          {(
            [
              { id: "home" as const, label: "Home", Icon: HomeGlyph },
              { id: "drafts" as const, label: "Drafts", Icon: DraftsGlyph },
            ] as const
          ).map(({ id, label, Icon }) => {
            const active = rail === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => scrollTo(id)}
                className={cn(
                  navItem,
                  active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className={active ? "text-primary" : "group-hover:text-primary"}>
                  <Icon />
                </span>
                <span className="flex-1">{label}</span>
                {id === "drafts" && drafts.length > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">{drafts.length}</span>
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void handleOpen()}
            className={cn(navItem, "group text-muted-foreground hover:bg-accent hover:text-foreground")}
          >
            <ImportIcon size={18} />
            Open project…
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Saved on this PC
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Drafts auto-save with media copies. Exports are MP4 files you own.
          </p>
        </div>
      </aside>

      {/* ───── Main ───── */}
      <main ref={topRef} className="min-h-0 min-w-0 overflow-auto">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 p-8">
          {/* Hero */}
          <section
            aria-label="Create"
            className="relative min-h-[232px] overflow-hidden rounded-2xl border border-border bg-[var(--bg-panel)]"
          >
            <div className="absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_0%,rgba(62,166,255,0.22),transparent_60%)]" />
            <HeroTimeline />

            <div className="relative z-10 flex max-w-[520px] flex-col gap-5 p-8">
              <div className="flex flex-col gap-1.5">
                <h1 className="text-2xl leading-tight font-bold tracking-tight">Create project</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Start on a 16:9 canvas. You can change it later in project settings.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  className="h-11 gap-2 rounded-xl px-5 text-sm font-bold"
                  disabled={!!busy}
                  onClick={openCreateDialog}
                >
                  <PlusIcon size={16} />
                  New project
                </Button>
                <Button
                  variant="outline"
                  className="h-11 gap-2 rounded-xl px-5 text-sm font-semibold"
                  disabled={!!busy}
                  onClick={() => void handleOpen()}
                >
                  <ImportIcon size={16} />
                  Open project…
                </Button>
              </div>
            </div>
          </section>

          {showTip ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <InfoIcon size={16} />
              <span className="flex-1">
                Import clips from <b className="font-semibold text-foreground">Media</b>, trim and split on the{" "}
                <b className="font-semibold text-foreground">timeline</b>, then export an MP4.
              </span>
              <Button variant="ghost" size="sm" onClick={dismissHomeTip}>
                Dismiss
              </Button>
            </div>
          ) : null}

          {/* Drafts */}
          <section ref={recentRef} aria-label="Drafts" className="flex scroll-mt-8 flex-col gap-4">
            <div className="flex min-h-9 flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Drafts</h2>
              {drafts.length > 0 ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                  {drafts.length}
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <label className="flex h-9 w-[220px] items-center gap-2 rounded-lg border border-transparent bg-accent px-3 text-muted-foreground transition-colors focus-within:border-primary/50 focus-within:bg-card">
                  <SearchGlyph />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search drafts"
                    className="h-full w-full border-0 bg-transparent p-0 text-sm text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/70 focus:border-0 focus:shadow-none focus-visible:shadow-none focus-visible:ring-0"
                  />
                </label>
                <div className="flex h-9 items-center gap-1 rounded-lg bg-accent p-1">
                  {(
                    [
                      { id: "grid" as const, Icon: GridGlyph, label: "Grid view" },
                      { id: "list" as const, Icon: ListGlyph, label: "List view" },
                    ] as const
                  ).map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      type="button"
                      title={label}
                      aria-label={label}
                      aria-pressed={view === id}
                      onClick={() => setView(id)}
                      className={cn(
                        "grid size-7 place-items-center rounded-md transition-colors",
                        view === id
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {drafts.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-12 text-center">
                <span className="grid size-12 place-items-center rounded-xl bg-accent text-muted-foreground">
                  <MediaIcon size={22} />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-semibold">No drafts yet</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Projects auto-save here with a copy of your imported media.
                  </p>
                </div>
              </div>
            ) : visibleDrafts.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No drafts match “{query}”.
              </p>
            ) : view === "grid" ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
                {visibleDrafts.map((entry) => {
                  const name = entry.name || shortPath(entry.path);
                  return (
                    <li key={entry.path} className="group relative flex flex-col gap-3">
                      <button
                        type="button"
                        title={entry.path}
                        onClick={() => void handleOpenRecent(entry.path)}
                        className="relative block w-full overflow-hidden rounded-xl text-left ring-1 ring-border transition duration-200 group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-primary group-hover:shadow-[0_12px_30px_-12px_rgba(62,166,255,0.6)]"
                      >
                        <DraftThumb seed={entry.path} label={name} />
                        <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
                          <span className="grid size-10 place-items-center rounded-full bg-white text-black">
                            <PlayGlyph />
                          </span>
                        </span>
                      </button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-2 right-2 rounded-md bg-black/60 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-destructive hover:text-white focus-visible:opacity-100"
                        title={entry.canDeleteDisk ? "Delete project permanently" : "Remove from recent list"}
                        aria-label={entry.canDeleteDisk ? `Delete ${name}` : `Remove ${name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteDraft(entry);
                        }}
                      >
                        <TrashIcon size={14} />
                      </Button>

                      <div className="flex flex-col gap-0.5 px-1">
                        <p className="truncate text-sm font-medium">{name}</p>
                        <p className="text-xs text-muted-foreground">{formatRelative(entry.openedAt)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
                {visibleDrafts.map((entry) => {
                  const name = entry.name || shortPath(entry.path);
                  return (
                    <li
                      key={entry.path}
                      className="group flex items-center gap-4 p-3 transition-colors hover:bg-accent"
                    >
                      <button
                        type="button"
                        title={entry.path}
                        onClick={() => void handleOpenRecent(entry.path)}
                        className="flex min-w-0 flex-1 items-center gap-4 text-left"
                      >
                        <DraftThumb seed={entry.path} label={name} className="w-28 shrink-0 rounded-lg" />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">{name}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {formatRelative(entry.openedAt)}
                            {library.length === 0 ? ` · ${entry.path}` : ""}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                        title={entry.canDeleteDisk ? "Delete project permanently" : "Remove from recent list"}
                        aria-label={entry.canDeleteDisk ? `Delete ${name}` : `Remove ${name}`}
                        onClick={() => void handleDeleteDraft(entry)}
                      >
                        <TrashIcon size={14} />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {status ? (
            <p
              role="status"
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
                statusError
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <InfoIcon size={16} />
              {status}
            </p>
          ) : null}
        </div>
      </main>

      {createOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[10000] grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
              role="presentation"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget && !busy) setCreateOpen(false);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-project-title"
                className="w-full max-w-[400px] rounded-2xl border border-border bg-[var(--bg-panel)] p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h2 id="create-project-title" className="text-lg font-bold tracking-tight">
                  New project
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Name your project. Starts on a 16:9 · 1920×1080 canvas.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Label htmlFor="create-project-name">Project name</Label>
                  <Input
                    ref={nameInputRef}
                    id="create-project-name"
                    className="h-10"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Untitled project"
                    maxLength={120}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateConfirm();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setCreateOpen(false);
                      }
                    }}
                  />
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => setCreateOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="rounded-xl font-semibold"
                    onClick={() => void handleCreateConfirm()}
                  >
                    Create
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {busy
        ? createPortal(
            <div
              className="fixed inset-0 z-[10001] grid place-items-center bg-black/60 backdrop-blur-[2px]"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-[var(--bg-panel)] px-8 py-7 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)]">
                <span className="text-primary">
                  <SpinnerGlyph size={28} />
                </span>
                <p className="text-sm font-semibold text-foreground">{busy}</p>
                <p className="text-xs text-muted-foreground">Opening the editor…</p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}