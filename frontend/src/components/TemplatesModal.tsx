import { useEffect, useState } from "react";

import { fetchTemplates, instantiateTemplate } from "../api/client";
import { useScrimClose } from "../lib/useScrimClose";
import type { TemplateSummary } from "../types";
import { Icon } from "./Icon";

interface Props {
  onClose: () => void;
  /** Called with the new session's name on a successful instantiate.
   *  The parent typically triggers a refresh so the kanban shows the new
   *  column immediately. */
  onApplied: (session: string) => void;
}

/**
 * THI-99: pick a session template, fill in its variables, click Create.
 * Two phases:
 *   1. List view — every template with name + window count.
 *   2. Variable form — one input per `${VAR}` referenced by the chosen
 *      template, plus a Create button.
 */
export function TemplatesModal({ onClose, onApplied }: Props) {
  const scrimProps = useScrimClose(onClose);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TemplateSummary | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTemplates().then((r) => {
      if (cancelled) return;
      setTemplates(r.templates);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = (t: TemplateSummary) => {
    setSelected(t);
    // Seed the form with empty values so a controlled <input> never crosses
    // the uncontrolled → controlled boundary.
    const seed: Record<string, string> = {};
    for (const v of t.variables) seed[v] = "";
    setValues(seed);
    setError(null);
  };

  const back = () => {
    setSelected(null);
    setError(null);
  };

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const session = await instantiateTemplate(selected.name, values);
    setBusy(false);
    if (session === null) {
      setError("Couldn't create the session — name in use, or tmux is down.");
      return;
    }
    onApplied(session);
    onClose();
  };

  return (
    <div className="scrim" {...scrimProps}>
      <div
        className="templates-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="templates-hd">
          {selected ? (
            <>
              <button
                className="btn btn-ghost template-back"
                onClick={back}
                title="Back to list"
              >
                ‹ back
              </button>
              <b>{selected.name}</b>
            </>
          ) : (
            <>
              <Icon name="plus" size={14} />
              <b>Session templates</b>
            </>
          )}
          <span className="term-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-icon btn-ghost"
            onClick={onClose}
            title="Close (Esc)"
          >
            <Icon name="x" />
          </button>
        </div>

        <div className="templates-body">
          {selected ? (
            <>
              {selected.variables.length === 0 ? (
                <div className="template-empty">
                  No variables — ready to create.
                </div>
              ) : (
                selected.variables.map((v) => (
                  <div className="template-var-row" key={v}>
                    <label htmlFor={`tpl-var-${v}`}>${`{${v}}`}</label>
                    <input
                      id={`tpl-var-${v}`}
                      name={v}
                      value={values[v] ?? ""}
                      onChange={(e) =>
                        setValues((p) => ({ ...p, [v]: e.target.value }))
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                ))
              )}
              {error && <div className="template-error">{error}</div>}
            </>
          ) : loading ? (
            <div className="template-empty">Loading…</div>
          ) : templates.length === 0 ? (
            <div className="template-empty">
              No templates yet. Drop a `*.json` into{" "}
              <code>~/.switchboard/templates/</code>.
            </div>
          ) : (
            templates.map((t) => (
              <button
                key={t.name}
                className="template-row"
                onClick={() => pick(t)}
              >
                <span className="template-row-name">{t.name}</span>
                <span className="template-row-meta">{t.windowCount} windows</span>
              </button>
            ))
          )}
        </div>

        <div className="templates-foot">
          {selected ? (
            <>
              <button
                className="btn"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary template-create"
                onClick={() => void create()}
                disabled={busy}
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </>
          ) : (
            <span className="hint">Pick a template · esc close</span>
          )}
        </div>
      </div>
    </div>
  );
}
