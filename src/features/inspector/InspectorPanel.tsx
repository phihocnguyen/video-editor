import styles from "./InspectorPanel.module.css";

export function InspectorPanel() {
  return (
    <div className={styles.panel}>
      <h2>Inspector</h2>
      <p>Clip transform, volume, and text overlays arrive in Milestone 5. Select a clip after Milestone 2.</p>
    </div>
  );
}
