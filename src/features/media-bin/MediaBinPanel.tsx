import { useState } from "react";
import { addMediaClip, relinkAsset, type MediaKind } from "../../domain";
import {
  actionImportMedia,
  actionRelinkAsset,
  formatActionError,
} from "../../lib/projectActions";
import { VideoThumb } from "../../components/VideoThumb";
import { canShowThumbnail, resolveMediaUrl } from "../../lib/mediaUrl";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./MediaBinPanel.module.css";

interface MediaBinPanelProps {
  filter?: MediaKind;
}

export function MediaBinPanel({ filter }: MediaBinPanelProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const addAssets = useProjectStore((s) => s.addAssets);
  const setProject = useProjectStore((s) => s.setProject);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [busy, setBusy] = useState(false);
  const visible = filter ? assets.filter((a) => a.kind === filter) : assets;
  const title =
    filter === "audio" ? "Audio" : filter === "image" ? "Photos" : "Media";

  async function handleImport() {
    setBusy(true);
    try {
      const imported = await actionImportMedia();
      if (imported.length === 0) {
        setStatusMessage("Import cancelled");
        return;
      }
      addAssets(imported);
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
      commitProjectChange((project) =>
        addMediaClip(project, assetId, { startTicks: playheadTicks }),
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
      const relinked = await actionRelinkAsset(asset);
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
        <h2>{title}</h2>
        <button
          type="button"
          className={styles.importBtn}
          onClick={() => void handleImport()}
          disabled={busy}
          title="Import local media"
        >
          {busy ? "Importing…" : "+ Import"}
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
                    e.dataTransfer.setData("text/cutline-asset", asset.id);
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
                      "♪"
                    ) : (
                      "▶"
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
