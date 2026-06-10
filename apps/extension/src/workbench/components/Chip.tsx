import type { ReactNode } from "react";

type ChipTone = "neutral" | "healthy" | "gold" | "seal" | "running";

type ChipProps = {
  tone?: ChipTone;
  children: ReactNode;
};

export function Chip({ tone = "neutral", children }: ChipProps) {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}
