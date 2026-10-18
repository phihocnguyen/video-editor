import { useMemo, useState } from "react";
import {
  addFilterOverlay,
  clipDurationTicks,
  filterClipAt,
  findMatchingFilterTemplate,
  FILTER_TEMPLATES,
  FILTER_TEMPLATE_GROUPS,
  recolorFilterClip,
  removeFilterClips,
  type Clip,
  type FilterTemplate,
  type FilterTemplateGroup,
  type ProjectDocument,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { BoothPanel } from "./BoothPanel";

function filterSpan(
  project: ProjectDocument,
  selectedIds: readonly string[],
  playheadTicks: number,
  markIn: number | null,
  markOut: number | null,
): { start: number; duration: number } {
  if (markIn != null && markOut != null && markOut > markIn) {
    return { start: markIn, duration: markOut - markIn };
  }
  const media = selectedIds
    .map((id) => project.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => clip?.kind === "media");
  if (media.length > 0) {
    const start = Math.min(...media.map((clip) => clip.startTicks));
    const end = Math.max(...media.map((clip) => clip.startTicks + clipDurationTicks(clip)));
    return { start, duration: Math.max(100_000, end - start) };
  }
  return { start: Math.max(0, playheadTicks), duration: 5_000_000 };
}

function LookThumb({ wash }: { wash: string }) {
  return (
    <div
      className="relative aspect-[3/2] w-full overflow-hidden rounded-md"
      style={{ background: wash }}
    />
  );
}

export function TemplatePanel() {
  const project = useProjectStore((s) => s.project);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const [group, setGroup] = useState<"all" | FilterTemplateGroup>("all");
  const [tab, setTab] = useState<"looks" | "booth">("booth");

  const activeId = useMemo(() => {
    const selected = project.clips.find(
      (clip) => clip.kind === "filter" && selectedClipIds.includes(clip.id),
    );
    const clip = selected ?? filterClipAt(project, playheadTicks);
    if (!clip) return null;
    return findMatchingFilterTemplate(clip.effects)?.id ?? null;
  }, [playheadTicks, project, selectedClipIds]);

  const visible = useMemo(
    () =>
      FILTER_TEMPLATES.filter(
        (template) => template.id !== "none" && (group === "all" || template.group === group),
      ),
    [group],
  );

  function handleApply(template: FilterTemplate) {
    const current = useProjectStore.getState().project;
    const selected = useEditorUiStore.getState().selectedClipIds;
    const playhead = useEditorUiStore.getState().playheadTicks;
    const markIn = useEditorUiStore.getState().markInTicks;
    const markOut = useEditorUiStore.getState().markOutTicks;
    const selectedFilters = current.clips.filter(
      (clip) => clip.kind === "filter" && selected.includes(clip.id),
    );

    if (template.id === "none") {
      const ids =
        selectedFilters.length > 0
          ? selectedFilters.map((clip) => clip.id)
          : [filterClipAt(current, playhead)?.id].filter((id): id is string => Boolean(id));
      if (ids.length === 0) {
        setStatusMessage("No filter clip to clear");
        return;
      }
      commitProjectChange((project) => removeFilterClips(project, ids));
      setSelectedClipIds([]);
      setStatusMessage("Filter removed");
      return;
    }

    if (selectedFilters.length > 0 && (markIn == null || markOut == null || markOut <= markIn)) {
      commitProjectChange((project) => {
        let next = project;
        for (const clip of selectedFilters) next = recolorFilterClip(next, clip.id, template.id);
        return next;
      });
      setStatusMessage(
        selectedFilters.length > 1
          ? `${template.label} · ${selectedFilters.length} clips`
          : template.label,
      );
      return;
    }

    const span = filterSpan(current, selected, playhead, markIn, markOut);
    let clipId = "";
    commitProjectChange((project) => {
      const added = addFilterOverlay(project, template.id, span.start, span.duration);
      clipId = added.clipId;
      return added.project;
    });
    if (!clipId) {
      setStatusMessage("Could not add a filter track");
      return;
    }
    setSelectedClipIds([clipId]);
    setStatusMessage(`${template.label} · Filter track`);
  }

  const original = FILTER_TEMPLATES[0]!;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      <div className="flex gap-1" role="tablist" aria-label="Template type">
        {(["booth", "looks"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? "rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                : "rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            }
          >
            {t === "booth" ? "Photo booth" : "Looks"}
          </button>
        ))}
      </div>
      {tab === "booth" ? (
        <BoothPanel />
      ) : (
      <>
      <div>
        <h2 className="text-[15px] font-bold text-foreground">Template</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Adds a Filter track over the picture. Trim that clip when you only want one section filtered. Mark In and Out set the section first.
        </p>
      </div>

      <div className="flex flex-wrap gap-1" role="tablist">
        {FILTER_TEMPLATE_GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={group === item.id}
            onClick={() => setGroup(item.id)}
            className={
              group === item.id
                ? "rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                : "rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        title={original.hint}
        onClick={() => handleApply(original)}
        className={
          activeId === "none"
            ? "flex items-center gap-2 rounded-lg border border-primary bg-accent px-2 py-1.5 text-left"
            : "flex items-center gap-2 rounded-lg border border-border bg-secondary px-2 py-1.5 text-left hover:border-primary/50"
        }
      >
        <span
          className="size-8 shrink-0 rounded-md"
          style={{ background: original.swatch }}
        />
        <span className="text-xs font-semibold">{original.label}</span>
      </button>

      <div className="grid grid-cols-2 gap-2">
        {visible.map((template) => {
          const active = activeId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              title={template.hint}
              onClick={() => handleApply(template)}
              className={
                active
                  ? "flex flex-col gap-1.5 rounded-lg border border-primary bg-accent p-1.5 text-left"
                  : "flex flex-col gap-1.5 rounded-lg border border-border bg-secondary p-1.5 text-left hover:border-primary/50"
              }
            >
              <LookThumb wash={template.swatch} />
              <span className="truncate px-0.5 text-[11px] font-semibold">{template.label}</span>
            </button>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
