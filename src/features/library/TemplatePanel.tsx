import { useMemo, useState } from "react";
import {
  addFilterOverlay,
  addTextClip,
  applyEffectPreset,
  applyTransformPatch,
  clipDurationTicks,
  createDefaultTextStyle,
  EFFECT_PRESETS,
  effectsMatchPreset,
  filterClipAt,
  findMatchingFilterTemplate,
  FILTER_TEMPLATES,
  FILTER_TEMPLATE_GROUPS,
  normalizeTextAnimation,
  normalizeTextStyle,
  recolorFilterClip,
  removeFilterClips,
  updateClipEffects,
  updateClipText,
  type Clip,
  type EffectPreset,
  type FilterTemplate,
  type FilterTemplateGroup,
  type ProjectDocument,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { TextEffectThumb } from "../effects/TextEffectThumb";
import { BoothPanel } from "./BoothPanel";
import { TEXT_EFFECT_PRESETS } from "./presets";

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
  const [tab, setTab] = useState<"text" | "looks" | "booth">("looks");

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

  const selectedEffectClips = useMemo(
    () =>
      project.clips.filter((clip) => {
        if (clip.kind !== "media" || !selectedClipIds.includes(clip.id)) {
          return false;
        }
        const asset = project.assets.find((item) => item.id === clip.assetId);
        return asset?.kind !== "audio";
      }),
    [project, selectedClipIds],
  );

  const activeEffectId =
    selectedEffectClips.length === 1
      ? EFFECT_PRESETS.find((preset) =>
          effectsMatchPreset(selectedEffectClips[0]!.effects, preset),
        )?.id ?? null
      : null;

  function handleEffectPreset(preset: EffectPreset) {
    const current = useProjectStore.getState().project;
    const selected = useEditorUiStore.getState().selectedClipIds;
    const targets = current.clips.filter((clip) => {
      if (clip.kind !== "media" || !selected.includes(clip.id)) return false;
      const asset = current.assets.find((item) => item.id === clip.assetId);
      return asset?.kind !== "audio";
    });
    if (targets.length === 0) {
      setStatusMessage("Select a video or image clip first");
      return;
    }
    commitProjectChange((project) => {
      let next = project;
      for (const clip of targets) {
        next = updateClipEffects(
          next,
          clip.id,
          applyEffectPreset(clip.effects, preset),
        );
      }
      return next;
    });
    setStatusMessage(
      targets.length > 1
        ? `${preset.label} · ${targets.length} clips`
        : preset.label,
    );
  }

  function handleTextPreset(preset: (typeof TEXT_EFFECT_PRESETS)[number]) {
    const current = useProjectStore.getState().project;
    const playhead = useEditorUiStore.getState().playheadTicks;
    const selected = useEditorUiStore.getState().selectedClipIds;
    const textClip =
      selected.length === 1
        ? current.clips.find(
            (clip) => clip.id === selected[0] && clip.kind === "text",
          )
        : null;

    if (textClip) {
      const style = normalizeTextStyle(textClip.text);
      const content = style.content.trim() ? style.content : preset.text.content;
      commitProjectChange((project) => {
        let next = updateClipText(
          project,
          textClip.id,
          normalizeTextStyle({
            ...createDefaultTextStyle(content),
            ...preset.text,
            content,
            textAnimation: normalizeTextAnimation(
              style.textAnimation ?? null,
            ),
          }),
        );
        if (preset.blendMode) {
          next = applyTransformPatch(
            next,
            textClip.id,
            { blendMode: preset.blendMode },
            playhead,
          );
        }
        return next;
      });
      setStatusMessage(`Applied · ${preset.label}`);
      return;
    }

    let createdId = "";
    commitProjectChange((project) => {
      const next = addTextClip(project, {
        startTicks: playhead,
          text: {
            ...createDefaultTextStyle(preset.text.content),
            ...preset.text,
            textAnimation: normalizeTextAnimation(null),
          },
        transform: preset.blendMode
          ? { blendMode: preset.blendMode }
          : undefined,
      });
      createdId = next.clips[next.clips.length - 1]?.id ?? "";
      return next;
    });
    if (createdId) setSelectedClipIds([createdId]);
    setStatusMessage(`Added · ${preset.label}`);
  }

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
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Template type">
        {(
          [
            { id: "looks", label: "Looks" },
            { id: "text", label: "Text" },
            { id: "booth", label: "Photo booth" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={
              tab === item.id
                ? "rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
                : "rounded-full px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "text" ? (
        <>
          <div>
            <h2 className="text-[15px] font-bold text-foreground">Text templates</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Ready-made text colors and styles. Click a look to apply it to the
              selected text, or add a new title at the playhead.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {TEXT_EFFECT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                onClick={() => handleTextPreset(preset)}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary p-1.5 text-left hover:border-primary/50"
              >
                <TextEffectThumb
                  label={preset.text.content}
                  color={preset.text.color ?? "#FFE566"}
                  swatch={preset.swatch}
                  blendMode={preset.blendMode}
                />
                <span className="truncate px-0.5 text-[11px] font-semibold">
                  {preset.label}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : tab === "booth" ? (
        <BoothPanel />
      ) : (
        <>
          <div>
            <h2 className="text-[15px] font-bold text-foreground">Looks</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Apply Montage, Cyber Glow and other color looks to the selected
              video or image clips. Color washes add a Filter track you can trim.
            </p>
          </div>

          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Color looks
          </div>
          <div className="grid grid-cols-2 gap-2">
            {EFFECT_PRESETS.map((preset) => {
              const active = activeEffectId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.label}
                  onClick={() => handleEffectPreset(preset)}
                  className={
                    active
                      ? "flex flex-col gap-1.5 rounded-lg border border-primary bg-accent p-1.5 text-left"
                      : "flex flex-col gap-1.5 rounded-lg border border-border bg-secondary p-1.5 text-left hover:border-primary/50"
                  }
                >
                  <LookThumb wash={preset.swatch} />
                  <span className="truncate px-0.5 text-[11px] font-semibold">
                    {preset.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Color washes
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
                  <span className="truncate px-0.5 text-[11px] font-semibold">
                    {template.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
