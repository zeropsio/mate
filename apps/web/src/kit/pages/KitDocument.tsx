import type { ReactNode } from "react";

import { PageHeader } from "~/components/ui/page-header";

/**
 * A page that is read, not a canvas: its header, then its sections at a reading width, 48 px
 * apart, inside the shell's scroller.
 */
export function KitDocument({
  title,
  line,
  actions,
  children,
}: {
  readonly title: ReactNode;
  readonly line?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-8 pt-8 pb-16">
        <PageHeader actions={actions} line={line} title={title} />
        {children}
      </div>
    </div>
  );
}
