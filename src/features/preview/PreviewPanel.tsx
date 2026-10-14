import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { ticksToSeconds } from "../../domain";
import styles from "./PreviewPanel.module.css";

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

export function PreviewPanel() {
  const canvas = useProjectStore((s) => s.project.canvas);
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const durationTicks = useEditorUiStore((s) => s.durationTicks);

  return (
    <div className={styles.panel}>
      <div className={styles.stageWrap}>
        <div
          className={styles.stage}
          style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
        >
          <div className={styles.placeholder}>
            <div className={styles.badge}>Preview</div>
            <p>Import media and build the timeline to preview here.</p>
            <span>Multi-track compositing — Milestone 3</span>
          </div>
        </div>
      </div>

      <div className={styles.transport}>
        <div className={styles.transportLeft}>
          <button type="button" disabled title="Previous edit">
            ⏮
          </button>
          <button
            type="button"
            className={styles.playBtn}
            onClick={() => setPlaying(!isPlaying)}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button type="button" disabled title="Next edit">
            ⏭
          </button>
        </div>
        <div className={styles.clock}>
          {formatClock(ticksToSeconds(playheadTicks))}
          <span> / </span>
          {formatClock(ticksToSeconds(durationTicks))}
        </div>
        <button type="button" className={styles.fullscreen} disabled title="Fullscreen">
          ⛶
        </button>
      </div>
    </div>
  );
}
