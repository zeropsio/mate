import type * as React from "react";

import { cn } from "~/lib/utils";

import { Skeleton } from "./skeleton";

/**
 * Something on its way, drawn as a stand-in shaped like what will come: the same rows, cards or
 * lines at their final size and place, painted once and replaced by the real thing in one frame.
 * Never a "Loading…" word in the middle of a page. Its name is for assistive technology only.
 *
 * `shape` draws a ready stand-in; `children` draws a surface's own (built from `Skeleton`).
 */
type LoadingShape = "line" | "lines" | "rows" | "cards" | "page";

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
        <div className="flex h-56 flex-col gap-3 rounded-xl border p-4" key={index}>
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

function LoadingShapeView({ shape, count }: { readonly shape: LoadingShape; count: number }) {
  switch (shape) {
    case "line":
      return <Skeleton className="h-3 w-40" />;
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

function Loading({
  label,
  shape = "rows",
  count = 3,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "aria-label"> & {
  /** What is on its way, for assistive technology: "Your projects". */
  readonly label: string;
  readonly shape?: LoadingShape;
  /** How many rows, cards or lines the stand-in draws: as many as are expected, when known. */
  readonly count?: number;
}) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={cn("min-w-0", className)}
      data-slot="loading"
      role="status"
      {...props}
    >
      {children ?? <LoadingShapeView count={count} shape={shape} />}
    </div>
  );
}

export { Loading, type LoadingShape };
