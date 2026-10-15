import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  deleteClips,
  moveClipLayer,
  normalizeTextStyle,
  updateClipText,
  updateClipTransform,
  withListStyle,
  type TextStyle,
} from "../../domain";
import {
  copySelectedClips,
  duplicateSelectedClips,
  pasteClipboardClips,
} from "../../lib/clipClipboard";
import { cn } from "../../lib/utils";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";

interface TextQuickAccessProps {
  stageRef: RefObject<HTMLDivElement | null>;
  wrapRef: RefObject<HTMLDivElement | null>;
}

type BarPos = { left: number; top: number; below: boolean };

function applyText(clipId: string, next: TextStyle) {
  commitProjectChange((p) => updateClipText(p, clipId, next));
}

const PAD = 10;

export function TextQuickAccess({ stageRef, wrapRef }: TextQuickAccessProps) {
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const textQuickUi = useEditorUiStore((s) => s.textQuickUi);
  const setTextQuickUi = useEditorUiStore((s) => s.setTextQuickUi);
  const patchTextQuickUi = useEditorUiStore((s) => s.patchTextQuickUi);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const setActivePanel = useEditorUiStore((s) => s.setActivePanel);
  const activePanel = useEditorUiStore((s) => s.activePanel);
  const project = useProjectStore((s) => s.project);
  const [pos, setPos] = useState<BarPos | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const clipId = selectedClipIds.length === 1 ? selectedClipIds[0]! : null;
  const clip = clipId
    ? project.clips.find((c) => c.id === clipId && c.kind === "text")
    : null;
  const text = clip?.text ? normalizeTextStyle(clip.text) : null;

  useEffect(() => {
    if (!clipId || !clip) {
      if (textQuickUi) setTextQuickUi(null);
      return;
    }
    if (!textQuickUi || textQuickUi.clipId !== clipId) {
      setTextQuickUi({
        clipId,
        mode: "select",
        stylesOpen: false,
        moreOpen: false,
      });
    }
  }, [clipId, clip, textQuickUi, setTextQuickUi]);

  // Keep bar above the text; clamp inside wrap so stage overflow never clips it
  useEffect(() => {
    if (!clipId || !clip) {
      setPos(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      const wrap = wrapRef.current;
      const el = stage?.querySelector<HTMLElement>(
        `[data-text-clip-id="${clipId}"]`,
      );
      if (!stage || !wrap || !el) {
        setPos(null);
        return;
      }
      const wr = wrap.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const bar = rootRef.current;
      const barW = bar?.offsetWidth || 300;
      const barH = bar?.offsetHeight || 44;

      let left = er.left + er.width / 2 - wr.left;
      const half = barW / 2;
      left = Math.min(Math.max(left, PAD + half), Math.max(PAD + half, wr.width - PAD - half));

      // Prefer above the text; flip below if there isn't room
      let below = false;
      let top = er.top - wr.top - 8;
      if (top < PAD + barH) {
        below = true;
        top = er.bottom - wr.top + 8;
        top = Math.min(top, Math.max(PAD, wr.height - PAD - barH));
      }

      setPos((prev) =>
        prev &&
        Math.abs(prev.left - left) < 0.5 &&
        Math.abs(prev.top - top) < 0.5 &&
        prev.below === below
          ? prev
          : { left, top, below },
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clipId, clip, stageRef, wrapRef]);

  useEffect(() => {
    if (!textQuickUi?.moreOpen && !colorOpen) return;
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        patchTextQuickUi({ moreOpen: false });
        setColorOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [textQuickUi?.moreOpen, colorOpen, patchTextQuickUi]);

  useEffect(() => {
    if (textQuickUi?.mode !== "edit") setColorOpen(false);
  }, [textQuickUi?.mode]);

  if (!clipId || !clip || !text || !textQuickUi || !pos) return null;

  const editing = textQuickUi.mode === "edit";
  const colorValue =
    text.color.startsWith("#") && text.color.length >= 7
      ? text.color.slice(0, 7)
      : "#ffffff";

  return (
    <div
      ref={rootRef}
      data-text-quick-access
      className={cn(
        "pointer-events-none absolute z-50 -translate-x-1/2",
        pos.below ? "translate-y-0" : "-translate-y-full",
      )}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="pointer-events-auto relative flex flex-col items-center">
        {!editing ? (
          <ToolbarShell>
            <ToolButton
              label="Edit"
              icon={<PencilIcon />}
              onClick={() =>
                patchTextQuickUi({ mode: "edit", moreOpen: false })
              }
            />
            <ToolButton
              label="Styles"
              icon={<StylesIcon />}
              active={activePanel === "text"}
              onClick={() => {
                patchTextQuickUi({ moreOpen: false, stylesOpen: false });
                setActivePanel("text");
              }}
            />
            <ToolbarDivider />
            <ToolIconButton
              title="Bring forward"
              onClick={() => {
                try {
                  commitProjectChange((p) => moveClipLayer(p, clipId, "up"));
                } catch (e) {
                  setStatusMessage(e instanceof Error ? e.message : "Layer failed");
                }
              }}
            >
              <LayerUpIcon />
            </ToolIconButton>
            <ToolIconButton
              title="Send backward"
              onClick={() => {
                try {
                  commitProjectChange((p) => moveClipLayer(p, clipId, "down"));
                } catch (e) {
                  setStatusMessage(e instanceof Error ? e.message : "Layer failed");
                }
              }}
            >
              <LayerDownIcon />
            </ToolIconButton>
            <ToolIconButton title="Duplicate" onClick={() => duplicateSelectedClips()}>
              <DupIcon />
            </ToolIconButton>
            <ToolIconButton
              title="Delete"
              danger
              onClick={() => {
                commitProjectChange((p) => deleteClips(p, [clipId]));
                setSelectedClipIds([]);
                setStatusMessage("Deleted text");
              }}
            >
              <TrashIcon />
            </ToolIconButton>
            <div className="relative">
              <ToolIconButton
                title="More"
                active={textQuickUi.moreOpen}
                onClick={() =>
                  patchTextQuickUi({ moreOpen: !textQuickUi.moreOpen })
                }
              >
                <MoreIcon />
              </ToolIconButton>
              {textQuickUi.moreOpen ? (
                <div
                  className={cn(
                    "absolute right-0 z-50 w-52 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl",
                    pos.below ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
                  )}
                >
                  <MoreItem
                    icon={<FlipHIcon />}
                    label="Flip horizontal"
                    onClick={() => {
                      commitProjectChange((p) =>
                        updateClipTransform(p, clipId, {
                          ...clip.transform,
                          scaleX: -(clip.transform.scaleX || 1),
                        }),
                      );
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  />
                  <MoreItem
                    icon={<FlipVIcon />}
                    label="Flip vertical"
                    onClick={() => {
                      commitProjectChange((p) =>
                        updateClipTransform(p, clipId, {
                          ...clip.transform,
                          scaleY: -(clip.transform.scaleY || 1),
                        }),
                      );
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  />
                  <div className="mx-2 my-1.5 h-px bg-border" />
                  <MoreItem
                    icon={<CopyIcon />}
                    label="Copy"
                    shortcut="Ctrl+C"
                    onClick={() => {
                      copySelectedClips();
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  />
                  <MoreItem
                    icon={<PasteIcon />}
                    label="Paste"
                    shortcut="Ctrl+V"
                    onClick={() => {
                      pasteClipboardClips();
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  />
                </div>
              ) : null}
            </div>
          </ToolbarShell>
        ) : (
          <ToolbarShell>
            <div className="relative">
              <button
                type="button"
                title={`Text color (${text.color})`}
                aria-label="Text color"
                aria-expanded={colorOpen}
                className={cn(
                  "relative mx-0.5 grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-[13px] font-extrabold shadow-sm",
                  isLightColor(colorValue)
                    ? "border border-border"
                    : "border-2 border-white/55 ring-1 ring-black/40",
                )}
                style={{
                  background: text.color,
                  color: isLightColor(colorValue) ? "#111111" : "#FFFFFF",
                }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setColorOpen((v) => !v)}
              >
                A
              </button>
              {colorOpen ? (
                <div
                  className={cn(
                    "absolute left-0 z-50 w-52 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl",
                    pos.below ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Color
                  </div>
                  <div className="mb-3 grid grid-cols-6 gap-1.5">
                    {TEXT_COLOR_SWATCHES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        title={c}
                        className={cn(
                          "size-6 rounded-md transition-transform hover:scale-110",
                          isLightColor(c)
                            ? "border border-border/80"
                            : "border border-white/40",
                          colorValue.toLowerCase() === c.toLowerCase() &&
                            "ring-2 ring-primary ring-offset-1 ring-offset-popover",
                        )}
                        style={{ background: c }}
                        onClick={() => {
                          applyText(clipId, { ...text, color: c });
                          setColorOpen(false);
                        }}
                      />
                    ))}
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                    <input
                      type="color"
                      className="size-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                      value={colorValue}
                      onChange={(e) =>
                        applyText(clipId, { ...text, color: e.target.value })
                      }
                    />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-foreground outline-none"
                      value={text.color}
                      onChange={(e) =>
                        applyText(clipId, { ...text, color: e.target.value })
                      }
                      spellCheck={false}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <ToolbarDivider />
            <ToolIconButton
              title="Bold"
              active={text.fontWeight >= 600}
              onClick={() =>
                applyText(clipId, {
                  ...text,
                  fontWeight: text.fontWeight >= 600 ? 400 : 700,
                })
              }
            >
              <span className="text-[13px] font-extrabold">B</span>
            </ToolIconButton>
            <ToolIconButton
              title="Italic"
              active={text.italic}
              onClick={() => applyText(clipId, { ...text, italic: !text.italic })}
            >
              <span className="text-[13px] font-semibold italic">I</span>
            </ToolIconButton>
            <ToolIconButton
              title="Underline"
              active={text.underline}
              onClick={() =>
                applyText(clipId, { ...text, underline: !text.underline })
              }
            >
              <span className="text-[13px] font-semibold underline">U</span>
            </ToolIconButton>
            <ToolIconButton
              title="Strikethrough"
              active={text.strikethrough}
              onClick={() =>
                applyText(clipId, {
                  ...text,
                  strikethrough: !text.strikethrough,
                })
              }
            >
              <span className="text-[13px] font-semibold line-through">S</span>
            </ToolIconButton>
            <ToolbarDivider />
            <ToolIconButton
              title="Bulleted list"
              active={text.listStyle === "bullet"}
              onClick={() => applyText(clipId, withListStyle(text, "bullet"))}
            >
              <BulletIcon />
            </ToolIconButton>
            <ToolIconButton
              title="Numbered list"
              active={text.listStyle === "number"}
              onClick={() => applyText(clipId, withListStyle(text, "number"))}
            >
              <NumberIcon />
            </ToolIconButton>
            <ToolbarDivider />
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg bg-primary px-3.5 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setColorOpen(false);
                patchTextQuickUi({ mode: "select", moreOpen: false });
              }}
            >
              Done
            </button>
          </ToolbarShell>
        )}
      </div>
    </div>
  );
}

const TEXT_COLOR_SWATCHES = [
  "#FFFFFF",
  "#FFE566",
  "#FF6B6B",
  "#4ECDC4",
  "#5B8DEF",
  "#B794F4",
  "#111111",
  "#F8FAFC",
  "#22C55E",
  "#F97316",
  "#EC4899",
  "#94A3B8",
];

/** Relative luminance → pick dark glyph on light fills. */
function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // sRGB relative luminance (WCAG)
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.55;
}

/** Floating pill bar — Canvas-style: elevated surface, tight radius, one accent. */
function ToolbarShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-md">
      {children}
    </div>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function ToolButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ToolIconButton({
  title,
  active,
  danger,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // Keep contentEditable focused while formatting
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg font-semibold transition-colors",
        danger
          ? "text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          : active
            ? "shadow-sm"
            : "hover:brightness-125",
      )}
      style={
        danger
          ? undefined
          : active
            ? { background: "#7DD3FC", color: "#0B1220" }
            : { background: "rgba(255,255,255,0.14)", color: "#C8C8D0" }
      }
    >
      {children}
    </button>
  );
}

function MoreItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-popover-foreground transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-2.5 text-muted-foreground [&_svg]:text-foreground">
        {icon}
        <span className="text-popover-foreground">{label}</span>
      </span>
      {shortcut ? (
        <span className="text-[11px] font-medium text-muted-foreground">{shortcut}</span>
      ) : null}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function StylesIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="7" y="9" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function LayerUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4 4 9l8 5 8-5-8-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m4 14 8 5 8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LayerDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m4 10 8 5 8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 20 4 15l8-5 8 5-8 5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function DupIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 14V6a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}
function FlipHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18M4 8l4 4-4 4M20 8l-4 4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FlipVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12h18M8 4l4 4 4-4M8 20l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function PasteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 4h8v3H8V4Z" stroke="currentColor" strokeWidth="1.8" />
      <rect x="5" y="6" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function BulletIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="7" r="1.4" fill="currentColor" />
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="6" cy="17" r="1.4" fill="currentColor" />
      <path d="M10 7h10M10 12h10M10 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function NumberIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7h2M5 12h2M5 17h2M10 7h10M10 12h10M10 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
