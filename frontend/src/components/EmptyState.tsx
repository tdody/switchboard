import { Icon } from "./Icon";
import { SwitchboardMark } from "./SwitchboardMark";

interface Props {
  onRetry: () => void;
  lastFetchAgo?: string;
}

export function EmptyState({ onRetry, lastFetchAgo }: Props) {
  return (
    <div className="empty">
      <div className="empty-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <SwitchboardMark size={26} />
          <span
            className="connect-pill"
            style={{
              background: "color-mix(in oklch, var(--tone-amber) 16%, transparent)",
              color: "var(--tone-amber)",
            }}
          >
            <span className="dot" />
            no tmux server
          </span>
        </div>
        <h2>No tmux server is running.</h2>
        <p>
          Switchboard couldn't find a live tmux socket on this host. Spin one up,
          then refresh — the dashboard will pick it up automatically.
        </p>
        <pre>{`# create a session and attach
$ tmux new -s main

# or attach to an existing one
$ tmux attach -t main`}</pre>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-primary" onClick={onRetry}>
            <Icon name="spinner" /> Retry
          </button>
        </div>
        <div className="hint">
          polling /api/state{lastFetchAgo ? ` · last attempt ${lastFetchAgo}` : ""}
        </div>
      </div>
    </div>
  );
}
