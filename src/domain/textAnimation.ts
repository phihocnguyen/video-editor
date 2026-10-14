/**
 * Text (title) in/out animations — CapCut-style presets.
 *
 * Each preset has a logical preview visual (opacity / transform / clip-path)
 * used by the live preview, plus an FFmpeg expression mapping for export.
 * Preview is pixel-accurate; a few clip-path presets are only approximated on
 * export via alpha (called out in the panel hint).
 */

import type { Tick } from "./time";

export type TextAnimId =
  | "none"
  | "fade"
  | "slide"
  | "reveal"
  | "pop"
  | "wipe"
  | "expand"
  | "pushUp"
  | "driftH"
  | "converge"
  | "spin"
  | "blink"
  | "cutPaste"
  | "slam"
  | "blockCover";

export interface TextAnimationPreset {
  id: TextAnimId;
  /** Vietnamese label shown under the card (matches CapCut). */
  label: string;
  hint: string;
  group: "basic" | "slide" | "zoom" | "special";
}

export interface TextAnimation {
  /** Entrance animation. */
  in: TextAnimId;
  /** Exit animation. */
  out: TextAnimId;
  /** Length of each window in ticks. */
  durationTicks: Tick;
}

export const DEFAULT_TEXT_ANIMATION: TextAnimation = {
  in: "none",
  out: "none",
  durationTicks: 600_000,
};

/** Ordered list of presets, mirroring the reference CapCut "basic effects" grid. */
export const TEXT_ANIM_PRESETS: TextAnimationPreset[] = [
  { id: "none", label: "Không", hint: "No animation", group: "basic" },
  { id: "fade", label: "Hiện lên", hint: "Fade in", group: "basic" },
  { id: "slide", label: "Lượt", hint: "Slide in from the left", group: "slide" },
  { id: "reveal", label: "Rõ dần", hint: "Blur into focus", group: "basic" },
  { id: "pop", label: "Bật ra", hint: "Pop / scale up", group: "zoom" },
  { id: "wipe", label: "Gạt", hint: "Wipe reveal", group: "special" },
  { id: "expand", label: "Giãn nở", hint: "Expand from centre", group: "zoom" },
  { id: "pushUp", label: "Kéo lên", hint: "Push up into place", group: "slide" },
  { id: "driftH", label: "Trôi ngang", hint: "Drift horizontally", group: "slide" },
  { id: "converge", label: "Trôi hội tụ", hint: "Drift in and scale down", group: "zoom" },
  { id: "spin", label: "Nhão lộn", hint: "Spin and tumble", group: "special" },
  { id: "blink", label: "Nhấp nháy", hint: "Blink / flicker", group: "special" },
  { id: "cutPaste", label: "Cắt dán", hint: "Cut-and-paste reveal", group: "special" },
  { id: "slam", label: "Đập vào", hint: "Slam in from large", group: "zoom" },
  { id: "blockCover", label: "Khối phủ", hint: "Block cover reveal", group: "special" },
];

export const TEXT_ANIM_GROUPS: { id: TextAnimationPreset["group"]; label: string }[] = [
  { id: "basic", label: "Cơ bản" },
  { id: "slide", label: "Trượt" },
  { id: "zoom", label: "Phóng" },
  { id: "special", label: "Đặc biệt" },
];

function isTextAnimId(value: unknown): value is TextAnimId {
  return TEXT_ANIM_PRESETS.some((p) => p.id === value);
}

export function normalizeTextAnimation(
  input?: Partial<TextAnimation> | null,
): TextAnimation {
  const inId = isTextAnimId(input?.in) ? input!.in! : "none";
  const outId = isTextAnimId(input?.out) ? input!.out! : "none";
  const durationTicks =
    typeof input?.durationTicks === "number" && Number.isFinite(input.durationTicks)
      ? Math.min(5_000_000, Math.max(100_000, Math.round(input.durationTicks)))
      : DEFAULT_TEXT_ANIMATION.durationTicks;
  return { in: inId, out: outId, durationTicks };
}

export function textAnimationIsDefault(anim: TextAnimation): boolean {
  return anim.in === "none" && anim.out === "none";
}

/** Partial CSS visual applied to a text layer during an animation window. */
export interface AnimVisual {
  opacity: number;
  /** Appended after the element's base `translate(-50%, -50%)`. */
  transform: string;
  clipPath?: string;
  /** Extra blur radius (px) to fold into the layer filter. */
  blurPx: number;
}

const IDENTITY: AnimVisual = { opacity: 1, transform: "", blurPx: 0 };

/**
 * Visual for a preset at `a` = "entered amount" in `[0, 1]`.
 * `a = 0` → start state (fully un-entered), `a = 1` → settled.
 */
