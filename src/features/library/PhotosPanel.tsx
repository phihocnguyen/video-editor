import { addMediaClip, type MediaAsset } from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { MediaBinPanel } from "../media-bin/MediaBinPanel";
import { PHOTO_PRESETS } from "./presets";

function exampleAssetPath(src: string): string {
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")) {
    return src;
  }
  return new URL(src, window.location.href).href;
}

export function PhotosPanel() {
  const assets = useProjectStore((s) => s.project.assets);
  const setSelectedClipIds = useEditorUiStore((s) => s.setSelectedClipIds);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

  function handleAddExample(photo: (typeof PHOTO_PRESETS)[number]) {
    const path = exampleAssetPath(photo.src);
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
          name: photo.label,
          durationTicks: 5_000_000,
          width: 1600,
          height: 1200,
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
        createdClipId = next.clips[next.clips.length - 1]?.id ?? "";
        return next;
      });

      if (createdClipId) setSelectedClipIds([createdClipId]);
      setStatusMessage(`Added · ${photo.label}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not add photo");
    }
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <h2 className="text-[15px] font-bold text-foreground">Photos</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Example photos — click to add at the playhead
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PHOTO_PRESETS.map((photo) => {
            const path = exampleAssetPath(photo.src);
            const inBin = assets.some((a) => a.path === path);
            return (
              <button
                key={photo.id}
                type="button"
                title={`${photo.label} — click to add`}
                onClick={() => handleAddExample(photo)}
                className="group overflow-hidden rounded-lg border border-border bg-secondary text-left transition-colors hover:border-primary/50 hover:bg-accent"
              >
                <img
                  src={photo.src}
                  alt={photo.label}
                  className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.03]"
                />
                <span className="flex items-center justify-between gap-1 truncate px-2 py-1.5 text-[11px] font-semibold text-muted-foreground group-hover:text-foreground">
                  <span className="truncate">{photo.label}</span>
                  {inBin ? (
                    <span className="shrink-0 text-[10px] text-primary">In bin</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <MediaBinPanel filter="image" hideTitle />
    </div>
  );
}
