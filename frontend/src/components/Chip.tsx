import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Chip({ children, className = "", title }: Props) {
  return (
    <span className={`chip ${className}`} title={title}>
      {children}
    </span>
  );
}
