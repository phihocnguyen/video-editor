import { useState } from "react";
import type { MediaKind } from "../../domain";
import {
  actionImportMedia,
  formatActionError,
} from "../../lib/projectActions";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./MediaBinPanel.module.css";

interface MediaBinPanelProps {
  filter?: MediaKind;
}

export function MediaBinPanel({ filter }: MediaBinPanelProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const addAssets = useProjectStore((s) => s.addAssets);
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

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>{title}</h2>
        <button
          type="button"
          className={styles.importBtn}
          onClick={() => void handleImport()}
          disabled={busy}
          title="Import local media (desktop app)"
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
          {visible.map((asset) => (
            <article
              key={asset.id}
              className={asset.missing ? `${styles.card} ${styles.missing}` : styles.card}
            >
              <div className={styles.thumb} data-kind={asset.kind}>
                {asset.kind === "audio" ? "♪" : asset.kind === "image" ? "▣" : "▶"}
              </div>
              <div className={styles.meta}>
                <strong title={asset.path}>{asset.name}</strong>
                <span>
                  {asset.kind}
                  {asset.missing ? " · missing" : ""}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
