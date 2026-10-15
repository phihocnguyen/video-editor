import { useEffect, useMemo, useState } from "react";
import {
  buildRenderPlan,
  updateCanvas,
  type RenderQualityPreset,
  type RenderResolutionPreset,
} from "../../domain";
import { localExportHealth, localStartExport } from "../../lib/localExport";
import {
  ffmpegStatus,
  isTauriRuntime,
  pickExportOutputPath,
  startExport,
} from "../../lib/tauri";
import { commitProjectChange } from "../../stores/historyStore";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useExportStore } from "../../stores/exportStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./ExportPanel.module.css";

const CANVAS_PRESETS: { label: string; width: number; height: number; fps: number }[] = [
  { label: "16:9 · 1920×1080", width: 1920, height: 1080, fps: 30 },
  { label: "9:16 · 1080×1920", width: 1080, height: 1920, fps: 30 },
  { label: "1:1 · 1080×1080", width: 1080, height: 1080, fps: 30 },
  { label: "4:5 · 1080×1350", width: 1080, height: 1350, fps: 30 },
  { label: "21:9 · 2560×1080", width: 2560, height: 1080, fps: 30 },
];

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const canvas = project.canvas;
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);
  const job = useExportStore((s) => s.job);
  const setJob = useExportStore((s) => s.setJob);
  const [preset, setPreset] = useState<RenderResolutionPreset>("1080");
  const [quality, setQuality] = useState<RenderQualityPreset>("standard");
  const [busy, setBusy] = useState(false);
  const [exportReady, setExportReady] = useState(isTauriRuntime());
  const plan = useMemo(
    () => buildRenderPlan(project, preset, quality),
    [preset, project, quality],
  );
  const hasBlob = plan.clips.some((c) => c.assetPath.startsWith("blob:"));
  const blocked =
    plan.missingAssetIds.length > 0 ||
    (plan.clips.length === 0 && plan.texts.length === 0) ||
    hasBlob;

  useEffect(() => {
    let cancelled = false;
    const ping = () => {
      if (isTauriRuntime()) {
        void ffmpegStatus()
          .then((status) => {
            if (!cancelled) setExportReady(status.ffmpegOk);
          })
          .catch(() => {
            if (!cancelled) setExportReady(false);
          });
        return;
      }
      void localExportHealth().then((health) => {
        if (!cancelled) setExportReady(health.ok && health.ffmpegFound);
      });
    };
    ping();
    const timer = window.setInterval(ping, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function handleExport() {
    if (blocked) {
      setStatusMessage(
        hasBlob
          ? "Re-import media before exporting"
          : "Add clips or fix missing media before export",
      );
      return;
    }

    setBusy(true);
    try {
      if (isTauriRuntime()) {
        if (!exportReady) {
          setStatusMessage("Export is unavailable. Please reinstall the app.");
          return;
        }
        const outputPath = await pickExportOutputPath(project.name || "cutline-export");
        if (!outputPath) {
          setStatusMessage("Export cancelled");
          return;
        }
        const started = await startExport(plan, outputPath);
        setJob(started);
        setStatusMessage("Exporting…");
        return;
      }

      if (!exportReady) {
        setStatusMessage("Export is unavailable right now. Please try again.");
        return;
      }
      const started = await localStartExport(project, preset, quality);
      setJob(started);
      setStatusMessage("Exporting…");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy(false);
    }
  }

  const canExport =
    !busy &&
    !blocked &&
    job?.state !== "running" &&
    job?.state !== "queued" &&
    exportReady;

  return (
    <div className={styles.panel}>
      <h2>Export</h2>
      <p className={styles.lead}>
        Choose canvas size, resolution, and quality, then export an MP4.
      </p>

      <div className={styles.canvasBlock}>
        <h3 className={styles.blockTitle}>Canvas</h3>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Width</span>
            <input
              type="number"
              min={2}
              max={7680}
              value={canvas.width}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { width: Number(e.target.value) || canvas.width }),
                )
              }
            />
          </label>
          <label className={styles.field}>
            <span>Height</span>
            <input
              type="number"
              min={2}
              max={7680}
              value={canvas.height}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { height: Number(e.target.value) || canvas.height }),
                )
              }
            />
          </label>
        </div>
        <div className={styles.chipRow}>
          {CANVAS_PRESETS.map((presetItem) => {
            const active =
              canvas.width === presetItem.width && canvas.height === presetItem.height;
            return (
              <button
                key={presetItem.label}
                type="button"
                className={active ? styles.chipActive : styles.chip}
                onClick={() =>
                  commitProjectChange((p) =>
                    updateCanvas(p, {
                      width: presetItem.width,
                      height: presetItem.height,
                      frameRate: presetItem.fps,
                    }),
                  )
                }
              >
                {presetItem.label}
              </button>
            );
          })}
        </div>
        <label className={styles.field}>
          <span>Frame rate</span>
          <input
            type="number"
            min={1}
            max={240}
            value={canvas.frameRate}
            onChange={(e) =>
              commitProjectChange((p) =>
                updateCanvas(p, { frameRate: Number(e.target.value) || canvas.frameRate }),
              )
            }
          />
        </label>
        <label className={styles.field}>
          <span>Background</span>
          <div className={styles.colorRow}>
            <input
              type="color"
              value={canvas.backgroundColor}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { backgroundColor: e.target.value }),
                )
              }
            />
            <input
              value={canvas.backgroundColor}
              onChange={(e) =>
                commitProjectChange((p) =>
                  updateCanvas(p, { backgroundColor: e.target.value }),
                )
              }
            />
          </div>
        </label>
      </div>

      <label className={styles.field}>
        <span>Resolution</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as RenderResolutionPreset)}
        >
          <option value="source">Match canvas</option>
          <option value="720">720p</option>
          <option value="1080">1080p</option>
        </select>
      </label>

      <label className={styles.field}>
        <span>Quality</span>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as RenderQualityPreset)}
        >
          <option value="draft">Draft (2.5 Mbps)</option>
          <option value="standard">Standard (6 Mbps)</option>
          <option value="high">High (12 Mbps)</option>
        </select>
      </label>

      <div className={styles.summary}>
        <div>
          <strong>
            {plan.width}×{plan.height}
          </strong>
          <span>
            @ {plan.frameRate}fps · {plan.videoBitrate} / {plan.audioBitrate}
          </span>
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
        {hasBlob ? (
          <p className={styles.warn}>
            Some clips need to be re-imported before export.
          </p>
        ) : null}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.exportBtn}
          disabled={!canExport}
          onClick={() => void handleExport()}
        >
          {job?.state === "running" || job?.state === "queued"
            ? "Exporting…"
            : "Export MP4"}
        </button>
      </div>
    </div>
  );
}
