/**
 * One card of a project page's grid: one idea, its name on the left of its head and a quiet fact
 * or its one action on the right, then what it holds — on the overview card's ground.
 */
import type { ReactNode } from "react";

export function ProjectPageCard({
  title,
  end,
  surface,
  busy = false,
  look = "card",
  children,
}: {
  readonly title: string;
  /**
   * `card` on the page's side column; `section` in its wide column, among Production and Stages:
   * its name over a hairline, on the page's own ground.
   */
  readonly look?: "card" | "section";
  /** The head's right end: a quiet fact, or the card's one action. */
  readonly end?: ReactNode;
  /** Its `data-zerops-surface`. */
  readonly surface: string;
  /** Its content is still being read: it holds its final size meanwhile. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}) {
  if (look === "section")
    return (
      <section
        aria-busy={busy || undefined}
        aria-label={title}
        className="pp-sec"
        data-zerops-surface={surface}
      >
        <div className="pp-sec-head">
          <h2 className="pp-sec-name">{title}</h2>
          {end === undefined || end === null ? null : <span className="pp-sec-acts">{end}</span>}
        </div>
        {children}
      </section>
    );
  return (
    <section
      aria-busy={busy || undefined}
      aria-label={title}
      className="ov-side pp-cards-card"
      data-zerops-surface={surface}
    >
      <header className="flex min-h-6 min-w-0 items-center justify-between gap-3">
        <h2 className="text-emphasis font-semibold text-foreground">{title}</h2>
        {end === undefined || end === null ? null : (
          <div className="flex min-w-0 items-center gap-2">{end}</div>
        )}
      </header>
      {children}
    </section>
  );
}

/** A group's small-caps name inside a card: "WAITING ON YOU · 2". */
export function CardGroupName({
  children,
  count,
  after,
}: {
  readonly children: string;
  readonly count?: number | undefined;
  /** A quiet word after the count: "on stage". */
  readonly after?: string | undefined;
}) {
  return (
    <h3 className="pp-cards-group-name">
      {children}
      {count === undefined ? null : <span className="tabular-nums"> · {count}</span>}
      {after === undefined ? null : <span> · {after}</span>}
    </h3>
  );
}

/** Rows a card holds while it reads, at their final size: the card does not move when they land. */
export function CardRowsHeld({ rows }: { readonly rows: number }) {
  return (
    <ul aria-hidden="true" className="grid">
      {Array.from({ length: rows }, (_, at) => (
        <li className="pp-cards-row" key={at}>
          <span className="pp-cards-held" />
        </li>
      ))}
    </ul>
  );
}
