import { useCallback, useRef, useState } from "react";
import { CutlineLogo } from "@/components/CutlineLogo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ExportIcon,
  ImportIcon,
  InfoIcon,
  MediaIcon,
  SplitIcon,
  TrashIcon,
} from "@/components/icons";
import {
  actionOpenProject,
  actionOpenProjectAtPath,
  formatActionError,
} from "../../lib/projectActions";
import { isTauriRuntime } from "../../lib/tauri";
import { useAppShellStore } from "../../stores/appShellStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import { useRecentProjectsStore } from "../../stores/recentProjectsStore";

type RailTab = "start" | "recent";

const ASPECTS = [
  { id: "16x9", label: "16:9", hint: "Landscape · 1920×1080", width: 1920, height: 1080 },
  { id: "9x16", label: "9:16", hint: "Portrait · 1080×1920", width: 1080, height: 1920 },
  { id: "1x1", label: "1:1", hint: "Square · 1080×1080", width: 1080, height: 1080 },
] as const;

const FIRST_STEPS = [
  { Icon: MediaIcon, title: "Import", body: "Bring clips in from Media" },
  { Icon: SplitIcon, title: "Arrange", body: "Trim & split on the timeline" },
  { Icon: ExportIcon, title: "Export", body: "Render a finished MP4" },
] as const;

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

  const [rail, setRail] = useState<RailTab>("start");
  const [status, setStatus] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const topRef = useRef<HTMLElement | null>(null);
  const recentRef = useRef<HTMLElement | null>(null);

  const enterEditor = useCallback(() => {
    clearHistory();
    goEditor();
  }, [clearHistory, goEditor]);

  const handleCreate = useCallback(
    (width: number, height: number) => {
      newProject("Untitled project", { width, height, frameRate: 30 });
      setStatus(null);
      setStatusError(false);
      enterEditor();
    },
    [enterEditor, newProject],
  );

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
    try {
      setStatus(isTauriRuntime() ? "Opening…" : "Choose a project JSON…");
      setStatusError(false);
      const opened = await actionOpenProject();
      await loadOpened(opened);
    } catch (error) {
      const msg = formatActionError(error);
      if (msg === "Open cancelled") {
        setStatus(null);
        return;
      }
      setStatus(msg);
      setStatusError(true);
    }
  }, [loadOpened]);

  const handleOpenRecent = useCallback(
    async (path: string) => {
      if (!isTauriRuntime()) {
        setStatus(
          "Opening saved drafts needs the desktop app. Use Open project… for JSON.",
        );
        setStatusError(true);
        return;
      }
      try {
        setStatus("Opening…");
        setStatusError(false);
        const opened = await actionOpenProjectAtPath(path);
        await loadOpened(opened);
      } catch (error) {
        setStatus(formatActionError(error));
        setStatusError(true);
        removeRecent(path);
      }
    },
    [loadOpened, removeRecent],
  );

  const showTip = !homeTipDismissed && recent.length === 0;

  const scrollTo = (tab: RailTab) => {
    setRail(tab);
    (tab === "recent" ? recentRef : topRef).current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="grid h-full w-full grid-cols-1 bg-background text-foreground md:grid-cols-[248px_minmax(0,1fr)]">
      {/* Rail */}
      <aside className="flex min-h-0 flex-col gap-5 border-b border-border bg-[var(--bg-rail)] px-4 py-5 md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-1">
          <CutlineLogo className="size-9" />
          <span className="text-base font-extrabold tracking-tight text-foreground">
            Cutline
          </span>
        </div>

        <Button
          size="lg"
          className="w-full font-bold"
          onClick={() => handleCreate(1920, 1080)}
        >
          <span className="text-base leading-none">+</span>
          New video
        </Button>

        <nav className="flex flex-col gap-0.5" aria-label="Home">
          {(
            [
              { id: "start" as const, label: "Start" },
              { id: "recent" as const, label: `Recent (${recent.length})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "h-9 rounded-md px-3 text-left text-sm font-semibold transition-colors",
                rail === item.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => scrollTo(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-border bg-card px-3.5 py-3">
          <p className="mb-1 text-[11px] font-bold tracking-[0.12em] text-primary uppercase">
            Local-first
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Projects stay on this PC. Exports are plain MP4 files you own.
          </p>
        </div>
      </aside>

      {/* Main */}
      <main
        ref={topRef}
        className={cn(
          "min-h-0 min-w-0 overflow-auto px-6 py-8 sm:px-10",
          "bg-[radial-gradient(ellipse_70%_40%_at_100%_0%,rgba(62,166,255,0.08),transparent_55%)]",
        )}
      >
        <header className="mb-7 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="mb-1 text-[11px] font-bold tracking-[0.16em] text-primary uppercase">
              Projects
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              What are we cutting today?
            </h1>
          </div>
          <span className="text-sm text-muted-foreground">Local video editor</span>
        </header>

        <section
          className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]"
          aria-label="Quick actions"
        >
          {/* Create */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-[linear-gradient(150deg,rgba(62,166,255,0.14),rgba(62,166,255,0.03)_60%),var(--bg-panel)] p-6">
            <span className="mb-1 block text-[11px] font-bold tracking-[0.14em] text-primary uppercase">
              New project
            </span>
            <h2 className="mb-1 text-xl font-bold text-foreground">Create new video</h2>
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Pick a canvas — change it later in project settings.
            </p>
            <div className="flex flex-wrap gap-2.5">
              {ASPECTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.hint}
                  onClick={() => handleCreate(a.width, a.height)}
                  className={cn(
                    "group flex min-w-[104px] flex-1 flex-col items-center gap-2 rounded-xl border border-border bg-background/60 px-4 py-3.5",
                    "transition-colors hover:border-primary hover:bg-primary/10",
                  )}
                >
                  <span
                    aria-hidden
                    className="block border-2 border-muted-foreground/50 bg-primary/10 transition-colors group-hover:border-primary"
                    style={{
                      width: a.width >= a.height ? 44 : 26,
                      height: a.width >= a.height ? 25 : 44,
                      borderRadius: a.id === "1x1" ? 6 : 3,
                    }}
                  />
                  <span className="text-xs font-bold text-foreground">{a.label}</span>
                  <span className="text-[11px] text-muted-foreground">{a.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Open */}
          <button
            type="button"
            onClick={() => void handleOpen()}
            className={cn(
              "flex min-h-[160px] flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6 text-left",
              "transition-colors hover:border-primary/50 hover:bg-accent/40",
            )}
          >
            <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary">
              <ImportIcon size={18} />
            </span>
            <span>
              <span className="mb-1 block text-xl font-bold text-foreground">
                Open project…
              </span>
              <span className="block text-sm leading-relaxed text-muted-foreground">
                {isTauriRuntime()
                  ? "Open a .cutline.json from disk."
                  : "Open a project JSON in the browser."}
              </span>
            </span>
          </button>
        </section>

        {showTip ? (
          <section
            className="mb-6 rounded-2xl border border-border bg-card p-6"
            aria-label="Getting started"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-base font-bold text-foreground">
                Your first video in three steps
              </h2>
              <Button variant="ghost" size="sm" onClick={dismissHomeTip}>
                Dismiss
              </Button>
            </div>
            <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {FIRST_STEPS.map(({ Icon, title, body }, i) => (
                <li
                  key={title}
                  className="flex items-start gap-3 rounded-xl border border-border bg-background/60 px-4 py-3.5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-sm font-extrabold text-primary">
                    {i + 1}
                  </span>
                  <span>
                    <span className="mb-0.5 flex items-center gap-1.5 text-sm font-bold text-foreground">
                      <Icon size={13} />
                      {title}
                    </span>
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {body}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section ref={recentRef} aria-label="Recent drafts" className="scroll-mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Recent drafts</h2>
            {recent.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {recent.length} project{recent.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <MediaIcon size={20} />
              </span>
              <p className="text-sm font-bold text-foreground">Nothing here yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create a video above or open a project — it will show up here for
                quick access.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((entry) => (
                <li
                  key={entry.path}
                  className="group flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/50"
                >
                  <span
                    aria-hidden
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/12 font-extrabold text-primary"
                  >
                    {(entry.name || shortPath(entry.path)).slice(0, 1).toUpperCase()}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    title={entry.path}
                    onClick={() => void handleOpenRecent(entry.path)}
                  >
                    <span className="block truncate text-sm font-bold text-foreground">
                      {entry.name || shortPath(entry.path)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {entry.path} · {formatRelative(entry.openedAt)}
                    </span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    title="Remove from list"
                    aria-label={`Remove ${entry.name || shortPath(entry.path)}`}
                    onClick={() => removeRecent(entry.path)}
                  >
                    <TrashIcon size={13} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {status ? (
          <p
            role="status"
            className={cn(
              "mt-6 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
              statusError
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <InfoIcon size={15} />
            {status}
          </p>
        ) : null}
      </main>
    </div>
  );
}
