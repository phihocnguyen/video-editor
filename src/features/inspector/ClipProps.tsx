import { updateClipTransform, type Clip } from "../../domain";
import { commitProjectChange } from "../../stores/historyStore";
import { useProjectStore } from "../../stores/projectStore";
import styles from "./InspectorPanel.module.css";

interface ClipPropsProps {
  clip: Clip;
}

export function ClipProps({ clip }: ClipPropsProps) {
  const assets = useProjectStore((s) => s.project.assets);
  const asset = assets.find((a) => a.id === clip.assetId);

  return (
    <div className={styles.section}>
      <label className={styles.label}>
        Selected · {clip.kind === "text" ? "Text" : asset?.name ?? "Clip"}
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Op</span>
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
        <label className={styles.field}>
          <span>Vol</span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={clip.volume}
            onChange={(e) => {
              const volume = Math.min(2, Math.max(0, Number(e.target.value) || 0));
              commitProjectChange((project) => ({
                ...project,
                clips: project.clips.map((c) =>
                  c.id === clip.id ? { ...c, volume } : c,
                ),
                updatedAt: new Date().toISOString(),
              }));
            }}
          />
        </label>
      </div>
    </div>
  );
}
