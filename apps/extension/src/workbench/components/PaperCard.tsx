import type { ReactNode, MouseEvent } from "react";

type PaperCardProps = {
  title?: string;
  meta?: string;
  rightSlot?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  className?: string;
};

export function PaperCard({ title, meta, rightSlot, footer, children, onClick, className }: PaperCardProps) {
  const cls = [
    "paper-card",
    onClick ? "paper-card--interactive" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <article className={cls} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      {(title || rightSlot) && (
        <div className="paper-card__head">
          <div>
            {title && <h3 className="paper-card__title">{title}</h3>}
            {meta && <p className="paper-card__meta">{meta}</p>}
          </div>
          {rightSlot && <div>{rightSlot}</div>}
        </div>
      )}
      {children && <div className="paper-card__body">{children}</div>}
      {footer && <div className="paper-card__footer">{footer}</div>}
    </article>
  );
}
