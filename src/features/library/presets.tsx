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
  {
    id: "logo",
    label: "Logo",
    src: "/examples/shapes/logo.svg",
    draw: ({ className }) => (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <rect x="6" y="6" width="36" height="36" rx="9" fill="#111318" />
        <path d="M20 16 L32 24 L20 32 Z" fill="#5B8DEF" />
        <rect x="13" y="36" width="22" height="2.4" rx="1.2" fill="#FFE566" />
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

/** One-tap text looks (style + entrance/exit). */
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
      fontWeight: 700,
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
      fontWeight: 600,
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
      fontWeight: 700,
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
      fontWeight: 700,
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
      fontWeight: 800,
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
      fontWeight: 800,
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
      fontWeight: 600,
      italic: true,
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
      fontWeight: 600,
      align: "center",
      backgroundColor: "#000000",
      backgroundPadding: 14,
      backgroundRadius: 8,
      textAnimation: {
        in: "slideUp",
        out: "slideDown",
        inDurationSec: 0.35,
        outDurationSec: 0.35,
      },
    },
  },
  {
    id: "highlight",
    label: "Highlight",
    swatch: "linear-gradient(145deg, #f6e05e 0%, #b7791f 100%)",
    text: {
      content: "Key point",
      color: "#1A202C",
      fontSize: 40,
      fontWeight: 800,
      align: "center",
      backgroundColor: "#FFE566",
      backgroundPadding: 16,
      backgroundRadius: 12,
      textAnimation: {
        in: "scalePop",
        out: "fade",
        inDurationSec: 0.35,
        outDurationSec: 0.4,
      },
    },
  },
  {
    id: "marker",
    label: "Marker",
    swatch: "linear-gradient(145deg, #fc8181 0%, #9b2c2c 100%)",
    text: {
      content: "Important",
      color: "#FFFFFF",
      fontSize: 38,
      fontWeight: 700,
      align: "center",
      backgroundColor: "#E53E3E",
      backgroundPadding: 14,
      backgroundRadius: 6,
      textAnimation: {
        in: "slideLeft",
        out: "fade",
        inDurationSec: 0.4,
        outDurationSec: 0.35,
      },
    },
  },
  {
    id: "soft-pill",
    label: "Soft Pill",
    swatch: "linear-gradient(145deg, #90cdf4 0%, #2b6cb0 100%)",
    text: {
      content: "Note",
      color: "#1A365D",
      fontSize: 36,
      fontWeight: 600,
      align: "center",
      backgroundColor: "#BEE3F8",
      backgroundPadding: 18,
      backgroundRadius: 24,
      textAnimation: {
        in: "fade",
        out: "fade",
        inDurationSec: 0.45,
        outDurationSec: 0.45,
      },
    },
  },
  {
    id: "typewriter",
    label: "Typewriter",
    swatch: "linear-gradient(145deg, #a0aec0 0%, #2d3748 100%)",
    text: {
      content: "Type this",
      fontFamily: "JetBrains Mono Variable",
      color: "#E2E8F0",
      fontSize: 34,
      fontWeight: 500,
      align: "left",
      textAnimation: {
        in: "slideRight",
        out: "fade",
        inDurationSec: 0.5,
        outDurationSec: 0.4,
      },
    },
  },
  {
    id: "italic-quote",
    label: "Quote",
    swatch: "linear-gradient(145deg, #c3dafe 0%, #4c51bf 100%)",
    text: {
      content: "“A short quote.”",
      color: "#EBF4FF",
      fontSize: 40,
      fontWeight: 500,
      italic: true,
      align: "center",
      textAnimation: {
        in: "fade",
        out: "fade",
        inDurationSec: 0.7,
        outDurationSec: 0.7,
      },
    },
  },
  {
    id: "bold-title",
    label: "Bold Title",
    swatch: "linear-gradient(145deg, #faf089 0%, #975a16 100%)",
    text: {
      content: "BIG TITLE",
      color: "#FFFFFF",
      fontSize: 64,
      fontWeight: 900,
      align: "center",
      textAnimation: {
        in: "scalePop",
        out: "slideUp",
        inDurationSec: 0.4,
        outDurationSec: 0.45,
      },
    },
  },
  {
    id: "underline",
    label: "Underline",
    swatch: "linear-gradient(145deg, #9ae6b4 0%, #276749 100%)",
    text: {
      content: "Emphasize",
      color: "#F0FFF4",
      fontSize: 42,
      fontWeight: 700,
      underline: true,
      align: "center",
      textAnimation: {
        in: "slideUp",
        out: "fade",
        inDurationSec: 0.45,
        outDurationSec: 0.4,
      },
    },
  },
  {
    id: "drop-from-top",
    label: "Drop In",
    swatch: "linear-gradient(145deg, #fbb6ce 0%, #97266d 100%)",
    text: {
      content: "Drop in",
      color: "#FFF5F7",
      fontSize: 48,
      fontWeight: 700,
      align: "center",
      textAnimation: {
        in: "slideDown",
        out: "slideUp",
        inDurationSec: 0.5,
        outDurationSec: 0.45,
      },
    },
  },
];
