import type { ReactNode } from "react";
import type { TextStyle } from "../../domain";
import { DEFAULT_TEXT_ANIMATION } from "../../domain";

export const SHAPE_PRESETS: {
  id: string;
  label: string;
  src: string;
  draw: (props: { className?: string }) => ReactNode;
}[] = [
  {
    id: "rectangle",
    label: "Rectangle",
    src: "/examples/shapes/rectangle.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <rect x="8" y="12" width="32" height="24" rx="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "rounded",
    label: "Rounded",
    src: "/examples/shapes/rounded.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <rect x="8" y="12" width="32" height="24" rx="10" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle",
    src: "/examples/shapes/circle.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <circle cx="24" cy="24" r="14" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "triangle",
    label: "Triangle",
    src: "/examples/shapes/triangle.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path d="M24 10 L40 38 H8 Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "star",
    label: "Star",
    src: "/examples/shapes/star.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path
          d="M24 8 L28.5 18.5 L40 20 L31.5 28 L34 39 L24 33.5 L14 39 L16.5 28 L8 20 L19.5 18.5 Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    id: "hexagon",
    label: "Hexagon",
    src: "/examples/shapes/hexagon.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path d="M24 8 L38 16 V32 L24 40 L10 32 V16 Z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    src: "/examples/shapes/line.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path
          d="M10 38 L38 10"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "arrow",
    label: "Arrow",
    src: "/examples/shapes/arrow.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path
          d="M8 24 H32 M24 14 L36 24 L24 34"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    ),
  },
];

export const PHOTO_PRESETS = [
  { id: "photo-1", label: "Sunset field", src: "/examples/photo-1.svg" },
  { id: "photo-2", label: "City night", src: "/examples/photo-2.svg" },
  { id: "photo-3", label: "Mountains", src: "/examples/photo-3.svg" },
  { id: "photo-4", label: "Gradient art", src: "/examples/photo-4.svg" },
  { id: "photo-5", label: "Forest", src: "/examples/photo-5.svg" },
  { id: "photo-6", label: "Ocean dusk", src: "/examples/photo-6.svg" },
];

/** CapCut/canvas-style one-tap text looks (style + entrance/exit). */
export interface TextEffectPreset {
  id: string;
  label: string;
  /** CSS accent for the thumb card. */
  swatch: string;
  text: Partial<TextStyle> & { content: string };
}

export const TEXT_EFFECT_PRESETS: TextEffectPreset[] = [
  {
    id: "basic",
    label: "Basic",
    swatch: "linear-gradient(145deg, #3a3a42 0%, #1e1e24 100%)",
    text: {
      content: "Title text",
      color: "#FFE566",
      fontSize: 48,
      align: "center",
      textAnimation: { ...DEFAULT_TEXT_ANIMATION },
    },
  },
  {
    id: "fade",
    label: "Fade",
    swatch: "linear-gradient(145deg, #4a5568 0%, #1a202c 100%)",
    text: {
      content: "Fade in",
      color: "#FFFFFF",
      fontSize: 44,
      align: "center",
      textAnimation: {
        in: "fade",
        out: "fade",
        inDurationSec: 0.6,
        outDurationSec: 0.6,
      },
    },
  },
  {
    id: "slide-up",
    label: "Slide Up",
    swatch: "linear-gradient(145deg, #2b6cb0 0%, #1a365d 100%)",
    text: {
      content: "Slide up",
      color: "#EBF8FF",
      fontSize: 46,
      align: "center",
      textAnimation: {
        in: "slideUp",
        out: "slideDown",
        inDurationSec: 0.55,
        outDurationSec: 0.45,
      },
    },
  },
  {
    id: "slide-left",
    label: "Slide In",
    swatch: "linear-gradient(145deg, #319795 0%, #1a4646 100%)",
    text: {
      content: "Coming in",
      color: "#E6FFFA",
      fontSize: 42,
      align: "center",
      textAnimation: {
        in: "slideLeft",
        out: "slideRight",
        inDurationSec: 0.5,
        outDurationSec: 0.5,
      },
    },
  },
  {
    id: "pop",
    label: "Pop",
    swatch: "linear-gradient(145deg, #ed8936 0%, #7b341e 100%)",
    text: {
      content: "POP!",
      color: "#FFFAF0",
      fontSize: 56,
      align: "center",
      textAnimation: {
        in: "scalePop",
        out: "fade",
        inDurationSec: 0.4,
        outDurationSec: 0.35,
      },
    },
  },
  {
    id: "neon",
    label: "Neon",
    swatch: "linear-gradient(145deg, #553c9a 0%, #1a1040 100%)",
    text: {
      content: "NEON",
      color: "#B794F4",
      fontSize: 52,
      align: "center",
      textAnimation: {
        in: "scalePop",
        out: "fade",
        inDurationSec: 0.45,
        outDurationSec: 0.5,
      },
    },
  },
  {
    id: "film",
    label: "Film",
    swatch: "linear-gradient(145deg, #d69e2e 0%, #744210 100%)",
    text: {
      content: "The End",
      color: "#FEFCBF",
      fontSize: 44,
      align: "center",
      textAnimation: {
        in: "fade",
        out: "fade",
        inDurationSec: 1,
        outDurationSec: 1.2,
      },
    },
  },
  {
    id: "caption",
    label: "Caption",
    swatch: "linear-gradient(145deg, #718096 0%, #2d3748 100%)",
    text: {
      content: "Lower third",
      color: "#FFFFFF",
      fontSize: 36,
      align: "center",
      textAnimation: {
        in: "slideUp",
        out: "slideDown",
        inDurationSec: 0.35,
        outDurationSec: 0.35,
      },
    },
  },
];
