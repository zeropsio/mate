import type * as React from "react";

import { cn } from "~/lib/utils";

/**
 * A whole page that waits or failed: one fixed frame. Its column hangs from a fixed height, never
 * centred on its own height, and its mark has a fixed room — so a line, an action or Details that
 * arrive only grow the page downward; nothing above them moves.
 */
function StatusPage({
  mark,
  title,
  children,
  actions,
  footer,
  className,
  ...props
}: Omit<React.ComponentProps<"main">, "title"> & {
  /** The subject's face or icon, in a fixed room. */
  readonly mark?: React.ReactNode;
  readonly title: React.ReactNode;
  /** The page's body: a line, a progress row. */
  readonly children?: React.ReactNode;
  /** The page's action, at most a primary and a quiet one. */
  readonly actions?: React.ReactNode;
  /** Below the actions: Details, a way back. */
  readonly footer?: React.ReactNode;
}) {
  return (
    <main
      className={cn(
        "flex h-full min-h-0 w-full flex-1 flex-col items-center overflow-y-auto px-6 pt-status-page pb-10",
        className,
      )}
      data-slot="status-page"
      {...props}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        {mark === undefined || mark === null ? null : (
          <div className="mb-2 flex h-16 items-end justify-center" data-slot="status-page-mark">
            {mark}
          </div>
        )}
        <h1 className="m-0 text-balance font-semibold text-foreground text-xl">{title}</h1>
        {children === undefined || children === null ? null : (
          <div className="flex w-full flex-col items-center gap-3 text-balance text-muted-foreground text-sm">
            {children}
          </div>
        )}
        {actions === undefined || actions === null ? null : (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
        )}
        {footer === undefined || footer === null ? null : (
          <div className="mt-2 flex w-full flex-col items-center">{footer}</div>
        )}
      </div>
    </main>
  );
}

export { StatusPage };
