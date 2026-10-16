import { useId } from "react";
import { cn } from "@/lib/utils";

/** Brand mark — split play glyph on dark rounded square. */
export function KlipCutLogo({
  className,
  title = "KlipCut",
}: {
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1A1033" />
          <stop offset="1" stopColor="#09060F" />
        </linearGradient>
        <linearGradient id={`${uid}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22E1FF" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id={`${uid}-bottom`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A855F7" />
          <stop offset="1" stopColor="#FF3D9A" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="112" fill={`url(#${uid}-bg)`} />
      <g transform="translate(-26 0)" strokeLinejoin="round" strokeWidth="26">
        <path
          d="M190 146 L390 240 L190 240 Z"
          transform="translate(0 -4)"
          fill={`url(#${uid}-top)`}
          stroke={`url(#${uid}-top)`}
        />
        <path
          d="M190 272 L390 272 L190 366 Z"
          transform="translate(0 4)"
          fill={`url(#${uid}-bottom)`}
          stroke={`url(#${uid}-bottom)`}
        />
      </g>
    </svg>
  );
}
