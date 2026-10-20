import type { TextAnimType } from "../../domain";
import styles from "./TextEffectThumb.module.css";

interface TextEffectThumbProps {
  label: string;
  color: string;
  swatch: string;
  animIn?: TextAnimType;
  blendMode?: string;
}

function animClass(type: TextAnimType | undefined): string {
  switch (type) {
    case "fade":
      return `${styles.sample} ${styles.animFade}`;
    case "slideUp":
    case "slideDown":
      return `${styles.sample} ${styles.animSlideUp}`;
    case "slideLeft":
    case "slideRight":
      return `${styles.sample} ${styles.animSlideLeft}`;
    case "scalePop":
      return `${styles.sample} ${styles.animPop}`;
    default:
      return `${styles.sample} ${styles.static}`;
  }
}

export function TextEffectThumb({
  label,
  color,
  swatch,
  animIn,
  blendMode,
}: TextEffectThumbProps) {
  const showBadge = blendMode && blendMode !== "normal";
  return (
    <div className={styles.thumb} style={{ background: swatch }}>
      <span className={animClass(animIn)} style={{ color }}>
        {label.slice(0, 8)}
      </span>
      {showBadge ? (
        <span className={styles.blendBadge}>{blendMode}</span>
      ) : null}
    </div>
  );
}
