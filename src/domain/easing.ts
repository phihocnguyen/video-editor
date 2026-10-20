/**
 * CapCut-style keyframe curves. `hold` keeps the legacy step behavior;
 * the other curves ease the blend between neighbouring keyframes.
 */
export type EasingType = "hold" | "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface EasingOption {
  id: EasingType;
  label: string;
  /** Tiny SVG path (0..28 x 0..18) used by the line-graph picker. */
  path: string;
}

export const EASING_OPTIONS: EasingOption[] = [
  { id: "linear", label: "Linear", path: "M2 16 L26 2" },
  {
    id: "easeIn",
    label: "Ease in",
    path: "M2 16 C10 16 18 14 26 2",
  },
  {
    id: "easeOut",
    label: "Ease out",
    path: "M2 16 C10 4 18 2 26 2",
  },
  {
    id: "easeInOut",
    label: "Ease in/out",
    path: "M2 16 C10 16 18 2 26 2",
  },
  { id: "hold", label: "Hold", path: "M2 16 L14 16 L14 2 L26 2" },
];

export function normalizeEasing(value: unknown): EasingType | null {
  return EASING_OPTIONS.some((o) => o.id === value)
    ? (value as EasingType)
    : null;
}

/** Progress transform for a curve. `hold` is handled by the caller. */
export function easeProgress(t: number, easing: EasingType): number {
  const p = Math.min(1, Math.max(0, t));
  switch (easing) {
    case "linear":
      return p;
    case "easeIn":
      return p * p * p;
    case "easeOut": {
      const inv = 1 - p;
      return 1 - inv * inv * inv;
    }
    case "easeInOut":
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    case "hold":
      return 0;
  }
}

/** FFmpeg expression for `easeProgress(t, easing)`, commas escaped. */
export function ffmpegEaseExpr(
  timeExpr: string,
  easing: EasingType,
): string {
  switch (easing) {
    case "linear":
      return timeExpr;
    case "easeIn":
      return `pow(${timeExpr}\\,3)`;
    case "easeOut":
      return `(1-pow(1-(${timeExpr})\\,3))`;
    case "easeInOut":
      return `if(lt(${timeExpr}\\,0.5)\\,4*pow(${timeExpr}\\,3)\\,1-pow(-2*(${timeExpr})+2\\,3)/2)`;
    case "hold":
      return "0";
  }
}
