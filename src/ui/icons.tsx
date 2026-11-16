import type { ReactNode } from 'react';

/** Pictogrammes au trait (24 × 24), dessinés pour l'application. */
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  pencil: <path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20ZM14.5 6l3 3" />,
  move: <path d="M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />,
  swap: <path d="M4 8h13M14 4.5 17.5 8 14 11.5M20 16H7M10 12.5 6.5 16l3.5 3.5" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />,
  starOff: (
    <>
      <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8L12 3.5Z" />
      <path d="M4 4l16 16" />
    </>
  ),
  grid: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="6.5" r="2.5" strokeDasharray="2.2 2" />
      <circle cx="6.5" cy="17.5" r="2.5" strokeDasharray="2.2 2" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  sort: <path d="M5 6h9M5 12h6M5 18h3M17 5v14M17 19l-3-3M17 19l3-3" />,
  glass: <path d="M7 3.5h10l-.6 5.2a4.4 4.4 0 0 1-8.8 0L7 3.5ZM12 13v7M8.5 20.5h7M7.6 8h8.8" />,
  dish: (
    <>
      <path d="M3.5 17.5h17M5 17.5a7 7 0 0 1 14 0" />
      <path d="M12 8V6.5M2.5 20.5h19" />
    </>
  ),
  sparkles: (
    <path d="M10 4.5 11.6 9 16 10.5 11.6 12 10 16.5 8.4 12 4 10.5 8.4 9 10 4.5ZM17.5 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
  ),
  hourglass: <path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 9 5 9 8.5s-9 3.500-9 8.500M16.500 3.500c0 5-9 5-9 8.500s9 3.500 9 8.500" />,
  camera: (
    <>
      <path d="M4 8.500h3L8.500 6h7L17 8.500h3v10.500H4V8.500Z" />
      <circle cx="12" cy="13.500" r="3.200" />
    </>
  ),
  image: (
    <>
      <rect x="3.500" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.500" />
      <path d="m4 17 5-4.500 4 3.500 3-2.500 4.500 4" />
    </>
  ),
  undo: <path d="M8.500 5 4 9.500 8.500 14M4 9.500h10a5.500 5.500 0 0 1 0 11h-3" />,
  redo: <path d="M15.500 5 20 9.500 15.500 14M20 9.500H10a5.500 5.500 0 0 0 0 11h3" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  file: <path d="M6.500 3.500h7.500l4 4V20.500h-11.500V3.500ZM14 3.500v4h4M9 12.500h6M9 16h6" />,
  folder: <path d="M3.500 6.500h6l2 2.500h9v10.500h-17V6.500Z" />,
  link: (
    <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1" />
  ),
  unlink: (
    <path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1M4 4l16 16" />
  ),
  share: <path d="M12 15V3.500M12 3.500 8 7.500M12 3.500l4 4M5.500 11.500v8.500h13v-8.500" />,
  download: <path d="M12 4v11.500M12 15.500l-4-4M12 15.500l4-4M5 20h14" />,
  upload: <path d="M12 15.500V4M12 4 8 8M12 4l4 4M5 20h14" />,
  mail: (
    <>
      <rect x="3.500" y="5.500" width="17" height="13" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  clipboard: (
    <>
      <path d="M8.500 5h-2.500v15.500h12V5h-2.500" />
      <rect x="8.500" y="3.500" width="7" height="3.500" rx="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.500v2.500M12 18v2.500M3.500 12h2.500M18 12h2.500M6 6l1.800 1.800M16.200 16.200 18 18M18 6l-1.800 1.800M7.800 16.200 6 18" />
    </>
  ),
  shelves: (
    <>
      <rect x="4" y="3.500" width="16" height="17" rx="2" />
      <path d="M4 9h16M4 14.500h16" />
    </>
  ),
  bot: (
    <>
      <rect x="4.500" y="8" width="15" height="11" rx="3" />
      <path d="M12 8V4.500M9.500 13v1.500M14.500 13v1.500" />
      <circle cx="12" cy="3.500" r="1" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.500" />
      <path d="M9.500 9.500a2.500 2.500 0 1 1 3.500 2.300c-.700.400-1 1-1 1.700M12 16.500v.500" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.500" />
      <path d="M12 11v5.500M12 7.500v.500" />
    </>
  ),
  warning: <path d="M12 4 21 19.500H3L12 4ZM12 10v4.500M12 17v.500" />,
  chevronDown: <path d="m6 9.500 6 6 6-6" />,
  chevronUp: <path d="m6 14.500 6-6 6 6" />,
  chevronLeft: <path d="m14.500 6-6 6 6 6" />,
  chevronRight: <path d="m9.500 6 6 6-6 6" />,
  arrowRight: <path d="M4.500 12h15M19.500 12l-5-5M19.500 12l-5 5" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.500" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M18.400 5.600 17 7M7 17l-1.400 1.400" />
    </>
  ),
  moon: <path d="M19.500 14.500A8 8 0 0 1 9.500 4.500a8 8 0 1 0 10 10Z" />,
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.500" />
      <path d="m16 16 4.500 4.500M8.500 11h5M11 8.500v5" />
    </>
  ),
  refresh: <path d="M19.500 12a7.500 7.500 0 1 1-2.200-5.300M19.500 4.500v4h-4" />,
  eraser: <path d="m4 15.500 9-9a2 2 0 0 1 2.800 0l3.200 3.200a2 2 0 0 1 0 2.800L12.500 19H8l-4-3.500ZM8.500 11l5.500 5.500M12.500 19h7.500" />,
  hand: <path d="M8 12V6.500a1.500 1.500 0 0 1 3 0V11M11 10.500V5a1.500 1.500 0 0 1 3 0v5.500M14 10.500V6.500a1.500 1.500 0 0 1 3 0v8a6 6 0 0 1-6 6h-.500a5 5 0 0 1-4.200-2.300L4 14.500a1.400 1.400 0 0 1 2.300-1.600L8 15" />,
  bottle: <path d="M10 3.500h4V8l1.500 3v9.500h-7V11L10 8V3.500ZM8.500 14h7" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }): ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
