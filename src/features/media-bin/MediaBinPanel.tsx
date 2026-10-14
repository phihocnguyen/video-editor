import { useProjectStore } from "../../stores/projectStore";
import styles from "./MediaBinPanel.module.css";

export function MediaBinPanel() {
  const assets = useProjectStore((s) => s.project.assets);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>Media Bin</h2>
        <button type="button" disabled title="Milestone 1 — import via Tauri dialog">
          Import
        </button>
      </div>
      {assets.length === 0 ? (
        <p className={styles.empty}>
          No media yet. Import arrives in Milestone 1 (local files only, non-destructive).
        </p>
      ) : (
        <ul className={styles.list}>
          {assets.map((asset) => (
            <li key={asset.id}>
              <strong>{asset.name}</strong>
              <span>{asset.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
