import { Icon } from "./Icon";

export interface ToastFocus {
  id: string;
  kind: "focus";
  session: string;
  index: number;
  name: string;
  term: string;
}

export interface ToastMessage {
  id: string;
  kind: "message";
  message: string;
}

export type ToastData = ToastFocus | ToastMessage;

export function Toast({ t }: { t: ToastData }) {
  if (t.kind === "focus") {
    return (
      <div className="toast">
        <Icon name="focus" />
        <span className="what">
          <span className="who">
            {t.session}:{t.index}
          </span>{" "}
          {t.name}
        </span>
        <span className="arrow">→</span>
        <span className="who">{t.term}</span>
      </div>
    );
  }
  return (
    <div className="toast">
      <Icon name="send" />
      <span>{t.message}</span>
    </div>
  );
}