function presetVisual(id: TextAnimId, a: number): AnimVisual {
  const p = Math.min(1, Math.max(0, a));
  const inv = 1 - p;
  switch (id) {
    case "fade":
      return { opacity: p, transform: "", blurPx: 0 };
    case "slide":
      return { opacity: p, transform: `translateX(${(-inv * 40).toFixed(2)}%)`, blurPx: 0 };
    case "reveal":
      return { opacity: p, transform: "", blurPx: inv * 14 };
    case "pop": {
      // Small overshoot near the end reads like CapCut's "pop".
      const s = 0.6 + 0.4 * p + Math.sin(p * Math.PI) * 0.08;
      return { opacity: Math.min(1, p * 1.4), transform: `scale(${s.toFixed(3)})`, blurPx: 0 };
    }
    case "wipe":
      return { opacity: 1, transform: "", blurPx: 0, clipPath: `inset(0 ${(inv * 100).toFixed(1)}% 0 0)` };
    case "expand":
      return { opacity: p, transform: `scale(${(0.2 + 0.8 * p).toFixed(3)})`, blurPx: 0 };
    case "pushUp":
      return { opacity: p, transform: `translateY(${(inv * 60).toFixed(2)}%)`, blurPx: 0 };
    case "driftH":
      return { opacity: 1, transform: `translateX(${(inv * 60).toFixed(2)}%)`, blurPx: 0 };
    case "converge":
      return { opacity: p, transform: `scale(${(1 + inv * 0.6).toFixed(3)})`, blurPx: 0 };
    case "spin":
      return {
        opacity: p,
        transform: `rotate(${(inv * -200).toFixed(1)}deg) scale(${(0.4 + 0.6 * p).toFixed(3)})`,
        blurPx: 0,
      };
    case "blink": {
      // Stepped flicker: repeated on/off whose duty cycle opens up.
      const steps = 6;
      const lit = Math.floor(p * steps) / steps >= 1 - 1 / steps ? 1 : (Math.floor(p * steps) % 2 === 0 ? 1 : 0.15);
      return { opacity: p >= 1 ? 1 : lit, transform: "", blurPx: 0 };
    }
    case "cutPaste":
      return { opacity: 1, transform: "", blurPx: 0, clipPath: `inset(${(inv * 100).toFixed(1)}% 0 0 0)` };
    case "slam":
      return { opacity: p >= 0.02 ? 1 : 0, transform: `scale(${(3 - 2 * p).toFixed(3)})`, blurPx: 0 };
    case "blockCover":
      return { opacity: 1, transform: "", blurPx: 0, clipPath: `inset(0 0 ${(inv * 100).toFixed(1)}% 0)` };
    default:
      return IDENTITY;
  }
}

function ease(x: number): number {
  const p = Math.min(1, Math.max(0, x));
  return p * p * (3 - 2 * p);
}

/**
 * Combined in/out visual at `localSec` within a clip of `durSec`.
 * Returns identity when no animation is active.
 */
export function textAnimationVisual(
  anim: TextAnimation | null | undefined,
  localSec: number,
  durSec: number,
): AnimVisual {
  if (!anim) return IDENTITY;
  const normalized = normalizeTextAnimation(anim);
  if (textAnimationIsDefault(normalized)) return IDENTITY;

  const total = Math.max(0.01, durSec);
  const window = Math.min(
    normalized.durationTicks / 1_000_000,
    total,
  );
  const t = Math.max(0, Math.min(total, localSec));

  // Entrance dominates near the start; exit near the end. Blend by priority:
  // whichever window we are inside wins, exit overrides once its window starts.
  let visual: AnimVisual = IDENTITY;

  const inActive = normalized.in !== "none" && window > 0.001 && t < window;
  if (inActive) {
    visual = presetVisual(normalized.in, ease(t / window));
  }

  const outStart = total - window;
  const outActive =
    normalized.out !== "none" && window > 0.001 && t > outStart && t <= total;
  if (outActive) {
    const entered = 1 - ease((t - outStart) / window);
    visual = presetVisual(normalized.out, entered);
  }

  return visual;
}

/**
 * FFmpeg expression fragments for a text animation. drawtext `alpha`, `x`, `y`
 * and `fontsize` all accept expressions of the frame time `t`.
 * `startSec`/`endSec` are the clip window on the output timeline.
 */
export interface FfmpegTextAnim {
  /** alpha expression in [0,1]. */
  alpha: string;
  /** Additive x offset in px (expression or literal). */
  dx: string;
  /** Additive y offset in px (expression or literal). */
  dy: string;
  /** fontsize multiplier expression (>= 0). */
  scale: string;
}

