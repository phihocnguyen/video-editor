import { useMemo, useState, type ReactNode } from "react";
import {
  BOOTH_CANVAS,
  BOOTH_DEFAULT_BACKGROUND,
  BOOTH_FRAMES,
  BOOTH_PAPER_ID,
  BOOTH_PATTERNS,
  BOOTH_THEMES,
  applyBoothTemplate,
  boothDecorCenter,
  boothDecorsForTheme,
  boothLayout,
  boothThemeById,
  isStripGeneratedAsset,
  swapStripCellByClip,
  type BoothTheme,
} from "../../domain";
import { localExportHealth, localImportFile } from "../../lib/localExport";
import { rememberBrowserObjectUrl } from "../../lib/mediaUrl";
import { actionImportMedia, formatActionError } from "../../lib/projectActions";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";

const PHOTO_COUNTS = [1, 2, 3, 4, 6, 8];

/** Inline SVG string → data URL, for sticker previews in `<img>`. */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function svgToPngFile(svg: string, width: number, height: number, name: string): Promise<File> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Could not draw a booth sticker"));
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not draw a booth sticker"));
          return;
        }
        resolve(new File([blob], name, { type: "image/png" }));
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not draw a booth sticker"));
    };
    image.src = url;
  });
}

function renderBoothPaper(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not draw the booth paper"));
  ctx.clearRect(0, 0, width, height);
  const radius = Math.max(8, Math.round(width * 0.02));
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, radius);
  ctx.fill();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not draw the booth paper"));
        return;
      }
      resolve(new File([blob], "booth-paper.png", { type: "image/png" }));
    }, "image/png");
  });
}

