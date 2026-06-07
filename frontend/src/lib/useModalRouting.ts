import { useCallback, useMemo, useState } from "react";

/** A pending destructive action awaiting confirmation in the ConfirmDialog.
 *  Lives here rather than in App.tsx because the hook owns the state. */
export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

/** Read-only snapshot of every modal-routing flag. Booleans for the simple
 *  modals; target id / structured payload for the rest. */
export interface ModalFlags {
  // Simple booleans.
  settings: boolean;
  cleanup: boolean;
  shortcuts: boolean;
  search: boolean;
  templates: boolean;
  docs: boolean;
  newSession: boolean;
  // Target-bearing — null when closed, value when open.
  paletteTargetId: string | null;
  broadcastTargetIds: string[] | null;
  renameTargetId: string | null;
  newWindowSession: string | null;
  renameSessionTarget: string | null;
  autoRenameSession: string | null;
  confirm: ConfirmState | null;
}

/** Direct setState dispatchers, bundled. Callers write
 *  `setters.setSearch(true)` instead of `setShowSearch(true)`. */
export interface ModalSetters {
  setSettings: (open: boolean) => void;
  setCleanup: (open: boolean) => void;
  setShortcuts: (open: boolean) => void;
  setSearch: (open: boolean) => void;
  setTemplates: (open: boolean) => void;
  setDocs: (open: boolean) => void;
  setNewSession: (open: boolean) => void;
  setPaletteTargetId: (id: string | null) => void;
  setBroadcastTargetIds: (ids: string[] | null) => void;
  setRenameTargetId: (id: string | null) => void;
  setNewWindowSession: (sess: string | null) => void;
  setRenameSessionTarget: (sess: string | null) => void;
  setAutoRenameSession: (sess: string | null) => void;
  setConfirm: (c: ConfirmState | null) => void;
}

export interface ModalRouting {
  flags: ModalFlags;
  setters: ModalSetters;
  /** True when ANY modal/overlay is open. Single boolean replaces the
   *  hand-maintained `anyOverlay` chain that App.tsx had to keep in sync
   *  in two places. Memoized — re-renders only when membership changes. */
  anyOpen: boolean;
  /** Close every modal in one call. Used by route changes, deep links, and
   *  the future `Esc` / scrim fallback. */
  closeAll: () => void;
}

/** THI-229: a single hook owning every modal-routing flag in App.tsx.
 *
 *  Before this hook, App.tsx held 13 useStates that moved together and were
 *  referenced as a group in three places — the `anyOverlay` keydown guard,
 *  the keydown effect's dep array, and the `<Tour enabled={...}>` predicate.
 *  Drift between those three lists was the root of THI-206: a few flags
 *  (`showSearch`, `showTemplates`, `cleanupOpen`) were missing from the dep
 *  array, so the global keydown handler kept a stale closure that didn't
 *  treat them as overlays.
 *
 *  Bundling them here means `anyOpen` is the single boolean every consumer
 *  reads. New modals (Split-view rail, grouping toggle, etc. in v0.3 Track 3)
 *  add one entry here and automatically flow through to nav-suppression and
 *  the Tour gate. */
export function useModalRouting(): ModalRouting {
  // Simple booleans.
  const [settings, setSettings] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [search, setSearch] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [docs, setDocs] = useState(false);
  const [newSession, setNewSession] = useState(false);

  // Target-bearing.
  const [paletteTargetId, setPaletteTargetId] = useState<string | null>(null);
  const [broadcastTargetIds, setBroadcastTargetIds] = useState<string[] | null>(
    null,
  );
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [newWindowSession, setNewWindowSession] = useState<string | null>(null);
  const [renameSessionTarget, setRenameSessionTarget] = useState<string | null>(
    null,
  );
  const [autoRenameSession, setAutoRenameSession] = useState<string | null>(
    null,
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const flags = useMemo<ModalFlags>(
    () => ({
      settings,
      cleanup,
      shortcuts,
      search,
      templates,
      docs,
      newSession,
      paletteTargetId,
      broadcastTargetIds,
      renameTargetId,
      newWindowSession,
      renameSessionTarget,
      autoRenameSession,
      confirm,
    }),
    [
      settings,
      cleanup,
      shortcuts,
      search,
      templates,
      docs,
      newSession,
      paletteTargetId,
      broadcastTargetIds,
      renameTargetId,
      newWindowSession,
      renameSessionTarget,
      autoRenameSession,
      confirm,
    ],
  );

  const setters = useMemo<ModalSetters>(
    () => ({
      setSettings,
      setCleanup,
      setShortcuts,
      setSearch,
      setTemplates,
      setDocs,
      setNewSession,
      setPaletteTargetId,
      setBroadcastTargetIds,
      setRenameTargetId,
      setNewWindowSession,
      setRenameSessionTarget,
      setAutoRenameSession,
      setConfirm,
    }),
    // The setState dispatchers are referentially stable across renders, so
    // this memo runs exactly once. Listed in deps for completeness only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const anyOpen =
    settings ||
    cleanup ||
    shortcuts ||
    search ||
    templates ||
    docs ||
    newSession ||
    !!paletteTargetId ||
    !!broadcastTargetIds ||
    !!renameTargetId ||
    !!newWindowSession ||
    !!renameSessionTarget ||
    !!autoRenameSession ||
    !!confirm;

  const closeAll = useCallback(() => {
    setSettings(false);
    setCleanup(false);
    setShortcuts(false);
    setSearch(false);
    setTemplates(false);
    setDocs(false);
    setNewSession(false);
    setPaletteTargetId(null);
    setBroadcastTargetIds(null);
    setRenameTargetId(null);
    setNewWindowSession(null);
    setRenameSessionTarget(null);
    setAutoRenameSession(null);
    setConfirm(null);
  }, []);

  return { flags, setters, anyOpen, closeAll };
}
