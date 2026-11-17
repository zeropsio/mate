/**
 * The change a Mate is fixing for its person's review, as its conversation's header and composer
 * say it (`worksOnChange`): its conversations' rows name the change while the run asked from the
 * review has not ended (`mateWorkingOnAtom`).
 */
import { useAtomValue } from "@effect/atom-react";
import { mateWorkingOnAtom } from "@t3tools/client-runtime/data";
import type { ConversationWorkingOn } from "@t3tools/contracts";
import { useMemo } from "react";

import type { ReviewTarget } from "./review";

const NONE: ReadonlyArray<ConversationWorkingOn> = [];

/** What the Mate of `mateProjectId` works on for a page; none before it is known. */
export function useMateWorkingOn(
  mateProjectId: string | undefined,
): ReadonlyArray<ConversationWorkingOn> {
  const workingOn = useAtomValue(mateWorkingOnAtom(mateProjectId ?? ""));
  return mateProjectId === undefined ? NONE : workingOn;
}

/**
 * Whether its Mate works on a review's change, by its repository and number: a header's item
 * carries no head, and the Mate's run is what it says while the Mate works.
 */
export function useMateFixing(
  mateProjectId: string | undefined,
  mateName: string | undefined,
):
  | {
      readonly mateName: string;
      readonly is: (item: { readonly target: ReviewTarget }) => boolean;
    }
  | undefined {
  const workingOn = useMateWorkingOn(mateProjectId);
  return useMemo(
    () =>
      workingOn.length === 0
        ? undefined
        : {
            mateName: mateName ?? "This Mate",
            is: ({ target }) =>
              target.kind === "change" &&
              workingOn.some(
                (on) =>
                  on.kind === "change" &&
                  on.repo === target.repository &&
                  on.number === target.number,
              ),
          },
    [mateName, workingOn],
  );
}
