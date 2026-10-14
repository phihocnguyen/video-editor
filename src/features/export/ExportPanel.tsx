import { useEffect, useMemo, useState } from "react";
import { buildRenderPlan, type RenderResolutionPreset } from "../../domain";
import {
  cancelExport,
  getExportStatus,
  isTauriRuntime,
  pickExportOutputPath,
  startExport,
  type ExportJobStatus,
} from "../../lib/tauri";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./ExportPanel.module.css";

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const [preset, setPreset] = useState<RenderResolutionPreset>("1080");
  const [job, setJob] = useState<ExportJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => buildRenderPlan(project, preset), [preset, project]);
  const blocked =
    plan.missingAssetIds.length > 0 ||
    (plan.clips.length === 0 && plan.texts.length === 0) ||
    plan.clips.some((c) => c.assetPath.startsWith("blob:"));

  useEffect(() => {
    if (!job || (job.state !== "running" && job.state !== "queued")) return;
    const timer = window.setInterval(() => {
      void getExportStatus()
        .then((status) => {
          if (status) setJob(status);
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [job]);

  async function handleExport() {
    if (!isTauriRuntime()) {
      setStatusMessage("Export requires desktop app + FFmpeg on PATH");
      return;
    }
    if (blocked) {
      setStatusMessage("Fix missing/blob media before export");
      return;
    }
    setBusy(true);
    try {
      const outputPath = await pickExportOutputPath(project.name || "cutline-export");
      if (!outputPath) {
        setStatusMessage("Export cancelled");
        return;
      }
      const started = await startExport(plan, outputPath);
      setJob(started);
      setStatusMessage("Export started");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    try {
      const status = await cancelExport();
      setJob(status);
      setStatusMessage("Export cancelled");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className={styles.panel}>
      <h2>Export</h2>
      <p className={styles.lead}>
        Local MP4 via FFmpeg (H.264). Requires desktop app and FFmpeg on PATH.
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
          <strong>
            {plan.width}×{plan.height}
          </strong>
          <span>@ {plan.frameRate}fps</span>
        </div>
        <div>
          <strong>{plan.clips.length}</strong>
          <span>media · </span>
          <strong>{plan.texts.length}</strong>
          <span>text · {plan.durationSec.toFixed(2)}s</span>
        </div>
        {plan.missingAssetIds.length > 0 ? (
          <p className={styles.warn}>
            {plan.missingAssetIds.length} missing media — export blocked.
          </p>
        ) : null}
        {plan.clips.some((c) => c.assetPath.startsWith("blob:")) ? (
          <p className={styles.warn}>
            Browser blob imports cannot be exported. Re-import in the desktop app.
          </p>
        ) : null}
      </div>

      {job ? (
        <div className={styles.job}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </div>
          <p>
            {job.message} ({job.state})
          </p>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.exportBtn}
          disabled={busy || blocked || job?.state === "running"}
          onClick={() => void handleExport()}
        >
          Export MP4
        </button>
        {job?.state === "running" ? (
          <button type="button" className={styles.cancelBtn} onClick={() => void handleCancel()}>
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
