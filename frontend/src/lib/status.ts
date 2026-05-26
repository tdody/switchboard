import type { Kind, Status } from "../types";
import type { IconName } from "../components/Icon";

export const STATUS_META: Record<Status, { label: string; tone: string; description: string }> = {
  // Description is the user-facing copy in StatusLegend (THI-96). Kept here
  // so the legend and any future hover-tooltips on the StatusPill stay in
  // sync without duplicating strings.
  running: {
    label: "running",
    tone: "cyan",
    description: "a long-running process is active",
  },
  waiting: {
    label: "waiting",
    tone: "amber",
    description: "agent is asking for your input",
  },
  idle: {
    label: "idle",
    tone: "gray",
    description: "shell prompt is idle",
  },
  done: {
    label: "done",
    tone: "green",
    description: "process completed",
  },
  error: {
    label: "error",
    tone: "red",
    description: "process exited with an error",
  },
};

export function kindIcon(kind: Kind): IconName {
  switch (kind) {
    case "agent":
      return "agent";
    case "editor":
      return "editor";
    case "server":
      return "server";
    case "logs":
      return "logs";
    case "shell":
      return "shell";
    default:
      return "term";
  }
}

// CPU: amber ≥60%, red ≥85%. Mem: amber ≥1024 MB, red ≥2048 MB.
export function cpuLevel(c: number): "" | "warn" | "danger" {
  if (c >= 85) return "danger";
  if (c >= 60) return "warn";
  return "";
}
export function memLevel(m: number): "" | "warn" | "danger" {
  if (m >= 2048) return "danger";
  if (m >= 1024) return "warn";
  return "";
}

// Per-agent context-window usage band (THI-131). Drives the left-edge accent
// strip on agent cards. Conventional traffic-light pacing: 50/75/90. Tune
// thresholds here — no backend change required.
export type ContextBand = "" | "ctx-low" | "ctx-mid" | "ctx-high" | "ctx-crit";

export function contextBand(pct: number | null | undefined): ContextBand {
  if (pct == null) return "";
  if (pct >= 90) return "ctx-crit";
  if (pct >= 75) return "ctx-high";
  if (pct >= 50) return "ctx-mid";
  return "ctx-low";
}
