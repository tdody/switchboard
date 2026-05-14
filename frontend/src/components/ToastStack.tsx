import { Toast, type ToastData } from "./Toast";

export function ToastStack({ toasts }: { toasts: ToastData[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} t={t} />
      ))}
    </div>
  );
}
