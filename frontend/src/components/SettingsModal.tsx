import { useEffect, useState } from "react";

import { fetchAiStatus, fetchUsageConfig } from "../api/client";
import {
  ACCENT_TOKENS,
  accentColor,
  type Accent,
  type ColumnSize,
  type Density,
  POLL_MAX_S,
  POLL_MIN_S,
  type Theme,
  updateSettings,
  useSettings,
} from "../lib/settings";
import { replayTour } from "../lib/tour";
import { useIdeConfig } from "../lib/useIdeConfig";
import { useScrimClose } from "../lib/useScrimClose";
import type { AiStatus, UsageConfig } from "../types";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";
import { Toggle } from "./Toggle";

const ACCENTS = Object.keys(ACCENT_TOKENS) as Accent[];

interface Props {
  serverAddr: string;
  sessionCount: number;
  windowCount: number;
  onClose: () => void;
  onOpenCleanup?: () => void;
}

export function SettingsModal({ serverAddr, sessionCount, windowCount, onClose, onOpenCleanup }: Props) {
  const scrimProps = useScrimClose(onClose);
  const settings = useSettings();
  // Anthropic key status (THI-67). Fetched on mount; null while in flight.
  // Read-only — the user edits their shell rc / .env and reopens Settings.
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchAiStatus().then(
      (s) => {
        if (!cancelled) setAiStatus(s);
      },
      () => {
        /* status endpoint unreachable — leave loading state */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // IDE config (THI-146 PR 4). Module-level cached, so a re-open of the
  // modal hits the cache; the dropdown is built from `available`.
  const ideConfig = useIdeConfig();
  // Claude usage config (THI-110 commit 3). Fetched once on Settings open;
  // null while in flight. Read-only — TTL knobs are server-startup config.
  const [usageConfig, setUsageConfig] = useState<UsageConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchUsageConfig().then(
      (c) => {
        if (!cancelled) setUsageConfig(c);
      },
      () => {
        /* /api/usage/config unreachable — leave loading state */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pollSeconds = Math.round(settings.pollIntervalMs / 1000);

  // Enabling browser notifications requires OS permission — if the user
  // denies the prompt, snap the toggle back off.
  const toggleBrowserNotifications = async (next: boolean) => {
    if (next && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      updateSettings({ notifyBrowser: perm === "granted" });
    } else {
      updateSettings({ notifyBrowser: next });
    }
  };

  return (
    <div className="scrim" {...scrimProps}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-hd">
          <SwitchboardMark size={22} />
          <span>Settings</span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <span className="connect-pill">
            <span className="dot" />
            connected · {serverAddr}
          </span>
          <button className="btn btn-icon btn-ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="x" />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-group">
            <h4>Connection</h4>
            <div className="settings-row">
              <span>
                <div className="name">Server URL</div>
                <div className="desc">The local Switchboard server.</div>
              </span>
              <span className="val">http://{serverAddr}</span>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Poll interval</div>
                <div className="desc">How often the dashboard fetches /api/state.</div>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={POLL_MIN_S}
                  max={POLL_MAX_S}
                  step={1}
                  value={pollSeconds}
                  onChange={(e) =>
                    updateSettings({ pollIntervalMs: Number(e.target.value) * 1000 })
                  }
                  style={{ flex: 1 }}
                />
                <span className="val">{pollSeconds}s</span>
              </span>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Live terminal stream</div>
                <div className="desc">
                  Stream /ws/pane when a window is open. Off = static snapshot only.
                </div>
              </span>
              <span className="val">{settings.wsStreamEnabled ? "websocket" : "snapshot"}</span>
              <Toggle
                on={settings.wsStreamEnabled}
                label="Live terminal stream"
                onChange={(v) => updateSettings({ wsStreamEnabled: v })}
              />
            </div>
          </div>

          <div className="settings-group">
            <h4>Auto-rename</h4>
            <div className="settings-row">
              <span>
                <div className="name">Anthropic API key</div>
                <div className="desc">
                  {aiStatus === null && "Checking…"}
                  {aiStatus?.source === "none" && (
                    <>
                      Not set. Export <code>ANTHROPIC_API_KEY</code> in your
                      shell rc and restart the server to enable auto-rename.
                    </>
                  )}
                  {aiStatus?.source === "env" && (
                    <>
                      Picked up from <code>ANTHROPIC_API_KEY</code> in your
                      shell environment.
                    </>
                  )}
                  {aiStatus?.source === "config" && (
                    <>
                      Set via <code>SWITCHBOARD_ANTHROPIC_API_KEY</code> (in
                      <code>.env</code> or the launch environment).
                    </>
                  )}
                </div>
              </span>
              <span className="val" style={{ fontFamily: "var(--font-mono)" }}>
                {aiStatus?.masked ?? "—"}
              </span>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Model</div>
                <div className="desc">
                  Used by the ✨ auto-rename modal. Configure via{" "}
                  <code>SWITCHBOARD_ANTHROPIC_MODEL</code>.
                </div>
              </span>
              <span className="val" style={{ fontFamily: "var(--font-mono)" }}>
                {aiStatus?.model ?? "—"}
              </span>
              <span />
            </div>
          </div>

          <div className="settings-group">
            <h4>Claude usage</h4>
            <div className="settings-row">
              <span>
                <div className="name">Token aggregation</div>
                <div className="desc">
                  Sums tokens from <code>~/.claude/projects/*.jsonl</code> over
                  the last {usageConfig ? `${usageConfig.tokenTtlS}s` : "30s"}{" "}
                  cache. Always on; no claude binary spawn.
                </div>
              </span>
              <span className="val">always on</span>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Plan-% scraping</div>
                <div className="desc">
                  {usageConfig === null && "Checking…"}
                  {usageConfig?.scrapeEnabled && (
                    <>
                      Runs <code>claude /usage</code> in a hidden tmux session
                      every {Math.round(usageConfig.scrapeTtlS / 60)}min. Costs a
                      small claude inference per scrape. Disable with{" "}
                      <code>SWITCHBOARD_USAGE_SCRAPE_ENABLED=false</code>.
                    </>
                  )}
                  {usageConfig && !usageConfig.scrapeEnabled && (
                    <>
                      Disabled. Header pill falls back to the token-window
                      estimate. Enable with{" "}
                      <code>SWITCHBOARD_USAGE_SCRAPE_ENABLED=true</code>.
                    </>
                  )}
                </div>
              </span>
              <span className="val">
                {usageConfig === null ? "—" : usageConfig.scrapeEnabled ? "enabled" : "disabled"}
              </span>
              <span />
            </div>
          </div>

          <div className="settings-group">
            <h4>Appearance</h4>
            <div className="settings-row">
              <span>
                <div className="name">Theme</div>
                <div className="desc">Color scheme for the dashboard.</div>
              </span>
              <select
                value={settings.theme}
                onChange={(e) => updateSettings({ theme: e.target.value as Theme })}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="contrast">High contrast</option>
                <option value="phosphor">Phosphor</option>
              </select>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Accent</div>
                <div className="desc">Highlight color for active elements.</div>
              </span>
              <span className="accent-swatches">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`swatch ${settings.accent === a ? "is-active" : ""}`}
                    style={{ background: accentColor(a) }}
                    title={a}
                    aria-label={`Accent: ${a}`}
                    aria-pressed={settings.accent === a}
                    onClick={() => updateSettings({ accent: a })}
                  />
                ))}
              </span>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Card density</div>
                <div className="desc">Preview shows the last lines of pane output on each card.</div>
              </span>
              <select
                value={settings.density}
                onChange={(e) => updateSettings({ density: e.target.value as Density })}
              >
                <option value="compact">Compact</option>
                <option value="comfy">Comfy</option>
                <option value="preview">Preview</option>
              </select>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Column width</div>
                <div className="desc">Width of each kanban column. Narrow / Normal / Wide.</div>
              </span>
              <select
                value={settings.columnSize}
                onChange={(e) =>
                  updateSettings({ columnSize: e.target.value as ColumnSize })
                }
              >
                <option value="narrow">Narrow</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </select>
              <span />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Reduced motion</div>
                <div className="desc">Disable pulses, spinners, and transitions.</div>
              </span>
              <span className="val">{settings.reducedMotion ? "on" : "off"}</span>
              <Toggle
                on={settings.reducedMotion}
                label="Reduced motion"
                onChange={(v) => updateSettings({ reducedMotion: v })}
              />
            </div>
          </div>

          <div className="settings-group">
            <h4>Notifications</h4>
            <div className="settings-row">
              <span>
                <div className="name">Pending-input badge</div>
                <div className="desc">Show a count in the browser tab title when agents wait.</div>
              </span>
              <span className="val">{settings.notifyBadge ? "enabled" : "off"}</span>
              <Toggle
                on={settings.notifyBadge}
                label="Pending-input badge"
                onChange={(v) => updateSettings({ notifyBadge: v })}
              />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Browser notifications</div>
                <div className="desc">Native OS notification when an agent needs you.</div>
              </span>
              <span className="val">{settings.notifyBrowser ? "on" : "off"}</span>
              <Toggle
                on={settings.notifyBrowser}
                label="Browser notifications"
                onChange={(v) => void toggleBrowserNotifications(v)}
              />
            </div>
            <div className="settings-row">
              <span>
                <div className="name">Replay first-run tour</div>
                <div className="desc">
                  Re-show the 4-step intro right now — reloads the dashboard.
                </div>
              </span>
              <span className="val" />
              <button className="btn" onClick={() => replayTour()}>
                Reset
              </button>
            </div>
          </div>

          <div className="settings-group">
            <h4>Editor</h4>
            <div className="settings-row">
              <span>
                <div className="name">Open in IDE</div>
                <div className="desc">
                  Which editor opens when you click a file path in a pane.
                </div>
              </span>
              {ideConfig === null ? (
                // /api/ide-config hasn't returned yet. Module-level cache
                // means this only happens on the very first open per session.
                <span className="val">loading…</span>
              ) : ideConfig.available.length === 0 ? (
                <span className="val">no supported editors on PATH</span>
              ) : (
                <select
                  value={settings.selectedIde}
                  onChange={(e) => updateSettings({ selectedIde: e.target.value })}
                >
                  {/* Empty string ⇒ defer to server default. Labels the
                      current default so the user understands what "default"
                      maps to without leaving the modal. */}
                  <option value="">
                    Server default{ideConfig.default ? ` (${ideConfig.default})` : ""}
                  </option>
                  {ideConfig.available.map((ide) => (
                    <option key={ide.id} value={ide.id}>
                      {ide.label}
                    </option>
                  ))}
                </select>
              )}
              <span />
            </div>
          </div>

          {/* THI-244: cwd applied when creating a NEW session. Per-window cwd
           *  is inferred from the launching session and ignores this. */}
          <div className="settings-group" id="defaults">
            <h4>Defaults</h4>
            <div className="settings-row">
              <span>
                <div className="name">
                  <label htmlFor="default-directory">
                    Default directory for new sessions
                  </label>
                </div>
                <div className="desc">
                  Used as the cwd when creating a session via "+ session". Blank
                  leaves it to tmux; <code>~</code> is expanded against the
                  server's <code>$HOME</code>. Invalid paths are silently
                  dropped server-side.
                </div>
              </span>
              <input
                id="default-directory"
                type="text"
                placeholder="leave blank, or ~/dev or /Users/me/dev"
                value={settings.defaultDirectory}
                onChange={(e) =>
                  updateSettings({ defaultDirectory: e.target.value })
                }
                style={{ width: 240 }}
                spellCheck={false}
                autoComplete="off"
              />
              <span />
            </div>
          </div>

          <div className="settings-group" id="maintenance">
            <h4>Maintenance</h4>
            <div className="settings-row">
              <span>
                <div className="name">
                  <label htmlFor="idle-cleanup-days">
                    Idle-pane cleanup threshold (days)
                  </label>
                </div>
                <div className="desc">
                  0 hides the cleanup action entirely.
                </div>
              </span>
              <input
                id="idle-cleanup-days"
                type="number"
                min={0}
                max={365}
                value={settings.idleCleanupDays}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(365, Number(e.target.value) || 0));
                  updateSettings({ idleCleanupDays: v });
                }}
                style={{ width: 80 }}
              />
              <span />
            </div>
            {settings.idleCleanupDays > 0 && (
              <div className="settings-row">
                <span>
                  <div className="name">Clean up idle panes</div>
                  <div className="desc">
                    Close every window idle past the threshold above. Asks for
                    confirmation; mid-turn and pinned windows are pre-skipped.
                  </div>
                </span>
                <span className="val" />
                <button
                  className="btn"
                  onClick={() => onOpenCleanup?.()}
                >
                  Clean up idle panes…
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="rename-foot" style={{ borderTop: "1px solid var(--hairline)" }}>
          <span className="hint">
            {sessionCount} sessions · {windowCount} windows
          </span>
          <span className="term-spacer" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>
            <Icon name="check" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
