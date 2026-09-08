import type { JSX } from "preact";

/**
 * Our own icon set: plain geometric strokes on a 24 grid. Drawn here rather
 * than copied from any app, per ARCHITECTURE section 6.2.
 */
const PATHS: Record<string, JSX.Element> = {
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7l1.2-2h6.2l1.2 2h1.7A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.6" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.6" />
      <path d="m4 17 4.5-4.5 3.5 3.5 3-3 5 5" />
    </>
  ),
  flash: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />,
  flashOff: (
    <>
      <path d="M13 2 8.9 7.6M11 13.5H4.5l3-4M10 22l3.6-4.9M19.5 10.5H12l.6-1" />
      <path d="m3 3 18 18" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" />
    </>
  ),
  history: (
    <>
      <path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2" />
      <path d="M3 4.5V9h4.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  close: <path d="m5 5 14 14M19 5 5 19" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  play: <path d="M8 5.2v13.6l11-6.8z" />,
  pause: <path d="M9 5v14M15 5v14" />,
  replay: (
    <>
      <path d="M20.8 12a8.8 8.8 0 1 1-2.6-6.2" />
      <path d="M21 4.5V9h-4.5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.5h16M9.5 6.5V4h5v2.5" />
      <path d="M6.5 6.5 7.5 20h9l1-13.5" />
      <path d="M10.5 10v6.5M13.5 10v6.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V7.5A1.5 1.5 0 0 1 5 6h4.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  gauge: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 12 15.5 8.5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  size?: number;
  filled?: boolean;
  class?: string;
}

export function Icon({ name, size = 24, filled = false, class: className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      class={className}
    >
      {PATHS[name]}
    </svg>
  );
}
