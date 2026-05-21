/**
 * Per-session "recent commands" history for the CommandPalette, persisted to
 * localStorage. Capped at MAX entries, MRU-first, deduped by exact payload.
 *
 * Payload is the exact send-shape so the palette can replay without guessing.
 */

export interface RecentEntry {
  /** Display label — typically the pasted text or the key name. */
  label: string;
  paste?: string;
  /** When true, an Enter is appended after the paste. */
  enter?: boolean;
  /** A tmux-style key (e.g. "C-c"); mutually exclusive with paste/enter. */
  key?: string;
}

export const MAX_RECENTS = 10;

function storageKey(session: string): string {
  return `switchboard:recents:${session}`;
}

function entriesEqual(a: RecentEntry, b: RecentEntry): boolean {
  return a.paste === b.paste && a.enter === b.enter && a.key === b.key;
}

export function readRecents(session: string): RecentEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(session));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything not shaped like a RecentEntry — keeps a corrupt write from
    // crashing the palette.
    return parsed.filter(
      (e): e is RecentEntry =>
        e && typeof e === "object" && typeof e.label === "string",
    );
  } catch {
    return [];
  }
}

function write(session: string, entries: RecentEntry[]): void {
  try {
    localStorage.setItem(storageKey(session), JSON.stringify(entries));
  } catch {
    /* storage unavailable — keep callers from blowing up */
  }
}

export function addRecent(session: string, entry: RecentEntry): RecentEntry[] {
  const existing = readRecents(session);
  const deduped = existing.filter((e) => !entriesEqual(e, entry));
  const next = [entry, ...deduped].slice(0, MAX_RECENTS);
  write(session, next);
  return next;
}

export function removeRecent(session: string, entry: RecentEntry): RecentEntry[] {
  const existing = readRecents(session);
  const next = existing.filter((e) => !entriesEqual(e, entry));
  write(session, next);
  return next;
}
