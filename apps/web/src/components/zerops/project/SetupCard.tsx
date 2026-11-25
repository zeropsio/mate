/**
 * The project page's side column: what is set up once — addresses, code, automation, who has
 * access, spend — each its own card under its label. A setup with nothing to say is not drawn, so
 * the column holds only what is there.
 */
import type { ReactNode } from "react";

import { SectionLabel } from "../system";
import { Card } from "~/components/ui/card";
import { PAGE_GROUP, PAGE_SIDE } from "./pageLayout";

export function SetupCard({ children }: { readonly children: ReactNode }) {
  return (
    <div aria-label="Setup" className={PAGE_SIDE} data-zerops-surface="project-setup" role="group">
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
      className={PAGE_GROUP}
      data-zerops-surface={surface}
    >
      <SectionLabel action={action}>{label}</SectionLabel>
      {empty ? (
        // A setup nobody made yet: a dashed slot saying what it is for, beside its one verb.
        <Card variant="slot">
          <div className="flex items-center justify-between gap-3.5 px-4 py-3.5 [&>p]:text-line [&>p]:leading-5 [&>p]:text-muted-foreground">
            {children}
          </div>
        </Card>
      ) : (
        <Card>
          {/* A card of rows (the code repositories): the rows' own padding stands in for its. */}
          <div className={rows ? "grid gap-3 px-2 py-1" : "grid gap-3 px-4 py-3.5"}>{children}</div>
        </Card>
      )}
    </section>
  );
}
