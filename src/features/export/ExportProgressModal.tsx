import { useEffect } from "react";
import { createPortal } from "react-dom";
import {
  cancelExport,
  getExportStatus,
  isTauriRuntime,
} from "../../lib/tauri";
import { localDownloadUrl, localGetExportStatus } from "../../lib/localExport";
import { useEditorUiStore } from "../../stores/editorUiStore";
import { useExportStore } from "../../stores/exportStore";
import styles from "./ExportProgressModal.module.css";

function isActive(state: string | undefined) {
  return state === "running" || state === "queued";
}

export function ExportProgressModal() {
  const job = useExportStore((s) => s.job);
  const setJob = useExportStore((s) => s.setJob);
  const clearJob = useExportStore((s) => s.clearJob);
  const setStatusMessage = useEditorUiStore((s) => s.setStatusMessage);

  useEffect(() => {
    if (!job || !isActive(job.state)) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          if (isTauriRuntime()) {
            const status = await getExportStatus();
            if (status) {
              setJob(status);
              if (status.state === "succeeded") {
                setStatusMessage("Export complete");
              } else if (status.state === "failed") {
                setStatusMessage("Export failed");
              }
            }
            return;
          }
          const status = await localGetExportStatus(job.id);
          setJob(status);
          if (status.state === "succeeded") {
            if (status.downloadUrl) localDownloadUrl(status.downloadUrl);
            setStatusMessage("Export complete");
          } else if (status.state === "failed") {
            setStatusMessage("Export failed");
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, 500);
    return () => window.clearInterval(timer);
  }, [job, setJob, setStatusMessage]);

  if (!job) return null;

  const pct = Math.max(0, Math.min(100, Math.round(job.progress * 100)));
  const active = isActive(job.state);
  const title =
    job.state === "succeeded"
      ? "Export complete"
      : job.state === "failed"
        ? "Export failed"
        : job.state === "cancelled"
          ? "Export cancelled"
          : "Rendering video";
  const message =
    job.state === "succeeded"
      ? "Your video was exported successfully."
      : job.state === "failed"
        ? "Something went wrong while exporting. Please try again."
        : job.state === "cancelled"
          ? "Export was cancelled."
          : "Please wait while your video is rendered.";

  async function handleCancel() {
    if (!isTauriRuntime()) {
      setStatusMessage("Cancel is limited in browser helper — wait for job to finish");
      return;
    }
    try {
      const status = await cancelExport();
      setJob(status);
      setStatusMessage("Export cancelled");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return createPortal(
    <div className={styles.backdrop} role="presentation">
      <div
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-progress-title"
        aria-describedby="export-progress-msg"
      >
        <div className={styles.iconWrap} data-state={job.state} aria-hidden>
          {job.state === "succeeded" ? (
            <CheckIcon />
          ) : job.state === "failed" || job.state === "cancelled" ? (
            <AlertIcon />
          ) : (
            <SpinnerIcon />
          )}
        </div>

        <h2 id="export-progress-title" className={styles.title}>
          {title}
        </h2>
        <p id="export-progress-msg" className={styles.message}>
          {message}
        </p>

        {active || job.state === "succeeded" ? (
          <div className={styles.progressBlock}>
            <div className={styles.progressTrack}>
              <div
                className={styles.progressFill}
                style={{ width: `${job.state === "succeeded" ? 100 : pct}%` }}
              />
            </div>
            <div className={styles.progressMeta}>
              <span>{active ? "Rendering" : "Done"}</span>
              <span className={styles.pct}>
                {job.state === "succeeded" ? 100 : pct}%
              </span>
            </div>
          </div>
        ) : null}

        {job.outputPath && job.state === "succeeded" ? (
          <p className={styles.path} title={job.outputPath}>
            {job.outputPath}
          </p>
        ) : null}

        <div className={styles.actions}>
          {active && isTauriRuntime() ? (
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => void handleCancel()}
            >
              Cancel
            </button>
          ) : null}
          {!active ? (
            <button type="button" className={styles.doneBtn} onClick={() => clearJob()}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SpinnerIcon() {
  return (
    <svg className={styles.spinner} width="28" height="28" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
