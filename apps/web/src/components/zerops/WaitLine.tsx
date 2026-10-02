/**
 * A wait's one line (`waitLine.logic.ts`): the small spinner and the words, quiet, at the page's
 * centre — where the boot frame's page has its centre (index.html's #boot-shell-page), so a line
 * the frame said stands in the same place when the app's page takes it over. No face, no mark: the
 * menu's mark and the header's face are the only ones on screen while anything loads.
 */
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { useWaitLine } from "~/zerops/useWaitLine";
import { Spinner } from "../ui/spinner";
import { useOptionalSidebar } from "../ui/sidebar";

export function WaitLine({ text }: { readonly text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" data-zerops-wait-line="">
      <Spinner size="sm" aria-hidden="true" role="presentation" />
      <span>{text}</span>
    </p>
  );
}

/**
 * The line at the page's centre, beside the menu: the page between the menu's edge and the
 * window's, as the boot frame's page is. Says nothing for its beat (`useWaitLine`).
 */
export function PageWaitLine({
  text,
  delayMs,
  from,
  below = null,
}: {
  readonly text: string | null;
  readonly delayMs: number;
  readonly from: "load" | "mount";
  /** What hangs under the line once it shows — never moving it off the centre. */
  readonly below?: ReactNode;
}) {
  const showing = useWaitLine(text, { delayMs, from });
  const sidebar = useOptionalSidebar();
  const beside = sidebar !== null && !sidebar.isMobile && sidebar.open;
  return (
    <div
      aria-live="polite"
      className={cn(
        // m-0: a parent's space-y never moves it off the frame's centre.
        "pointer-events-none fixed inset-y-0 right-0 left-0 z-10 m-0 flex items-center justify-center",
        beside && "md:left-(--sidebar-width)",
      )}
      role="status"
    >
      {showing && text !== null ? (
        <div className="relative">
          <WaitLine text={text} />
          {below === null ? null : (
            <div className="pointer-events-auto absolute top-full left-1/2 mt-3 flex -translate-x-1/2 flex-col items-center gap-3">
              {below}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
