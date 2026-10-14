import styles from "./ExportPanel.module.css";

export function ExportPanel() {
  return (
    <div className={styles.panel}>
      <h2>Export</h2>
      <p className={styles.lead}>
        Render a local MP4 with FFmpeg. Progress, cancel, and presets arrive in Milestone 4.
      </p>

      <label className={styles.field}>
        <span>Resolution</span>
        <select disabled defaultValue="1080">
          <option value="source">Match source</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
      </label>

      <label className={styles.field}>
        <span>Quality</span>
        <select disabled defaultValue="high">
          <option value="draft">Draft</option>
          <option value="high">High</option>
        </select>
      </label>

      <button type="button" className={styles.exportBtn} disabled>
        Export MP4
      </button>
    </div>
  );
}
