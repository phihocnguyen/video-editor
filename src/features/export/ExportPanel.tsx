import styles from "./ExportPanel.module.css";

export function ExportPanel() {
  return (
    <div className={styles.panel}>
      <h2>Export</h2>
      <p>
        MP4 export via FFmpeg (Rust child process, explicit args) is Milestone 4.
        Progress, cancel, and validation will live here.
      </p>
      <button type="button" disabled>
        Export MP4
      </button>
    </div>
  );
}