/** Theme thumbnail: the real background, card and stickers at 4:5. */
function ThemeThumb({ theme }: { theme: BoothTheme }) {
  const layout = boothLayout({
    upright: theme.upright,
    stickerMargin: theme.decors.length > 0,
  });
  const cw = layout.canvas.width;
  const ch = layout.canvas.height;
  const backdrop = theme.decors.find((decor) => decor.anchor === "backdrop");
  const stickers = theme.decors.filter((decor) => decor.anchor !== "backdrop");
  const paper = layout.paper;
  return (
    <div
      className="relative aspect-[9/16] w-full overflow-hidden rounded-md"
      style={{ background: theme.background }}
      aria-hidden
    >
      {backdrop ? (
        <img
          src={svgDataUrl(backdrop.svg)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div
        className="absolute flex flex-col gap-[3px] bg-white p-[3px]"
        style={{
          left: `${((paper.x + paper.w / 2) / cw) * 100}%`,
          top: `${((paper.y + paper.h / 2) / ch) * 100}%`,
          width: `${(paper.w / cw) * 100}%`,
          height: `${(paper.h / ch) * 100}%`,
          transform: `translate(-50%, -50%) rotate(${layout.rotationDeg}deg)`,
        }}
      >
        {layout.cells.map((_, i) => (
          <div key={i} className="w-full flex-1 bg-[#b7bcc2]" />
        ))}
      </div>
      {stickers.map((decor) => {
        const center = boothDecorCenter(decor, paper, layout.canvas);
        return (
          <img
            key={decor.id}
            src={svgDataUrl(decor.svg)}
            alt=""
            draggable={false}
            className="pointer-events-none absolute"
            style={{
              left: `${((center.x - decor.width / 2) / cw) * 100}%`,
              top: `${((center.y - decor.height / 2) / ch) * 100}%`,
              width: `${(decor.width / cw) * 100}%`,
              transform: `rotate(${decor.rotation}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground"
          : "rounded-full bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}

export function BoothPanel() {
  const project = useProjectStore((s) => s.project);
  const projectId = useProjectStore((s) => s.project.id);
  const addAssets = useProjectStore((s) => s.addAssets);
  const setProjectPath = useProjectStore((s) => s.setProjectPath);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setPlayheadTicks = useEditorUiStore((s) => s.setPlayheadTicks);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);

  const [themeId, setThemeId] = useState("love");
  const theme = boothThemeById(themeId);
  const [background, setBackground] = useState(theme.background);
  const [durationSec, setDurationSec] = useState(10);
  const [grayscale, setGrayscale] = useState(theme.grayscale);
  const [decorGroups, setDecorGroups] = useState<string[]>(theme.groups.map((g) => g.id));
  const [photoCount, setPhotoCount] = useState(4);
  const [columns, setColumns] = useState(1);
  const [patternId, setPatternId] = useState<string | null>(theme.pattern ?? null);
  const [frameId, setFrameId] = useState<string | null>(theme.frame ?? null);
  const [title, setTitle] = useState("");
  const [titleColor, setTitleColor] = useState(theme.titleColor);
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const binFiles = useMemo(
    () =>
      project.assets.filter(
        (a) =>
          (a.kind === "video" || a.kind === "image") &&
          !a.missing &&
          !isStripGeneratedAsset(a.id),
      ),
    [project.assets],
  );
  const picked = useMemo(
    () => pickedIds.map((id) => binFiles.find((a) => a.id === id)).filter((a) => a != null),
    [pickedIds, binFiles],
  );

  const boothCells = useMemo(
    () => project.clips.filter((c) => c.kind === "media" && c.crop && c.slotId),
    [project.clips],
  );
  const [swapClipId, setSwapClipId] = useState<string | null>(null);
  const [swapAssetId, setSwapAssetId] = useState<string | null>(null);
  const selectedCell = selectedClipIds
    .map((id) => boothCells.find((c) => c.id === id))
    .find((c) => c != null);
  const activeSwapClipId = selectedCell?.id ?? swapClipId;

  function selectTheme(id: string) {
    const next = boothThemeById(id);
    setThemeId(next.id);
    setBackground(next.background);
    setGrayscale(next.grayscale);
    setDecorGroups(next.groups.map((group) => group.id));
    setTitleColor(next.titleColor);
    setPatternId(next.pattern ?? null);
    setFrameId(next.frame ?? null);
  }

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

  async function handleApply() {
    if (picked.length === 0) {
      setStatusMessage("Pick at least 1 file for the booth");
      return;
    }
    const placed = picked.slice(0, photoCount);
    const seconds = Math.min(120, Math.max(1, Number.isFinite(durationSec) ? durationSec : 10));
    const stickers = boothDecorsForTheme(theme.id, theme.groups.length > 0 ? decorGroups : []);
    const cleanTitle = title.trim();
    const next = applyBoothTemplate(placed, {
      backgroundColor: background,
      durationTicks: Math.round(seconds * 1_000_000),
      grayscale,
      decorGroups: theme.groups.length > 0 ? decorGroups : [],
      themeId: theme.id,
      upright: theme.upright,
      photoCount,
      columns,
      patternId,
      frameId,
      title: cleanTitle,
      titleColor,
    });

    const layout = boothLayout({
      upright: theme.upright,
      stickerMargin: stickers.length > 0,
      photos: photoCount,
      columns,
      titleBand: cleanTitle ? Math.round(BOOTH_CANVAS.height * 0.08) : 0,
    });
    const pattern = BOOTH_PATTERNS.find((p) => p.id === patternId) ?? null;
    const frame = BOOTH_FRAMES.find((f) => f.id === frameId) ?? null;
    try {
      const helper = await localExportHealth();
      for (const asset of next.assets) {
        let file: File;
        if (asset.id === BOOTH_PAPER_ID) {
          file = await renderBoothPaper(layout.paper.w, layout.paper.h);
        } else if (pattern && asset.id === pattern.id) {
          file = await svgToPngFile(pattern.svg, BOOTH_CANVAS.width, BOOTH_CANVAS.height, `${pattern.id}.png`);
        } else if (frame && asset.id === frame.id) {
          file = await svgToPngFile(
            frame.render(layout.paper.w, layout.paper.h),
            layout.paper.w,
            layout.paper.h,
            `${frame.id}.png`,
          );
        } else {
          const decor = stickers.find((d) => d.id === asset.id);
          if (!decor) continue;
          file = await svgToPngFile(decor.svg, decor.width, decor.height, `${decor.id}.png`);
        }
        const url = URL.createObjectURL(file);
        rememberBrowserObjectUrl(asset.id, url);
        asset.path = helper.ok ? (await localImportFile(file)).path : url;
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not draw the booth");
      return;
    }

    // Applier is pure — attach the real bin assets here so preview/export
    // can resolve paths.
    next.assets = [...placed, ...next.assets];
    commitProjectChange(() => next);
    setProjectPath(null);
    setPlaying(false);
    setPlayheadTicks(0);
    setSelectedClipIds([]);
    const empty = photoCount - placed.length;
    const paper = next.assets.find((a) => a.id === BOOTH_PAPER_ID);
    const needsHelper = Boolean(paper?.path.startsWith("blob:"));
    setStatusMessage(
      `Photo booth · ${seconds}s${empty > 0 ? ` · ${empty} empty` : ""}${needsHelper ? " · export helper is off, so images may not export" : ""}`,
    );
  }

  function handleSwap() {
    if (!activeSwapClipId || !swapAssetId) {
      setStatusMessage("Pick a photo and a replacement file");
      return;
    }
    const asset = binFiles.find((a) => a.id === swapAssetId);
    if (!asset) return;
    commitProjectChange((p) => swapStripCellByClip(p, activeSwapClipId, asset));
    setStatusMessage(`Photo replaced · ${asset.name}`);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[15px] font-bold text-foreground">Photo booth</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Pick a theme, choose a card layout, then add a background pattern, a frame, and a caption.
        </p>
      </div>

      <div>
        <span className="text-xs font-semibold">Theme</span>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {BOOTH_THEMES.map((item) => {
            const active = item.id === theme.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                title={item.label}
                onClick={() => selectTheme(item.id)}
                className={
                  active
                    ? "flex flex-col gap-1 rounded-lg border border-primary bg-accent p-1.5 text-left"
                    : "flex flex-col gap-1 rounded-lg border border-border bg-secondary p-1.5 text-left hover:border-primary/50"
                }
              >
                <ThemeThumb theme={item} />
                <span className="truncate px-0.5 text-[11px] font-semibold">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Photos</span>
          <span className="text-[11px] text-muted-foreground">{photoCount} on the card</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {PHOTO_COUNTS.map((n) => (
            <Chip key={n} active={photoCount === n} onClick={() => setPhotoCount(n)}>
              {n}
            </Chip>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Card layout</span>
          <span className="flex gap-1">
            <Chip active={columns === 1} onClick={() => setColumns(1)}>
              Strip
            </Chip>
            <Chip active={columns === 2} onClick={() => setColumns(2)}>
              Grid
            </Chip>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Background</span>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(background) ? background : BOOTH_DEFAULT_BACKGROUND}
            aria-label="Booth background color"
            onChange={(e) => setBackground(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...BOOTH_THEMES.map((t) => t.background), "#FFFFFF", "#1A1A1A", "#C5BDB4"].map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Background ${swatch}`}
              onClick={() => setBackground(swatch)}
              className={
                background.toLowerCase() === swatch.toLowerCase()
                  ? "size-5 rounded-full border-2 border-primary"
                  : "size-5 rounded-full border border-border"
              }
              style={{ background: swatch }}
            />
          ))}
        </div>
        <span className="text-xs font-semibold">Pattern</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={patternId == null}
            onClick={() => setPatternId(null)}
            className={
              patternId == null
                ? "flex size-10 items-center justify-center rounded-md border border-primary bg-background text-[10px] font-semibold"
                : "flex size-10 items-center justify-center rounded-md border border-border bg-background text-[10px] text-muted-foreground"
            }
          >
            None
          </button>
          {BOOTH_PATTERNS.map((pattern) => (
            <button
              key={pattern.id}
              type="button"
              title={pattern.label}
              aria-pressed={patternId === pattern.id}
              onClick={() => setPatternId(pattern.id)}
              className={
                patternId === pattern.id
                  ? "size-10 overflow-hidden rounded-md border border-primary"
                  : "size-10 overflow-hidden rounded-md border border-border hover:border-primary/50"
              }
              style={{ background: /^#[0-9a-fA-F]{6}$/.test(background) ? background : "#9AA3AB" }}
            >
              <img
                src={svgDataUrl(pattern.svg)}
                alt={pattern.label}
                draggable={false}
                className="pointer-events-none h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
        <span className="text-xs font-semibold">Frame</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={frameId == null}
            onClick={() => setFrameId(null)}
            className={
              frameId == null
                ? "flex size-10 items-center justify-center rounded-md border border-primary bg-white text-[10px] font-semibold text-black"
                : "flex size-10 items-center justify-center rounded-md border border-border bg-white text-[10px] text-muted-foreground"
            }
          >
            None
          </button>
          {BOOTH_FRAMES.map((frame) => (
            <button
              key={frame.id}
              type="button"
              title={frame.label}
              aria-pressed={frameId === frame.id}
              onClick={() => setFrameId(frame.id)}
              className={
                frameId === frame.id
                  ? "size-10 overflow-hidden rounded-md border border-primary bg-white"
                  : "size-10 overflow-hidden rounded-md border border-border bg-white hover:border-primary/50"
              }
            >
              <img
                src={svgDataUrl(frame.render(80, 104))}
                alt={frame.label}
                draggable={false}
                className="pointer-events-none h-full w-full object-contain"
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary p-2">
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold">Length</span>
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={120}
              value={durationSec}
              aria-label="Booth duration in seconds"
              onChange={(e) => setDurationSec(Number(e.target.value))}
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-[11px]"
            />
            <span className="text-muted-foreground">sec</span>
          </span>
        </label>
        <div className="flex gap-1">
          {[5, 10, 15, 30].map((sec) => (
            <Chip key={sec} active={durationSec === sec} onClick={() => setDurationSec(sec)}>
              {sec}s
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={grayscale} onChange={(e) => setGrayscale(e.target.checked)} />
          Black and white, like a booth print
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Caption</span>
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(titleColor) ? titleColor : "#FFFFFF"}
            aria-label="Caption color"
            onChange={(e) => setTitleColor(e.target.value)}
            className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent"
          />
        </div>
        <input
          type="text"
          value={title}
          maxLength={60}
          placeholder="Caption on the card (optional)"
          aria-label="Booth caption"
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
        />
        {theme.groups.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold">Stickers</span>
            {theme.groups.map((group) => {
              const on = decorGroups.includes(group.id);
              return (
                <label key={group.id} className="flex items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={on}
                    aria-label={group.label}
                    onChange={() =>
                      setDecorGroups((prev) =>
                        prev.includes(group.id)
                          ? prev.filter((id) => id !== group.id)
                          : [...prev, group.id],
                      )
                    }
                  />
                  {group.label}
                </label>
              );
            })}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Stickers are SVG drawings. After creating the booth you can still move, scale, and rotate
              each one on the canvas.
            </p>
          </div>
        ) : (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Classic booth is a plain, straight card with no stickers.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-secondary p-2">
        <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
            Photo booth · needs {photoCount}
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
                      aria-label={`Use ${a.name} in the booth`}
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
          onClick={() => void handleApply()}
          className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {picked.length === 0
            ? "Pick photos for the booth"
            : picked.length < photoCount
              ? `Create · ${picked.length}/${photoCount} (${photoCount - picked.length} empty)`
              : `Create · ${photoCount} photo(s)`}
        </button>
        {picked.length > photoCount ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Extra files stay in the media bin, unplaced.
          </p>
        ) : null}
      </div>

      {boothCells.length > 0 ? (
        <div className="rounded-lg border border-border bg-secondary p-2">
          <span className="text-xs font-semibold">Replace one photo</span>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {selectedCell
              ? `${selectedCell.slotId} selected on timeline`
              : "Or pick a cell below, then a replacement file."}
          </p>
          <div className="mt-1.5 flex flex-col gap-1.5">
            <select
              value={activeSwapClipId ?? ""}
              onChange={(e) => setSwapClipId(e.target.value || null)}
              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
              aria-label="Booth cell"
            >
              <option value="">Pick a cell…</option>
              {boothCells.map((c) => (
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
              Replace photo
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
