/**
 * A wait's one line (`waitLine.logic.ts`): the small spinner and the words, quiet, at the page's
 * centre — where the boot frame's page has its centre (index.html's #boot-shell-page), so a line
 * the frame said stands in the same place when the app's page takes it over. No face, no mark: the
 * menu's mark and the header's face are the only ones on screen while anything loads.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
 * window's, as the boot frame's page is. Says nothing for its beat (`useWaitLine`). Within a pane
 * — a conversation's, beside its right panel — it stands at the pane's centre across, still at the
 * window's centre down, so a line the page said stays at its height as the pane takes it over.
 */
export function PageWaitLine({
  text,
  delayMs,
  from,
  below = null,
  within = "page",
}: {
  readonly text: string | null;
  readonly delayMs: number;
  readonly from: "load" | "mount";
  /** What hangs under the line once it shows — never moving it off the centre. */
  readonly below?: ReactNode;
  /** The page beside the menu, or the pane the line is drawn in. */
  readonly within?: "page" | "pane";
}) {
  const showing = useWaitLine(text, { delayMs, from });
  const sidebar = useOptionalSidebar();
  const beside = sidebar !== null && !sidebar.isMobile && sidebar.open;
  const box = useRef<HTMLDivElement>(null);
  const [across, setAcross] = useState<{ left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (within !== "pane") return;
    // The pane is the nearest box that has a width: a wrapper drawn as `contents` has none.
    let pane = box.current?.parentElement ?? null;
    while (pane !== null && pane.getBoundingClientRect().width === 0) pane = pane.parentElement;
    if (pane === null) return;
    const measured = pane;
    const measure = () => {
      const rect = measured.getBoundingClientRect();
      // Not laid out yet: the page's centre until it is.
      setAcross(
        rect.width === 0 ? null : { left: rect.left, right: window.innerWidth - rect.right },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(measured);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [within]);
  return (
    <div
      aria-live="polite"
      className={cn(
        // m-0: a parent's space-y never moves it off the frame's centre.
        "pointer-events-none fixed inset-y-0 right-0 left-0 z-10 m-0 flex items-center justify-center",
        beside && across === null && "md:left-(--sidebar-width)",
      )}
      ref={box}
      role="status"
      style={across === null ? undefined : { left: across.left, right: across.right }}
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
