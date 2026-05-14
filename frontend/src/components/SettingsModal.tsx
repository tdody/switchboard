import { useEffect } from "react";
import {
  ACCENT_TOKENS,
  accentColor,
  type Accent,
  type Density,
  POLL_MAX_S,
  POLL_MIN_S,
  type Theme,
  updateSettings,
  useSettings,
} from "../lib/settings";
import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";
import { Toggle } from "./Toggle";

const ACCENTS = Object.keys(ACCENT_TOKENS) as Accent[];

interface Props {
  serverAddr: string;
  sessionCount: number;
  windowCount: number;
  onClose: () => void;
}

export function SettingsModal({ serverAddr, sessionCount, windowCount, onClose }: Props) {
  const settings = useSettings();

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
    <div className="scrim" onClick={onClose}>
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
