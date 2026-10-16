import { useEffect, useState } from "react";
import { addMediaClip, relinkAsset, type MediaKind } from "../../domain";
import {
  actionImportMedia,
  actionRelinkAsset,
  formatActionError,
} from "../../lib/projectActions";
import { VideoThumb } from "../../components/VideoThumb";
import { AudioIcon, MediaIcon } from "../../components/icons";
import { canShowThumbnail, resolveMediaUrl } from "../../lib/mediaUrl";
import { warmMediaUrl } from "../../lib/mediaVideoPool";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./MediaBinPanel.module.css";

interface MediaBinPanelProps {
  filter?: MediaKind;
  /** Hide the panel title (when embedded under another library panel). */
  hideTitle?: boolean;
}

export function MediaBinPanel({ filter, hideTitle = false }: MediaBinPanelProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const projectId = useProjectStore((s) => s.project.id);
  const addAssets = useProjectStore((s) => s.addAssets);
  const setProject = useProjectStore((s) => s.setProject);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [busy, setBusy] = useState(false);
  const extractedAudioIds = new Set(
    assets.flatMap((asset) =>
      asset.extractedAudioAssetId ? [asset.extractedAudioAssetId] : [],
    ),
  );
  const visible = assets.filter(
    (asset) =>
      !extractedAudioIds.has(asset.id) && (!filter || asset.kind === filter),
  );
  const title =
    filter === "audio" ? "Audio" : filter === "image" ? "Photos" : "Media";

  // Keep preview decoders warm for every video already in the bin.
  useEffect(() => {
    for (const asset of assets) {
      if (asset.kind !== "video" || asset.missing) continue;
      const url = resolveMediaUrl(asset.path, asset.id);
      if (url) warmMediaUrl(url);
    }
  }, [assets]);

  async function handleImport() {
    setBusy(true);
    try {
      const imported = await actionImportMedia(projectId);
      if (imported.length === 0) {
        setStatusMessage("Import cancelled");
        return;
      }
      addAssets(imported);
      // Warm HTML decoders now so Play is ready the moment a clip hits the timeline.
      for (const asset of imported) {
        if (asset.kind !== "video" || asset.missing) continue;
        const url = resolveMediaUrl(asset.path, asset.id);
        if (url) warmMediaUrl(url);
      }
      const missing = imported.filter((a) => a.missing).length;
      setStatusMessage(
        missing > 0
          ? `Imported ${imported.length} · ${missing} unavailable`
          : `Imported ${imported.length} media file(s)`,
      );
    } catch (error) {
      setStatusMessage(formatActionError(error));
    } finally {
      setBusy(false);
    }
  }

  function handleAddToTimeline(assetId: string) {
    try {
      // Don't release/restart media-bin thumbs — that steals the decoder from
      // the newly mounted preview video for ~1–2s after add.
      commitProjectChange((project) =>
        addMediaClip(project, assetId, {
          startTicks: useEditorUiStore.getState().playheadTicks,
        }),
      );
      setStatusMessage("Clip added to timeline");
    } catch (error) {
      setStatusMessage(formatActionError(error));
    }
  }

  async function handleRelink(assetId: string) {
    const asset = useProjectStore.getState().project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    try {
      const relinked = await actionRelinkAsset(asset, projectId);
      const before = useProjectStore.getState().project;
      setProject(
        relinkAsset(before, assetId, relinked.path, {
          name: relinked.name,
          missing: relinked.missing,
        }),
      );
      setStatusMessage(`Relinked ${relinked.name}`);
    } catch (error) {
      if (formatActionError(error) !== "Relink cancelled") {
        setStatusMessage(formatActionError(error));
      }
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        {hideTitle ? (
          <h2 className="text-[13px] font-bold text-muted-foreground">Imported</h2>
        ) : (
          <h2>{title}</h2>
        )}
        <button
          type="button"
          className={styles.importBtn}
          onClick={() => void handleImport()}
          disabled={busy}
          title="Import local media"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>

      <button
        type="button"
        className={styles.dropzone}
        onClick={() => void handleImport()}
        disabled={busy}
      >
        <strong>Upload files</strong>
        <span>Video, audio, and images stay on your computer</span>
      </button>

      {visible.length === 0 ? (
        <p className={styles.empty}>No {title.toLowerCase()} imported yet.</p>
      ) : (
        <div className={styles.grid}>
          {visible.map((asset) => {
            const thumbUrl = canShowThumbnail(asset.kind, asset.path, asset.id)
              ? resolveMediaUrl(asset.path, asset.id)
              : null;
            return (
              <article
                key={asset.id}
                className={asset.missing ? `${styles.card} ${styles.missing}` : styles.card}
              >
                <button
                  type="button"
                  className={styles.thumbBtn}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/klipcut-asset", asset.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onDoubleClick={() => handleAddToTimeline(asset.id)}
                  title="Drag to timeline or double-click to add at playhead"
                >
                  <div className={styles.thumb} data-kind={asset.kind}>
                    {thumbUrl && asset.kind === "image" ? (
                      <img src={thumbUrl} alt="" />
                    ) : thumbUrl && asset.kind === "video" ? (
                      <VideoThumb
                        src={thumbUrl}
                        filePath={
                          asset.path.startsWith("blob:") ? null : asset.path
                        }
                      />
                    ) : asset.kind === "audio" ? (
                      <AudioIcon size={22} />
                    ) : (
                      <MediaIcon size={22} />
                    )}
                  </div>
                </button>
                <div className={styles.meta}>
                  <strong title={asset.path}>{asset.name}</strong>
                  <span>
                    {asset.kind}
                    {asset.missing ? " · missing" : ""}
                  </span>
                  <div className={styles.cardActions}>
                    <button type="button" onClick={() => handleAddToTimeline(asset.id)}>
                      Add
                    </button>
                    {asset.missing ? (
                      <button type="button" onClick={() => void handleRelink(asset.id)}>
                        Relink
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
