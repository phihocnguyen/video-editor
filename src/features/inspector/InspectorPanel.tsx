import { useProjectStore } from "../../stores/projectStore";
import styles from "./InspectorPanel.module.css";

interface InspectorPanelProps {
  mode: "text" | "canvas" | "subtitles";
}

export function InspectorPanel({ mode }: InspectorPanelProps) {
  const canvas = useProjectStore((s) => s.project.canvas);

  if (mode === "canvas") {
    return (
      <div className={styles.panel}>
        <h2>Canvas</h2>
        <div className={styles.section}>
          <label className={styles.label}>Size</label>
          <div className={styles.row}>
            <Field label="W" value={String(canvas.width)} />
            <Field label="H" value={String(canvas.height)} />
          </div>
          <label className={styles.label}>Frame rate</label>
          <Field label="FPS" value={String(canvas.frameRate)} />
        </div>
        <p className={styles.hint}>Canvas editing wires up in later milestones.</p>
      </div>
    );
  }

  if (mode === "subtitles") {
    return (
      <div className={styles.panel}>
        <h2>Subtitles</h2>
        <button type="button" className={styles.primary} disabled title="Later milestone">
          + Add subtitle
        </button>
        <p className={styles.hint}>Subtitle track UI ships after MVP timeline/export.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h2>Text</h2>

      <div className={styles.section}>
        <label className={styles.label}>Align</label>
        <div className={styles.iconRow}>
          {["⇤", "⇔", "⇥", "⤒", "↕", "⤓"].map((icon) => (
            <button key={icon} type="button" className={styles.iconBtn} disabled>
              {icon}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Position & size</label>
        <div className={styles.row}>
          <Field label="X" value="0" />
          <Field label="Y" value="0" />
        </div>
        <div className={styles.row}>
          <Field label="W" value="400" />
          <Field label="H" value="80" />
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Content</label>
        <textarea className={styles.textarea} rows={3} defaultValue="Title text" disabled />
        <div className={styles.row}>
          <select className={styles.select} disabled defaultValue="Segoe UI">
            <option>Segoe UI</option>
          </select>
          <Field label="Px" value="48" />
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>Fill</label>
        <div className={styles.colorRow}>
          <span className={styles.swatch} />
          <input defaultValue="#FFFFFF" disabled />
          <Field label="%" value="100" />
        </div>
      </div>

      <p className={styles.hint}>Text overlays become editable in Milestone 5.</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={value} readOnly disabled />
    </label>
  );
}
