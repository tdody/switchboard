interface Props {
  size?: number;
}

export function SwitchboardMark({ size = 26 }: Props) {
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: 7,
        background: "linear-gradient(180deg, var(--panel-2), var(--bg-elev))",
        border: "1px solid var(--hairline-strong)",
        color: "var(--accent)",
        boxShadow: "0 0 12px var(--accent-soft), inset 0 1px 0 rgba(255,255,255,.04)",
        flexShrink: 0,
      }}
    >
      <svg width={size - 8} height={size - 8} viewBox="0 0 64 64" fill="none">
        <circle cx="20" cy="22" r="3" fill="currentColor" opacity=".35" />
        <circle cx="32" cy="22" r="3" fill="currentColor" opacity=".35" />
        <circle cx="44" cy="22" r="3" fill="currentColor" opacity=".35" />
        <circle cx="20" cy="34" r="3" fill="currentColor" opacity=".22" />
        <circle cx="32" cy="34" r="3" fill="currentColor" opacity=".22" />
        <circle cx="44" cy="34" r="3" fill="currentColor" opacity=".22" />
        <path
          d="M20 22 C20 44, 44 34, 44 50"
          stroke="currentColor"
          strokeWidth="4.5"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="20" cy="22" r="4.4" fill="currentColor" />
        <circle cx="44" cy="50" r="4.4" fill="currentColor" />
      </svg>
    </span>
  );
}
