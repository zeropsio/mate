import { STILL_READING_HOLD_MS } from "@t3tools/client-runtime/zerops/projections";
import { useEffect, useState } from "react";
import type * as React from "react";

import { cn } from "~/lib/utils";

import { Skeleton } from "./skeleton";

/**
 * Something on its way, drawn as a stand-in shaped like what will come: the same rows, cards or
 * lines at their final size and place, painted once and replaced by the real thing in one frame.
 * Never a "Loading…" word in the middle of a page. Its name is for assistive technology only.
 *
 * `shape` draws a ready stand-in; `children` draws a surface's own (built from `Skeleton`). `room`
 * holds a surface's whole room and paints nothing: for code that arrives in a beat.
 *
 * `words` says the read as one quiet line instead ("Comparing in HQ…"): its label, muted body text,
 * for a read whose stand-in has no shape to take, or slow enough that what it waits on matters; it
 * stands where `EmptyState size="line"` and `Failure size="line"` would.
 *
 * `quiet` is for a read that usually lands at once: the stand-in holds its place unpainted for the
 * app's one hold (`STILL_READING_HOLD_MS`), so a read that lands within it never paints a stand-in
 * it takes back, and one that outlasts it paints in place, moving nothing.
 */
type LoadingShape = "room" | "line" | "words" | "lines" | "rows" | "cards" | "page";

function LoadingRows({ count }: { readonly count: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, index) => (
        <div className="flex h-12 items-center gap-3 px-2" key={index}>
          <Skeleton className="size-6 shrink-0" shape="pill" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingLines({ count }: { readonly count: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: count }, (_, index) => (
        // The last line is short, as a paragraph's is.
        <Skeleton className={cn("h-3", index === count - 1 ? "w-3/5" : "w-full")} key={index} />
      ))}
    </div>
  );
}

function LoadingCards({ count }: { readonly count: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-4">
      {Array.from({ length: count }, (_, index) => (
        <div className="flex h-56 flex-col gap-3 rounded-card border p-4" key={index}>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <div className="mt-2">
            <LoadingRows count={2} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LoadingShapeView({
  shape,
  count,
  label,
}: {
  readonly shape: LoadingShape;
  readonly count: number;
  readonly label: string;
}) {
  switch (shape) {
    // A surface whose code arrives in a beat: its room held, nothing painted that it takes back.
    case "room":
      return null;
    case "line":
      return <Skeleton className="h-3 w-40" />;
    case "words":
      return (
        <span aria-hidden="true" className="block text-pretty text-body text-muted-foreground">
          {label}…
        </span>
      );
    case "lines":
      return <LoadingLines count={count} />;
    case "rows":
      return <LoadingRows count={count} />;
    case "cards":
      return <LoadingCards count={count} />;
    case "page":
      return (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-5 w-48" />
          <LoadingRows count={count} />
        </div>
      );
  }
}

/** Whether a quiet stand-in is still within its hold. One timer, from its first frame. */
function useHeld(quiet: boolean): boolean {
  const [over, setOver] = useState(!quiet);
  useEffect(() => {
    if (over) return;
    const timer = setTimeout(() => setOver(true), STILL_READING_HOLD_MS);
    return () => clearTimeout(timer);
  }, [over]);
  return !over;
}

function Loading({
  label,
  shape = "rows",
  count = 3,
  quiet = false,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "aria-label"> & {
  /** What is on its way, for assistive technology: "Your projects". */
  readonly label: string;
  readonly shape?: LoadingShape;
  /** How many rows, cards or lines the stand-in draws: as many as are expected, when known. */
  readonly count?: number;
  /** Holds its place unpainted for the app's one hold before it draws. */
  readonly quiet?: boolean;
}) {
  const held = useHeld(quiet);
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={cn(
        "min-w-0",
        shape === "room" && "flex h-full min-h-32 flex-1 self-stretch",
        held && "invisible",
        className,
      )}
      data-slot="loading"
      role="status"
      {...props}
    >
      {children ?? <LoadingShapeView count={count} label={label} shape={shape} />}
    </div>
  );
}

export { Loading, type LoadingShape };
