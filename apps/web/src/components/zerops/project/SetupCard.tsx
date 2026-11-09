/**
 * The project page's side column: one card of what is set up once — addresses, repositories,
 * automation, people, spend — a row each, its label hugging its line, rows split by a hairline.
 * A row with nothing to say is not drawn, so the card holds only what is there.
 */
import type { ReactNode } from "react";

import { SectionLabel } from "../system";

export function SetupCard({ children }: { readonly children: ReactNode }) {
  return (
    <section aria-label="Setup" className="pp-card pp-setup" data-zerops-surface="project-setup">
      {children}
    </section>
  );
}

/** One row of the card: its label, its one action at the label's end, then its line. */
export function SetupRow({
  label,
  action,
  busy = false,
  children,
  surface,
}: {
  readonly label: string;
  readonly action?: ReactNode;
  /** Read still: its line holds its room. */
  readonly busy?: boolean;
  readonly children: ReactNode;
  /** Its `data-zerops-surface`, where a scenario or a harness finds it. */
  readonly surface?: string;
}) {
  return (
    <div
      aria-busy={busy ? "true" : undefined}
      className="pp-setup-row"
      data-zerops-surface={surface}
    >
      <SectionLabel action={action}>{label}</SectionLabel>
      {children}
    </div>
  );
}
