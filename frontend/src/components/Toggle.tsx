interface Props {
  on: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
}

export function Toggle({ on, onChange, label }: Props) {
  return (
    <button
      type="button"
      className={`toggle ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
    />
  );
}
