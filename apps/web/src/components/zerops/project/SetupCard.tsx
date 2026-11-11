/**
 * The project page's side column: what is set up once — addresses, code, automation, who has
 * access, spend — each its own card under its label. A setup with nothing to say is not drawn, so
 * the column holds only what is there.
 */
import type { ReactNode } from "react";

import { SectionLabel } from "../system";

export function SetupCard({ children }: { readonly children: ReactNode }) {
  return (
    <div aria-label="Setup" className="pp-setup" data-zerops-surface="project-setup" role="group">
      {children}
    </div>
  );
}

/**
 * One setup: its label, its one action at the label's end, then its card. `rows`: the card holds
 * rows with padding of their own. `empty`: nothing is set up yet — a dashed slot saying what it is
 * for, its one verb inside it.
 */
export function SetupRow({
  label,
  action,
  busy = false,
  rows = false,
  empty = false,
  children,
  surface,
}: {
  readonly label: string;
  readonly action?: ReactNode;
  /** Read still: its line holds its room. */
  readonly busy?: boolean;
  readonly rows?: boolean;
  readonly empty?: boolean;
  readonly children: ReactNode;
  /** Its `data-zerops-surface`, where a scenario or a harness finds it. */
  readonly surface?: string;
}) {
  return (
    <section
      aria-busy={busy ? "true" : undefined}
      aria-label={label}
      className="pp-group"
      data-zerops-surface={surface}
    >
      <SectionLabel action={action}>{label}</SectionLabel>
      <div
        className="pp-card pp-setup-card"
        data-empty={empty ? "" : undefined}
        data-rows={rows ? "" : undefined}
      >
        {children}
      </div>
    </section>
  );
}
