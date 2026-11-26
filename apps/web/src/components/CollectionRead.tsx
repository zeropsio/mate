import type { ReactNode } from "react";
import type { CollectionPresentation } from "../state/query";
import { Loading } from "./ui/loading";
import { Text } from "~/components/ui/text";

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
        <Text className="px-4 py-3" render={<p />} variant="note" role="status">
          {presentation.message}
          {presentation.retained && showItems ? " Showing last-known data." : null}
        </Text>
      ) : null}
      {presentation.state === "loading" && !showItems ? (
        // On its way with nothing kept: lines where its rows will be.
        <Loading className="mx-4 my-3" count={3} label={presentation.subject} shape="lines" />
      ) : null}
      {showItems || presentation.state === "ready" ? (
        !showItems && emptyLabel ? (
          <Text className="px-4 py-3" render={<p />} variant="note">
            {emptyLabel}
          </Text>
        ) : (
          children(presentation.items)
        )
      ) : null}
    </>
  );
}
