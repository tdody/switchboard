import type { Kind, Status } from "../types";
import type { IconName } from "../components/Icon";

export const STATUS_META: Record<Status, { label: string; tone: string }> = {
  running: { label: "running", tone: "cyan" },
  waiting: { label: "waiting", tone: "amber" },
  idle: { label: "idle", tone: "gray" },
  done: { label: "done", tone: "green" },
  error: { label: "error", tone: "red" },
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
