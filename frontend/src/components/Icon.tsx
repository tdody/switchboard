import type { CSSProperties, SVGProps } from "react";

export type IconName =
  | "search"
  | "x"
  | "plus"
  | "minus"
  | "trash"
  | "settings"
  | "sparkle"
  | "focus"
  | "rename"
  | "send"
  | "term"
  | "git-branch"
  | "git-pr"
  | "check"
  | "alert"
  | "moon"
  | "grid"
  | "kanban"
  | "list"
  | "play"
  | "pause"
  | "filter"
  | "more"
  | "copy"
  | "kbd"
  | "session"
  | "cpu"
  | "mem"
  | "clock"
  | "spinner"
  | "arrow-r"
  | "enter"
  | "agent"
  | "editor"
  | "server"
  | "logs"
  | "shell";

interface IconProps {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ name, size = 14, style, className }: IconProps) {
  const props: SVGProps<SVGSVGElement> = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style,
    className,
  };
  switch (name) {
    case "search":
      return (
        <svg {...props}>
          <circle cx="7" cy="7" r="4.5" />
          <path d="m13 13-2.6-2.6" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="m4 4 8 8M12 4l-8 8" />
        </svg>
      );
    case "plus":
      return (
        <svg {...props}>
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      );
    case "minus":
      return (
        <svg {...props}>
          <path d="M3.5 8h9" />
        </svg>
      );
    case "trash":
      return (
        <svg {...props}>
          <path d="M3 4.5h10M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4.6 4.5l.6 8a1 1 0 0 0 1 .95h3.6a1 1 0 0 0 1-.95l.6-8M7 7v3.4M9 7v3.4" />
        </svg>
      );
    case "settings":
      // A cog: hub + gear body + stubby rim teeth. (The old version had no
      // body circle and read as a sun.)
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="1.7" />
          <circle cx="8" cy="8" r="4.4" />
          <path d="M8 3.6V1.6M8 12.4v2M12.4 8h2M3.6 8h-2M11.1 4.9 12.5 3.5M4.9 4.9 3.5 3.5M11.1 11.1 12.5 12.5M4.9 11.1 3.5 12.5" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...props}>
          <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" />
        </svg>
      );
    case "focus":
      return (
        <svg {...props}>
          <path d="M3 6V3.5A.5.5 0 0 1 3.5 3H6M10 3h2.5a.5.5 0 0 1 .5.5V6M13 10v2.5a.5.5 0 0 1-.5.5H10M6 13H3.5a.5.5 0 0 1-.5-.5V10" />
        </svg>
      );
    case "rename":
      return (
        <svg {...props}>
          <path d="M11.5 2.5 13.5 4.5 5 13H3v-2L11.5 2.5Z" />
        </svg>
      );
    case "send":
      return (
        <svg {...props}>
          <path d="m2.5 8 11-5-4 11-2-4-5-2Z" />
        </svg>
      );
    case "term":
      return (
        <svg {...props}>
          <rect x="2" y="3" width="12" height="10" rx="1.2" />
          <path d="m5 7 2 1.5L5 10M9 10h3" />
        </svg>
      );
    case "git-branch":
      return (
        <svg {...props}>
          <circle cx="4" cy="3.5" r="1.2" />
          <circle cx="4" cy="12.5" r="1.2" />
          <circle cx="12" cy="6.5" r="1.2" />
          <path d="M4 4.7v6.6M4 9c0-2 2-2.5 4-2.5h2" />
        </svg>
      );
    case "git-pr":
      return (
        <svg {...props}>
          <circle cx="4" cy="3.5" r="1.2" />
          <circle cx="4" cy="12.5" r="1.2" />
          <circle cx="12" cy="12.5" r="1.2" />
          <path d="M4 4.7v6.6M12 5v6.3M12 5h-1.5a2 2 0 0 0-2 2V8" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="m3 8.5 3 3 7-7" />
        </svg>
      );
    case "alert":
      return (
        <svg {...props}>
          <path d="M8 2.5 14.5 13H1.5L8 2.5ZM8 7v3M8 11.7v.1" />
        </svg>
      );
    case "moon":
      return (
        <svg {...props}>
          <path d="M13 9a5 5 0 0 1-6-6 5 5 0 1 0 6 6Z" />
        </svg>
      );
    case "grid":
      return (
        <svg {...props}>
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.6" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.6" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.6" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="0.6" />
        </svg>
      );
    case "kanban":
      return (
        <svg {...props}>
          <rect x="2" y="2.5" width="3.5" height="11" rx="0.6" />
          <rect x="6.5" y="2.5" width="3.5" height="7" rx="0.6" />
          <rect x="11" y="2.5" width="3" height="9" rx="0.6" />
        </svg>
      );
    case "list":
      return (
        <svg {...props}>
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      );
    case "play":
      return (
        <svg {...props}>
          <path d="m4 3 9 5-9 5Z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...props}>
          <path d="M5 3v10M11 3v10" />
        </svg>
      );
    case "filter":
      return (
        <svg {...props}>
          <path d="M2 3h12l-4.5 5.5V13L6.5 11.5V8.5L2 3Z" />
        </svg>
      );
    case "more":
      return (
        <svg {...props}>
          <circle cx="3.5" cy="8" r=".9" />
          <circle cx="8" cy="8" r=".9" />
          <circle cx="12.5" cy="8" r=".9" />
        </svg>
      );
    case "copy":
      return (
        <svg {...props}>
          <rect x="5" y="5" width="9" height="9" rx="1.2" />
          <path d="M2.5 10.5V3.2A.7.7 0 0 1 3.2 2.5h7.3" />
        </svg>
      );
    case "kbd":
      return (
        <svg {...props}>
          <rect x="1.5" y="4" width="13" height="8" rx="1.2" />
          <path d="M4 7h.1M6 7h.1M8 7h.1M10 7h.1M12 7h.1M5 9.5h6" />
        </svg>
      );
    case "session":
      return (
        <svg {...props}>
          <rect x="2" y="3" width="12" height="10" rx="1.2" />
          <path d="M2 6h12" />
          <circle cx="4" cy="4.5" r=".5" fill="currentColor" />
          <circle cx="5.5" cy="4.5" r=".5" fill="currentColor" />
        </svg>
      );
    case "cpu":
      return (
        <svg {...props}>
          <rect x="4" y="4" width="8" height="8" rx="1" />
          <path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5h2.5M1.5 9.5h2.5M12 6.5h2.5M12 9.5h2.5" />
        </svg>
      );
    case "mem":
      return (
        <svg {...props}>
          <rect x="2" y="6" width="12" height="4" rx=".7" />
          <path d="M4 6V4M7 6V4M10 6V4M13 6V4M4 12v-2M7 12v-2M10 12v-2M13 12v-2" />
        </svg>
      );
    case "clock":
      return (
        <svg {...props}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3l2 1.5" />
        </svg>
      );
    case "spinner":
      return (
        <svg {...props}>
          <path d="M8 1.5a6.5 6.5 0 1 1-6.5 6.5" />
        </svg>
      );
    case "arrow-r":
      return (
        <svg {...props}>
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      );
    case "enter":
      return (
        <svg {...props}>
          <path d="M13 3v4a2 2 0 0 1-2 2H3M6 6 3 9l3 3" />
        </svg>
      );
    case "agent":
      // Claude Code mark from @lobehub/icons (claudecode.svg). Square 24×24
      // viewBox preserves the original aspect ratio inside the square slot.
      return (
        <svg {...props} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
          />
        </svg>
      );
    case "editor":
      return (
        <svg {...props}>
          <path d="M3 2v12M5 2v12M10 4l3 4-3 4" />
        </svg>
      );
    case "server":
      return (
        <svg {...props}>
          <rect x="2" y="3.5" width="12" height="3.5" rx=".7" />
          <rect x="2" y="9" width="12" height="3.5" rx=".7" />
          <circle cx="4" cy="5.2" r=".5" fill="currentColor" />
          <circle cx="4" cy="10.7" r=".5" fill="currentColor" />
        </svg>
      );
    case "logs":
      return (
        <svg {...props}>
          <path d="M3 3h10M3 6h7M3 9h10M3 12h5" />
        </svg>
      );
    case "shell":
      return (
        <svg {...props}>
          <path d="m3 4 3 4-3 4M8 12h5" />
        </svg>
      );
    default:
      return <svg {...props} />;
  }
}
