import type { ReactNode } from "react";

export function Bento({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="bento" aria-label={label}>{children}</div>;
}

type Tone = "panel" | "brand" | "subtle" | "flat" | "paper";
export function Tile({ children, span = "", tone = "panel", as: As = "section", label, className = "" }: {
  children: ReactNode; span?: string; tone?: Tone; as?: "section" | "article" | "div" | "aside"; label?: string; className?: string;
}) {
  const t = tone === "panel" ? "" : tone;
  return (
    <As className={`tile ${t} ${span} ${tone === "brand" ? "on-brand" : ""} ${className}`.trim()} aria-label={label}>
      {children}
    </As>
  );
}

export function TileHead({ kicker, title, action }: { kicker?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tile-head">
      <div className="stack-sm">
        {kicker ? <span className="tile-kicker">{kicker}</span> : null}
        {title ? <h2>{title}</h2> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function PageHead({ title, intro, actions }: { title: string; intro?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {intro ? <p>{intro}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}
