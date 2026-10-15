/**
 * Minimal, consistent stroke icon set (16×16 viewBox, currentColor).
 * Replaces the ad-hoc emoji/unicode glyphs previously used in the chrome.
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 3.4v9.2l8-4.6-8-4.6Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.2" y="3.4" width="2.6" height="9.2" rx="0.7" fill="currentColor" stroke="none" />
    <rect x="9.2" y="3.4" width="2.6" height="9.2" rx="0.7" fill="currentColor" stroke="none" />
  </Svg>
);

export const StepBackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.5 3.4v9.2L5.5 8l7-4.6Z" fill="currentColor" stroke="none" />
    <rect x="3" y="3.4" width="1.6" height="9.2" rx="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const StepForwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 3.4v9.2L10.5 8l-7-4.6Z" fill="currentColor" stroke="none" />
    <rect x="11.4" y="3.4" width="1.6" height="9.2" rx="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const RewindIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 4v8l-5-4 5-4Z" fill="currentColor" stroke="none" />
    <path d="M7.5 4v8l-5-4 5-4Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const ForwardIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4v8l5-4-5-4Z" fill="currentColor" stroke="none" />
    <path d="M8.5 4v8l5-4-5-4Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const GoStartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h8" />
    <path d="M8.5 4.5 5 8l3.5 3.5" />
    <rect x="2.6" y="3.4" width="1.4" height="9.2" rx="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const GoEndIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8h8" />
    <path d="M7.5 4.5 11 8l-3.5 3.5" />
    <rect x="12" y="3.4" width="1.4" height="9.2" rx="0.6" fill="currentColor" stroke="none" />
  </Svg>
);

export const SplitIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4" cy="3.6" r="1.6" />
    <circle cx="4" cy="12.4" r="1.6" />
    <path d="M5.2 4.7 12 10M5.2 11.3 12 6" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.4h10" />
    <path d="M6.3 4.4 6.6 3h2.8l.3 1.4" />
    <path d="M4.4 4.4 4.9 13a1.2 1.2 0 0 0 1.2 1.1h3.8A1.2 1.2 0 0 0 11.1 13l.5-8.6" />
    <path d="M6.7 7v4.2M9.3 7v4.2" />
  </Svg>
);

export const MagnetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 3v5a4 4 0 0 0 8 0V3" />
    <path d="M4 6.4h2.6M9.4 6.4H12" />
  </Svg>
);

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 7.5h6a3.2 3.2 0 0 1 0 6.4H6.6" />
    <path d="M6 4.7 3.4 7.5 6 10.3" />
  </Svg>
);

export const RedoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12.5 7.5h-6a3.2 3.2 0 0 0 0 6.4h2.9" />
    <path d="M10 4.7l2.6 2.8L10 10.3" />
  </Svg>
);

export const ImportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10.5V2.6" />
    <path d="M5 5.6 8 2.6l3 3" />
    <path d="M3 10v2.4A1.6 1.6 0 0 0 4.6 14h6.8A1.6 1.6 0 0 0 13 12.4V10" />
  </Svg>
);

export const MediaIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.6" />
    <path d="M3.4 11.2 6.6 8l2.2 2.2 1.8-1.8 1.6 1.6" />
    <circle cx="6" cy="6.2" r="1" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.6h10M3 8h10M3 11.4h10" />
    <circle cx="6" cy="4.6" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="5" cy="11.4" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

export const CanvasIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.4" y="3" width="11.2" height="8" rx="1.4" />
    <path d="M6 13.2h4" />
  </Svg>
);

export const TextIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 4.2V3.2h9.2v1" />
    <path d="M8 3.4v9.4M6.2 12.8h3.6" />
  </Svg>
);

export const AudioIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 11.4V4.6l6-1.4v6.4" />
    <circle cx="4.4" cy="11.4" r="1.7" />
    <circle cx="10.4" cy="9.6" r="1.7" />
  </Svg>
);

export const PhotosIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.6" />
    <circle cx="6" cy="6.4" r="1.1" />
    <path d="M3.4 11.4 6.8 8l2.4 2.4 1.6-1.6 1.8 2.2" />
  </Svg>
);

export const ShapeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.6" y="8.2" width="6.4" height="5.2" rx="1" />
    <circle cx="11.2" cy="5.2" r="2.8" />
    <path d="M7.2 2.8 11.6 10.8 H2.8 Z" />
  </Svg>
);

export const SubtitlesIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.4" y="3.4" width="11.2" height="9.2" rx="1.6" />
    <path d="M5 8.2h2.4M9.4 8.2h1.6M5 10.4h1.6M8.2 10.4h2.8" />
  </Svg>
);

export const ExportIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.6v7.9" />
    <path d="M5 7.5 8 10.5l3-3" />
    <path d="M3 10.6V12.6A1.6 1.6 0 0 0 4.6 14.2h6.8A1.6 1.6 0 0 0 13 12.6v-2" />
  </Svg>
);

export const VolumeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 6.4h2.2L8 3.6v8.8L5.2 9.6H3Z" fill="currentColor" stroke="none" />
    <path d="M10.2 6.2a2.6 2.6 0 0 1 0 3.6M11.8 4.8a4.6 4.6 0 0 1 0 6.4" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.8 8s2.4-4 6.2-4 6.2 4 6.2 4-2.4 4-6.2 4S1.8 8 1.8 8Z" />
    <circle cx="8" cy="8" r="1.8" />
  </Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 4.4C2.3 5.5 1.8 6.6 1.8 8c0 0 2.4 4 6.2 4 1 0 2-.3 2.8-.7" />
    <path d="M6.2 4.2c.6-.1 1.2-.2 1.8-.2 3.8 0 6.2 4 6.2 4-.3.5-.9 1.3-1.7 2" />
    <path d="M2.6 2.6l10.8 10.8" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.4" />
    <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7" />
  </Svg>
);

export const LockOpenIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.4" y="7" width="9.2" height="6.4" rx="1.4" />
    <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.7-.7" />
  </Svg>
);

export const ChevronUpIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 9.8 8 6l3.8 3.8" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.2 6.2 8 10l3.8-3.8" />
  </Svg>
);

export const ZoomInIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.6 13.6" />
    <path d="M7 5.2v3.6M5.2 7h3.6" />
  </Svg>
);

export const ZoomOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2 13.6 13.6" />
    <path d="M5.2 7h3.6" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.4v9.2M3.4 8h9.2" />
  </Svg>
);

export const DiamondIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.6 13.4 8 8 13.4 2.6 8 8 2.6Z" fill="currentColor" stroke="none" />
  </Svg>
);

export const MarkerInIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3v10" />
    <path d="M5 3.4h6.4L9.6 6.6l1.8 3.2H5" fill="currentColor" stroke="none" />
  </Svg>
);

export const MarkerOutIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11 3v10" />
    <path d="M11 3.4H4.6L6.4 6.6 4.6 9.8H11" fill="currentColor" stroke="none" />
  </Svg>
);

export const SpeedIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 12a6 6 0 1 1 10.8 0" />
    <path d="M8 12l3-3.6" />
    <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const RampIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.6 12.6C6 12.6 6.4 3.6 13.4 3.6" />
    <circle cx="2.6" cy="12.6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="13.4" cy="3.6" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const CursorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.4 2.8 12 8.6l-3.6.5-1.3 3.4-3.7-9.7Z" />
  </Svg>
);

export const HandIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 7V4.2a1.1 1.1 0 0 1 2.2 0V7" />
    <path d="M7.2 6.6V3.4a1.1 1.1 0 0 1 2.2 0v3.2" />
    <path d="M9.4 6.9V4.4a1.1 1.1 0 0 1 2.2 0V9a4.4 4.4 0 0 1-8.8 0V8.2a1.1 1.1 0 0 1 2.2 0" />
  </Svg>
);

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.6h10M3 8h10M3 11.4h10" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.6" />
    <path d="M8 7.2v3.4M8 5.2h.01" />
  </Svg>
);
