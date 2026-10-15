import { addMediaClip, updateClipTransform, type MediaAsset } from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { SHAPE_PRESETS } from "./presets";

/** Shapes default smaller than full-frame contain-fit (CapCut-like sticker size). */
const SHAPE_DEFAULT_SCALE = 0.28;

function exampleAssetPath(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")) {
    return src;
  }
  return new URL(src, window.location.href).href;
}

export function ShapePanel() {
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

  function handleAddShape(shape: (typeof SHAPE_PRESETS)[number]) {
    const path = exampleAssetPath(shape.src);
    let createdClipId = "";

    try {
      commitProjectChange((project) => {
        const existing = project.assets.find(
          (a) => a.kind === "image" && a.path === path,
        );
        const asset: MediaAsset = existing ?? {
          id: crypto.randomUUID(),
          kind: "image",
          path,
          name: shape.label,
          durationTicks: 5_000_000,
          width: 800,
          height: 800,
          frameRate: null,
          hasAudio: false,
          missing: false,
        };

        const withAsset = existing
          ? project
          : {
              ...project,
              assets: [...project.assets, asset],
              updatedAt: new Date().toISOString(),
            };

        const next = addMediaClip(withAsset, asset.id, {
          startTicks: useEditorUiStore.getState().playheadTicks,
        });
        const clip = next.clips[next.clips.length - 1];
        createdClipId = clip?.id ?? "";
        if (!clip) return next;
        return updateClipTransform(next, clip.id, {
          ...clip.transform,
          scaleX: SHAPE_DEFAULT_SCALE,
          scaleY: SHAPE_DEFAULT_SCALE,
        });
      });

      if (createdClipId) setSelectedClipIds([createdClipId]);
      setStatusMessage(`Added · ${shape.label}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not add shape");
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold text-foreground">Shape</h2>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Click a shape to add it at the playhead
      </p>
      <div className="grid grid-cols-3 gap-2">
        {SHAPE_PRESETS.map((shape) => (
          <button
            key={shape.id}
            type="button"
            title={`${shape.label} — click to add`}
            onClick={() => handleAddShape(shape)}
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary text-[#9aa3b2] transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground"
          >
            {shape.draw({ className: "size-9" })}
            <span className="max-w-full truncate px-1 text-[11px] font-semibold">
              {shape.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
