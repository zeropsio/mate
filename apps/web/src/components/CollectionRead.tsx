import type { ReactNode } from "react";
import type { CollectionPresentation } from "../state/query";

export function CollectionRead<A>({
  presentation,
  emptyLabel,
  children,
}: {
  presentation: CollectionPresentation<A>;
  emptyLabel?: string;
  children: (items: ReadonlyArray<A>) => ReactNode;
}) {
  const showItems = presentation.items.length > 0;
  return (
    <>
      {presentation.message ? (
        <p role="status" className="px-4 py-3 text-xs text-muted-foreground">
          {presentation.message}
          {presentation.retained && showItems ? " Showing last-known data." : null}
        </p>
      ) : null}
      {showItems || presentation.state === "ready" ? (
        !showItems && emptyLabel ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          children(presentation.items)
        )
      ) : null}
    </>
  );
}
