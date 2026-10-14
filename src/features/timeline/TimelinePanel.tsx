import { useEditorUiStore } from "../../stores/editorUiStore";
import { useProjectStore } from "../../stores/projectStore";
import { ticksToSeconds } from "../../domain";
import styles from "./TimelinePanel.module.css";

export function TimelinePanel() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const playheadTicks = useEditorUiStore((s) => s.playheadTicks);
  const isPlaying = useEditorUiStore((s) => s.isPlaying);
  const setPlaying = useEditorUiStore((s) => s.setPlaying);

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <button type="button" onClick={() => setPlaying(!isPlaying)}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span className={styles.time}>
          {ticksToSeconds(playheadTicks).toFixed(2)}s
        </span>
        <span className={styles.hint}>
          Timeline editing (move/trim/split) — Milestone 2
        </span>
      </div>
      <div className={styles.tracks}>
        {tracks.map((track) => (
          <div key={track.id} className={styles.track}>
            <div className={styles.trackLabel}>
              {track.name}
              <span>{track.kind}</span>
            </div>
            <div className={styles.lane} />
          </div>
        ))}
      </div>
    </div>
  );
}