function progressExpr(tVar: string, start: number, dur: number): string {
  const st = start.toFixed(3);
  const d = Math.max(0.05, dur).toFixed(3);
  return `min(1\\,max(0\\,((${tVar})-${st})/${d}))`;
}

function easeExpr(p: string): string {
  return `(${p})*(${p})*(3-2*(${p}))`;
}

/** Window of the entrance/exit as [start, dur] in seconds. */
function windows(
  anim: TextAnimation,
  startSec: number,
  endSec: number,
): { inStart: number; inDur: number; outStart: number; outDur: number } {
  const total = Math.max(0.01, endSec - startSec);
  const win = Math.min(anim.durationTicks / 1_000_000, total);
  return {
    inStart: startSec,
    inDur: win,
    outStart: Math.max(startSec, endSec - win),
    outDur: win,
  };
}

/** Expression for a preset's fade-equivalent alpha multiplier during entrance. */
function inAlpha(id: TextAnimId, p: string): string {
  const e = easeExpr(p);
  switch (id) {
    case "none":
      return "1";
    case "blink":
      // Approximate the flicker with a fast ramp; keeps export legible.
      return `${e}`;
    case "slam":
      return `if(gte(${p}\\,0.02)\\,1\\,0)`;
    case "wipe":
    case "cutPaste":
    case "blockCover":
    case "driftH":
      return "1";
    default:
      return `${e}`;
  }
}

function outAlpha(id: TextAnimId, p: string): string {
  // p goes 0→1 across the exit window; alpha fades from 1→0.
  const e = easeExpr(p);
  switch (id) {
    case "none":
      return "1";
    case "wipe":
    case "cutPaste":
    case "blockCover":
    case "driftH":
      return "1";
    default:
      return `(1-${e})`;
  }
}

export function ffmpegTextAnim(
  anim: TextAnimation | null | undefined,
  startSec: number,
  endSec: number,
): FfmpegTextAnim {
  if (!anim) return { alpha: "1", dx: "0", dy: "0", scale: "1" };
  const normalized = normalizeTextAnimation(anim);
  if (textAnimationIsDefault(normalized)) {
    return { alpha: "1", dx: "0", dy: "0", scale: "1" };
  }

  const { inStart, inDur, outStart, outDur } = windows(normalized, startSec, endSec);
  const pIn = progressExpr("t", inStart, inDur);
  const pOut = progressExpr("t", outStart, outDur);

  const aIn =
    normalized.in === "none" ? "1" : inAlpha(normalized.in, pIn);
  const aOut =
    normalized.out === "none" ? "1" : outAlpha(normalized.out, pOut);

  // Guard outside the clip window.
  const s = startSec.toFixed(3);
  const en = endSec.toFixed(3);
  const alpha = `if(lt(t\\,${s})\\,0\\,if(gt(t\\,${en})\\,0\\,min(1\\,(${aIn})*(${aOut}))))`;

  // Position: entrance offsets and exit offsets (px). W/H approximated by canvas
  // width for x and height for y via the caller; here we use relative ratios.
  // `w`/`h` are drawtext's frame-size constants (the output canvas).
  const dxIn =
    normalized.in === "slide" || normalized.in === "driftH"
      ? `((1-${easeExpr(pIn)})*0.4*w)`
      : "0";
  const dxOut =
    normalized.out === "slide" || normalized.out === "driftH"
      ? `(${easeExpr(pOut)}*0.4*w)`
      : "0";
  const dyIn = normalized.in === "pushUp" ? `((1-${easeExpr(pIn)})*0.4*h)` : "0";
  const dyOut = normalized.out === "pushUp" ? `(${easeExpr(pOut)}*0.4*h)` : "0";

  const scaleIn =
    normalized.in === "pop" || normalized.in === "expand" || normalized.in === "converge"
      ? `(0.4+0.6*${easeExpr(pIn)})`
      : normalized.in === "slam"
        ? `(3-2*${easeExpr(pIn)})`
        : normalized.in === "spin"
          ? `(0.4+0.6*${easeExpr(pIn)})`
          : "1";
  const scaleOut =
    normalized.out === "expand" ||
    normalized.out === "pop" ||
    normalized.out === "converge" ||
    normalized.out === "spin"
      ? `(0.4+0.6*(1-${easeExpr(pOut)}))`
      : "1";

  return {
    alpha,
    dx: `(${dxIn})+(${dxOut})`,
    dy: `(${dyIn})+(${dyOut})`,
    scale: `(${scaleIn})*(${scaleOut})`,
  };
}
