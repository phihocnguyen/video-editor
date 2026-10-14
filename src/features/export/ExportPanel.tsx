import { useMemo, useState } from "react";
import { buildRenderPlan, type RenderResolutionPreset } from "../../domain";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./ExportPanel.module.css";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const [preset, setPreset] = useState<RenderResolutionPreset>("1080");
  const plan = useMemo(() => buildRenderPlan(project, preset), [preset, project]);

  return (
    <div className={styles.panel}>
      <h2>Export</h2>
      <p className={styles.lead}>
        Render plan is ready. FFmpeg job execution lands next (Milestone 4 native pipeline).
      </p>

      <label className={styles.field}>
        <span>Resolution</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as RenderResolutionPreset)}
        >
          <option value="source">Match source</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
      </label>

      <div className={styles.summary}>
        <div>
          <strong>{plan.width}×{plan.height}</strong>
          <span>@ {plan.frameRate}fps</span>
        </div>
        <div>
          <strong>{plan.clips.length}</strong>
          <span>clip(s) · {plan.durationSec.toFixed(2)}s</span>
        </div>
        {plan.missingAssetIds.length > 0 ? (
          <p className={styles.warn}>
            {plan.missingAssetIds.length} missing media — export blocked until relinked.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className={styles.exportBtn}
        disabled
        title="FFmpeg export job — next milestone step"
      >
        Export MP4
      </button>
    </div>
  );
}
