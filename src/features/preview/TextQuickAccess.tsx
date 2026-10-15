import {
  useEffect,
  useMemo,
  useRef,
  useState,
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
import { TEXT_EFFECT_PRESETS } from "../library/presets";
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
}

function applyText(clipId: string, next: TextStyle) {
  commitProjectChange((p) => updateClipText(p, clipId, next));
}

export function TextQuickAccess({ stageRef }: TextQuickAccessProps) {
  const selectedClipIds = useEditorUiStore((s) => s.selectedClipIds);
  const textQuickUi = useEditorUiStore((s) => s.textQuickUi);
  const setTextQuickUi = useEditorUiStore((s) => s.setTextQuickUi);
  const patchTextQuickUi = useEditorUiStore((s) => s.patchTextQuickUi);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const project = useProjectStore((s) => s.project);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const clipId = selectedClipIds.length === 1 ? selectedClipIds[0]! : null;
  const clip = clipId
    ? project.clips.find((c) => c.id === clipId && c.kind === "text")
    : null;
  const text = clip?.text ? normalizeTextStyle(clip.text) : null;

  // Ensure quick UI is open for a single selected text clip
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

  // Track selected text box position relative to stage
  useEffect(() => {
    if (!clipId || !clip) {
      setPos(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const stage = stageRef.current;
      const el = stage?.querySelector<HTMLElement>(
        `[data-text-clip-id="${clipId}"]`,
      );
      if (!stage || !el) {
        setPos(null);
        return;
      }
      const sr = stage.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const left = er.left + er.width / 2 - sr.left;
      const top = er.top - sr.top - 12;
      setPos((prev) =>
        prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.top - top) < 0.5
          ? prev
          : { left, top },
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clipId, clip, stageRef]);

  // Close more menu on outside click
  useEffect(() => {
    if (!textQuickUi?.moreOpen && !textQuickUi?.stylesOpen) return;
    const onDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        patchTextQuickUi({ moreOpen: false, stylesOpen: false });
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [textQuickUi?.moreOpen, textQuickUi?.stylesOpen, patchTextQuickUi]);

  const presets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TEXT_EFFECT_PRESETS;
    return TEXT_EFFECT_PRESETS.filter(
      (p) =>
        p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [search]);

  if (!clipId || !clip || !text || !textQuickUi || !pos) return null;

  const editing = textQuickUi.mode === "edit";

  const pillBtn = (active?: boolean) =>
    cn(
      "inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-neutral-900 transition-colors hover:bg-black/6",
      active && "bg-blue-500/10 text-blue-600 ring-1 ring-inset ring-blue-500",
    );

  const iconBtn = (active?: boolean) =>
    cn(
      "inline-flex size-8 items-center justify-center rounded-full text-neutral-900 transition-colors hover:bg-black/6",
      active && "bg-blue-500/12 text-blue-600",
    );

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-full"
      style={{ left: pos.left, top: Math.max(8, pos.top) }}
    >
      <div className="pointer-events-auto relative flex flex-col items-center">
        {!editing ? (
          <div className="flex items-center gap-0.5 rounded-full bg-white p-1 text-neutral-900 shadow-[0_8px_28px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06)]">
            <button
              type="button"
              className={pillBtn()}
              onClick={() =>
                patchTextQuickUi({ mode: "edit", stylesOpen: false, moreOpen: false })
              }
            >
              <PencilIcon /> Edit
            </button>
            <button
              type="button"
              className={pillBtn(textQuickUi.stylesOpen)}
              onClick={() =>
                patchTextQuickUi({
                  stylesOpen: !textQuickUi.stylesOpen,
                  moreOpen: false,
                })
              }
            >
              <StylesIcon /> Styles
            </button>
            <span className="mx-1 h-5 w-px bg-black/10" />
            <button
              type="button"
              className={iconBtn()}
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
            </button>
            <button
              type="button"
              className={iconBtn()}
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
            </button>
            <button
              type="button"
              className={iconBtn()}
              title="Duplicate"
              onClick={() => duplicateSelectedClips()}
            >
              <DupIcon />
            </button>
            <button
              type="button"
              className={cn(iconBtn(), "hover:bg-red-500/12 hover:text-red-600")}
              title="Delete"
              onClick={() => {
                commitProjectChange((p) => deleteClips(p, [clipId]));
                setSelectedClipIds([]);
                setStatusMessage("Deleted text");
              }}
            >
              <TrashIcon />
            </button>
            <div className="relative">
              <button
                type="button"
                className={iconBtn(textQuickUi.moreOpen)}
                title="More"
                onClick={() =>
                  patchTextQuickUi({
                    moreOpen: !textQuickUi.moreOpen,
                    stylesOpen: false,
                  })
                }
              >
                <MoreIcon />
              </button>
              {textQuickUi.moreOpen ? (
                <div className="absolute top-[calc(100%+8px)] right-0 z-50 min-w-[220px] rounded-xl bg-white p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06)]">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/6"
                    onClick={() => {
                      commitProjectChange((p) =>
                        updateClipTransform(p, clipId, {
                          ...clip.transform,
                          scaleX: -(clip.transform.scaleX || 1),
                        }),
                      );
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <FlipHIcon /> Flip horizontal
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/6"
                    onClick={() => {
                      commitProjectChange((p) =>
                        updateClipTransform(p, clipId, {
                          ...clip.transform,
                          scaleY: -(clip.transform.scaleY || 1),
                        }),
                      );
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <FlipVIcon /> Flip vertical
                    </span>
                  </button>
                  <div className="mx-2 my-1 h-px bg-black/8" />
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/6"
                    onClick={() => {
                      copySelectedClips();
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <CopyIcon /> Copy Element
                    </span>
                    <span className="text-xs font-medium text-neutral-400">CTRL + C</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium hover:bg-black/6"
                    onClick={() => {
                      pasteClipboardClips();
                      patchTextQuickUi({ moreOpen: false });
                    }}
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <PasteIcon /> Paste Element
                    </span>
                    <span className="text-xs font-medium text-neutral-400">CTRL + V</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-0.5 rounded-full bg-white p-1 text-neutral-900 shadow-[0_8px_28px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06)]">
            <label
              className="relative mx-1 size-7 shrink-0 overflow-hidden rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
              title="Text color"
              style={{ background: text.color }}
            >
              <input
                type="color"
                className="absolute inset-[-4px] size-[calc(100%+8px)] cursor-pointer border-0 p-0"
                value={
                  text.color.startsWith("#") && text.color.length >= 7
                    ? text.color.slice(0, 7)
                    : "#ffffff"
                }
                onChange={(e) => applyText(clipId, { ...text, color: e.target.value })}
              />
            </label>
            <span className="mx-1 h-5 w-px bg-black/10" />
            <button
              type="button"
              className={iconBtn(text.fontWeight >= 600)}
              title="Bold"
              onClick={() =>
                applyText(clipId, {
                  ...text,
                  fontWeight: text.fontWeight >= 600 ? 400 : 700,
                })
              }
            >
              <span className="font-extrabold">B</span>
            </button>
            <button
              type="button"
              className={iconBtn(text.italic)}
              title="Italic"
              onClick={() => applyText(clipId, { ...text, italic: !text.italic })}
            >
              <span className="italic font-semibold">I</span>
            </button>
            <button
              type="button"
              className={iconBtn(text.underline)}
              title="Underline"
              onClick={() =>
                applyText(clipId, { ...text, underline: !text.underline })
              }
            >
              <span className="font-semibold underline">U</span>
            </button>
            <button
              type="button"
              className={iconBtn(text.strikethrough)}
              title="Strikethrough"
              onClick={() =>
                applyText(clipId, {
                  ...text,
                  strikethrough: !text.strikethrough,
                })
              }
            >
              <span className="font-semibold line-through">S</span>
            </button>
            <span className="mx-1 h-5 w-px bg-black/10" />
            <button
              type="button"
              className={iconBtn(text.listStyle === "bullet")}
              title="Bulleted list"
              onClick={() => applyText(clipId, withListStyle(text, "bullet"))}
            >
              <BulletIcon />
            </button>
            <button
              type="button"
              className={iconBtn(text.listStyle === "number")}
              title="Numbered list"
              onClick={() => applyText(clipId, withListStyle(text, "number"))}
            >
              <NumberIcon />
            </button>
            <span className="mx-1 h-5 w-px bg-black/10" />
            <button
              type="button"
              className={pillBtn()}
              onClick={() =>
                patchTextQuickUi({ mode: "select", stylesOpen: false, moreOpen: false })
              }
            >
              Done
            </button>
          </div>
        )}

        {textQuickUi.stylesOpen && !editing ? (
          <div className="absolute top-[calc(100%+10px)] left-0 z-50 w-[min(280px,70vw)] max-h-[360px] overflow-auto rounded-[14px] bg-white p-3 text-neutral-900 shadow-[0_12px_36px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06)]">
            <div className="mb-2.5 flex items-center justify-between text-sm font-bold">
              <span>Text Styles</span>
              <button
                type="button"
                className="grid size-7 place-items-center rounded-lg text-base hover:bg-black/6"
                aria-label="Close styles"
                onClick={() => patchTextQuickUi({ stylesOpen: false })}
              >
                ×
              </button>
            </div>
            <input
              className="mb-3 w-full rounded-lg border border-black/10 bg-neutral-100 px-2.5 py-2 text-[13px] outline-none focus:border-blue-400"
              placeholder="Search …"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="flex flex-col gap-1.5 overflow-hidden rounded-[10px] border border-black/8 bg-neutral-50 text-left hover:border-blue-500"
                  onClick={() => {
                    const merged = normalizeTextStyle({
                      ...text,
                      ...preset.text,
                      content: text.content.trim() ? text.content : preset.text.content,
                    });
                    applyText(clipId, merged);
                    setStatusMessage(`Applied ${preset.label}`);
                  }}
                >
                  <span
                    className="grid h-14 place-items-center text-[15px] font-bold tracking-tight text-white"
                    style={{ background: preset.swatch }}
                  >
                    Aa
                  </span>
                  <span className="px-2 pb-2 text-xs font-semibold text-neutral-700">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
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
      <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
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
      <circle cx="6" cy="7" r="1.5" fill="currentColor" />
      <circle cx="6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="6" cy="17" r="1.5" fill="currentColor" />
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
