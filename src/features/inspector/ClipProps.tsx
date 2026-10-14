import {
  updateClipSpeed,
  updateClipTransform,
  updateClipVolume,
  type Clip,
} from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./InspectorPanel.module.css";

interface ClipPropsProps {
  clip: Clip;
}

export function ClipProps({ clip }: ClipPropsProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const asset = assets.find((a) => a.id === clip.assetId);
  const showVolume = clip.kind === "media" && Boolean(asset?.hasAudio);
  const showSpeed = clip.kind === "media";

  return (
    <div className={styles.section}>
      <label className={styles.label}>
        Selected · {clip.kind === "text" ? "Text" : asset?.name ?? "Clip"}
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span title="Opacity — how transparent the clip appears (0 = invisible, 1 = solid)">
            Opacity
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={clip.transform.opacity}
            onChange={(e) =>
              commitProjectChange((project) =>
                updateClipTransform(project, clip.id, {
                  ...clip.transform,
                  opacity: Math.min(1, Math.max(0, Number(e.target.value) || 0)),
                }),
              )
            }
          />
        </label>
        {showVolume ? (
          <label className={styles.field}>
            <span title="Volume — clip audio gain (1 = original)">Vol</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={clip.volume}
              onChange={(e) => {
                const volume = Math.min(2, Math.max(0, Number(e.target.value) || 0));
                commitProjectChange((project) => updateClipVolume(project, clip.id, volume));
              }}
            />
          </label>
        ) : null}
        {showSpeed ? (
          <label className={styles.field}>
            <span title="Playback speed — timeline length = source duration / speed">
              Speed
            </span>
            <input
              type="number"
              min={0.1}
              max={8}
              step={0.1}
              value={clip.speed}
              onChange={(e) => {
                const speed = Number(e.target.value);
                if (!(speed > 0)) return;
                commitProjectChange((project) => updateClipSpeed(project, clip.id, speed));
              }}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}
