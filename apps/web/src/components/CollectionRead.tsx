import type { ReactNode } from "react";
import type { CollectionPresentation } from "../state/query";
import { Loading } from "./ui/loading";

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
        <p role="status" className="px-4 py-3 text-caption text-muted-foreground">
          {presentation.message}
          {presentation.retained && showItems ? " Showing last-known data." : null}
        </p>
      ) : null}
      {presentation.state === "loading" && !showItems ? (
        // On its way with nothing kept: lines where its rows will be.
        <Loading className="mx-4 my-3" count={3} label={presentation.subject} shape="lines" />
      ) : null}
      {showItems || presentation.state === "ready" ? (
        !showItems && emptyLabel ? (
          <p className="px-4 py-3 text-caption text-muted-foreground">{emptyLabel}</p>
        ) : (
          children(presentation.items)
        )
      ) : null}
    </>
  );
}
