import { useMemo, useState } from "react";
import {
  STRIP_TEMPLATES,
  applyStripTemplate,
  swapStripCellByClip,
  type LayoutTemplate,
} from "../../domain";
import { actionImportMedia, formatActionError } from "../../lib/projectActions";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";

function MiniFrame({ template }: { template: LayoutTemplate }) {
  return (
    <div
      className="relative aspect-[9/16] w-full overflow-hidden rounded-md bg-black"
      style={
        template.frame
          ? { borderLeft: "5px solid #1a1a1a", borderRight: "5px solid #1a1a1a" }
          : undefined
      }
      aria-hidden
    >
      {template.slots.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-[1px]"
          style={{
            left: `${s.x * 100}%`,
            top: `${s.y * 100}%`,
            width: `${s.w * 100}%`,
            height: `${s.h * 100}%`,
            background: template.twin && i < template.slotCount ? "#8a8f98" : "#c9ced6",
          }}
        />
      ))}
      {template.twin ? (
        <div className="absolute inset-y-0 left-1/2 w-px bg-black" />
      ) : null}
    </div>
  );
}

export function StripPanel() {
  const project = useProjectStore((s) => s.project);
  const projectId = useProjectStore((s) => s.project.id);
  const addAssets = useProjectStore((s) => s.addAssets);
  const setProjectPath = useProjectStore((s) => s.setProjectPath);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);

  const [templateId, setTemplateId] = useState("film-pair-8");
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const template = useMemo(
    () => STRIP_TEMPLATES.find((t) => t.id === templateId) ?? STRIP_TEMPLATES[0]!,
    [templateId],
  );

  const binFiles = useMemo(
    () => project.assets.filter((a) => (a.kind === "video" || a.kind === "image") && !a.missing),
    [project.assets],
  );
  const picked = useMemo(
    () => pickedIds.map((id) => binFiles.find((a) => a.id === id)).filter((a) => a != null),
    [pickedIds, binFiles],
  );

  // Slice D: current project strip cells (survives save/reopen via crop+slotId).
  const stripCells = useMemo(
    () => project.clips.filter((c) => c.kind === "media" && c.crop && c.slotId),
    [project.clips],
  );
  const [swapClipId, setSwapClipId] = useState<string | null>(null);
  const [swapAssetId, setSwapAssetId] = useState<string | null>(null);
  const selectedStripClip = selectedClipIds
    .map((id) => stripCells.find((c) => c.id === id))
    .find((c) => c != null);
  const activeSwapClipId = selectedStripClip?.id ?? swapClipId;

  function togglePick(id: string) {
    setPickedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleImport() {
    setBusy(true);
    try {
      const imported = await actionImportMedia(projectId);
      if (imported.length === 0) {
        setStatusMessage("Import cancelled");
        return;
      }
      addAssets(imported);
      const usable = imported.filter((a) => a.kind === "video" || a.kind === "image");
      setPickedIds((prev) => [...prev, ...usable.map((a) => a.id)]);
      setStatusMessage(`Imported ${imported.length} media file(s)`);
    } catch (error) {
      setStatusMessage(formatActionError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleApply() {
    if (picked.length === 0) {
      setStatusMessage(`Pick at least 1 file for ${template.label}`);
      return;
    }
    const placed = picked.slice(0, template.slotCount);
    const next = applyStripTemplate(template, placed);
    // Applier is pure (assets carry only geometry inputs) — attach the real
    // bin assets here so preview/export can resolve paths.
    next.assets = [...placed, ...next.assets];
    commitProjectChange(() => next);
    setProjectPath(null);
    setPlaying(false);
    setPlayheadTicks(0);
    setSelectedClipIds([]);
    const empty = template.slotCount - placed.length;
    setStatusMessage(
      empty > 0
        ? `${template.label} · ${placed.length} placed, ${empty} cell(s) empty`
        : `${template.label} · ${placed.length} video(s) placed`,
    );
  }

  function handleSwap() {
    if (!activeSwapClipId || !swapAssetId) {
      setStatusMessage("Pick a cell and a replacement file");
      return;
    }
    const asset = binFiles.find((a) => a.id === swapAssetId);
    if (!asset) return;
    commitProjectChange((p) => swapStripCellByClip(p, activeSwapClipId, asset));
    setStatusMessage(`Cell replaced · ${asset.name}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-foreground">Strip templates</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Drop that many clips. The app opens a normal 9:16 project with every cell filled — no
          music. You can still edit the result on the timeline.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {STRIP_TEMPLATES.filter((t) => t.slotCount <= 8).map((t) => {
          const active = t.id === template.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTemplateId(t.id);
                setPickedIds([]);
              }}
              className={
                active
                  ? "flex flex-col gap-1.5 rounded-lg border border-primary bg-accent p-1.5 text-left"
                  : "flex flex-col gap-1.5 rounded-lg border border-border bg-secondary p-1.5 text-left hover:border-primary/50"
              }
            >
              <MiniFrame template={t} />
              <span className="truncate px-0.5 text-[11px] font-semibold">
                {t.slotCount} videos{t.twin ? " ×2" : ""}
              </span>
              <span className="truncate px-0.5 text-[10px] text-muted-foreground">
                {t.frame ? (t.twin ? "Film pair" : "Film") : "Strip"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-secondary p-2">
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
            {template.label} · needs {template.slotCount}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleImport()}
            className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import files"}
          </button>
        </div>
        {binFiles.length === 0 ? (
          <p className="py-1 text-[11px] text-muted-foreground">
            Media bin is empty — import files first.
          </p>
        ) : (
          <ol className="flex max-h-40 flex-col gap-1 overflow-auto">
            {binFiles.map((a, i) => {
              const order = pickedIds.indexOf(a.id);
              const checked = order >= 0;
              return (
                <li key={a.id} className="min-w-0 shrink-0">
                  <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[11px] hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePick(a.id)}
                      aria-label={`Use ${a.name} in strip`}
                      className="shrink-0"
                    />
                    <span
                      className={
                        checked
                          ? "flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
                          : "flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground"
                      }
                    >
                      {checked ? order + 1 : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {a.name} · {a.kind}
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>
        )}
        <button
          type="button"
          disabled={picked.length === 0}
          onClick={handleApply}
          className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {picked.length === 0
            ? `Pick files for ${template.label}`
            : picked.length < template.slotCount
              ? `Create · ${picked.length}/${template.slotCount} (${template.slotCount - picked.length} empty)`
              : `Create · ${template.slotCount} video(s)`}
        </button>
        {picked.length > template.slotCount ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Extra files stay in the media bin, unplaced.
          </p>
        ) : null}
      </div>

      {stripCells.length > 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-2">
          <span className="text-xs font-semibold">Replace one cell</span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {selectedStripClip
              ? `Cell ${selectedStripClip.slotId} selected on timeline`
              : "Or pick a cell below, then a replacement file."}
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <select
              value={activeSwapClipId ?? ""}
              onChange={(e) => setSwapClipId(e.target.value || null)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
              aria-label="Strip cell"
            >
              <option value="">Pick a cell…</option>
              {stripCells.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.slotId}
                </option>
              ))}
            </select>
            <select
              value={swapAssetId ?? ""}
              onChange={(e) => setSwapAssetId(e.target.value || null)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
              aria-label="Replacement file"
            >
              <option value="">Pick a replacement file…</option>
              {binFiles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.kind}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!activeSwapClipId || !swapAssetId}
              onClick={handleSwap}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              Replace cell
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
