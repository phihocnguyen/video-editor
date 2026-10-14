import { useProjectStore } from "../../stores/projectStore";
import type { MediaKind } from "../../domain";
import styles from "./MediaBinPanel.module.css";

interface MediaBinPanelProps {
  filter?: MediaKind;
}

export function MediaBinPanel({ filter }: MediaBinPanelProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const visible = filter ? assets.filter((a) => a.kind === filter) : assets;
  const title =
    filter === "audio" ? "Audio" : filter === "image" ? "Photos" : "Media";

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>{title}</h2>
        <button type="button" className={styles.importBtn} disabled title="Milestone 1">
          + Import
        </button>
      </div>

      <button type="button" className={styles.dropzone} disabled title="Milestone 1">
        <strong>Upload files</strong>
        <span>Video, audio, and images stay on your computer</span>
      </button>

      {visible.length === 0 ? (
        <p className={styles.empty}>No {title.toLowerCase()} imported yet.</p>
      ) : (
        <div className={styles.grid}>
          {visible.map((asset) => (
            <article key={asset.id} className={styles.card}>
              <div className={styles.thumb} data-kind={asset.kind}>
                {asset.kind === "audio" ? "♪" : asset.kind === "image" ? "▣" : "▶"}
              </div>
              <div className={styles.meta}>
                <strong title={asset.name}>{asset.name}</strong>
                <span>{asset.kind}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
