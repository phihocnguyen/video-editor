import styles from "./PreviewPanel.module.css";

export function PreviewPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.stage}>
        <div className={styles.placeholder}>
          <strong>Preview</strong>
          <p>Multi-track preview lands in Milestone 3. Single HTML video is not enough for the full timeline.</p>
        </div>
      </div>
    </div>
  );
}
