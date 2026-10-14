/**
 * Illustrated mini-preview for an effect card.
 *
 * Renders a small SVG "stage" (an ABC text tile or a photo tile) with a CSS
 * keyframe animation per preset — no external assets, matching the CapCut-style
 * effect grid in the reference design.
 */

import type { TextAnimId } from "../../domain";
import type { TransitionType } from "../../domain";
import styles from "./EffectThumb.module.css";

type Media = "text" | "video";

interface EffectThumbProps {
  /** Either a text-animation preset or a video transition. */
  textAnim?: TextAnimId;
  transition?: TransitionType;
  media: Media;
}

/** Map a text preset to a CSS animation-name defined in the module. */
function textAnimKey(id: TextAnimId): string {
  return `anim-${id}`;
}

/** Map a transition to a preview animation name. */
function transitionKey(type: TransitionType): string {
  return `tx-${type}`;
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

function TextTile() {
  return (
    <svg viewBox="0 0 48 34" width="48" height="34" aria-hidden className={styles.art}>
      <rect x="2" y="2" width="44" height="30" rx="5" fill="#8b7cf6" opacity="0.22" />
      <text
        x="24"
        y="23"
        textAnchor="middle"
        fontFamily="Manrope Variable, sans-serif"
        fontWeight="800"
        fontSize="14"
        fill="#8b7cf6"
      >
        ABC
      </text>
    </svg>
  );
}

export function EffectThumb({ textAnim, transition, media }: EffectThumbProps) {
  const animName = textAnim ? textAnimKey(textAnim) : transition ? transitionKey(transition) : "";
  const isNone = textAnim === "none" || transition === "none";

  return (
    <div className={styles.thumb} data-media={media}>
      <div
        key={animName}
        className={`${styles.animated} ${isNone ? styles.static : ""}`}
        style={animName ? { animationName: animName } : undefined}
      >
        {media === "text" ? <TextTile /> : <PhotoTile />}
      </div>
    </div>
  );
}
