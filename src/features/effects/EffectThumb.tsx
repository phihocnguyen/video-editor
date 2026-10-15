/**
 * Illustrated mini-preview for a fade transition card.
 */

import type { TransitionType } from "../../domain";
import styles from "./EffectThumb.module.css";

interface EffectThumbProps {
  transition: TransitionType;
}

function PhotoTile() {
  return (
    <svg viewBox="0 0 48 34" width="48" height="34" aria-hidden className={styles.art}>
      <defs>
        <linearGradient id="thumb-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b7cf6" />
          <stop offset="100%" stopColor="#5b8def" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="30" rx="5" fill="url(#thumb-photo)" opacity="0.85" />
      <circle cx="15" cy="13" r="4" fill="#fff" opacity="0.9" />
      <path d="M4 30 L18 18 L28 26 L37 16 L46 30 Z" fill="#fff" opacity="0.55" />
    </svg>
  );
}

export function EffectThumb({ transition }: EffectThumbProps) {
  const animName = `tx-${transition}`;
  const isNone = transition === "none";

  return (
    <div className={styles.thumb} data-media="video">
      <div
        key={animName}
        className={`${styles.animated} ${isNone ? styles.static : ""}`}
        style={{ animationName: animName }}
      >
        <PhotoTile />
      </div>
    </div>
  );
}
