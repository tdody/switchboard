import { useEffect, useState } from "react";
import { fetchIdeConfig, type IdeConfig } from "../api/client";

// Module-scoped one-shot cache. The IDE launcher is env-controlled on the
// backend, so the value doesn't change during a session — there's no point
// refetching per component mount, and we'd rather not show a "links missing"
// flash on a fresh TerminalModal open because the fetch hadn't resolved yet.
let cached: IdeConfig | null = null;
let inflight: Promise<IdeConfig> | null = null;

/** Read-only hook around `/api/ide-config`. Returns `null` until the first
 *  fetch resolves; the file-path linkifier treats that null as "off" so a
 *  stale modal doesn't act on links before the server has confirmed the IDE
 *  is configured (THI-146 PR 3). */
export function useIdeConfig(): IdeConfig | null {
  const [config, setConfig] = useState<IdeConfig | null>(cached);

  useEffect(() => {
    if (cached) return;
    if (!inflight) {
      inflight = fetchIdeConfig().catch(() => ({
        enabled: false,
        command: null,
        allowed: [],
      }));
    }
    inflight.then((c) => {
      cached = c;
      setConfig(c);
    });
  }, []);

  return config;
}
