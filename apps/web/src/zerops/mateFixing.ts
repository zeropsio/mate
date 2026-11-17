/**
 * The change a Mate is fixing for its person's review, as its conversation's header and composer
 * say it (`worksOnChange`): its conversations' rows name the change while the run asked from the
 * review has not ended (`mateWorkingOnAtom`).
 */
import { useAtomValue } from "@effect/atom-react";
import { mateWorkingOnAtom } from "@t3tools/client-runtime/data";
import { worksOnChange } from "@t3tools/client-runtime/zerops";
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
 * Whether its Mate works on a review's change: by its repository and number at the head the item
 * holds, as its review reads it (`worksOnChange`).
 */
export function useMateFixing(
  mateProjectId: string | undefined,
  mateName: string | undefined,
):
  | {
      readonly mateName: string;
      readonly is: (item: {
        readonly target: ReviewTarget;
        readonly head?: string | undefined;
      }) => boolean;
    }
  | undefined {
  const workingOn = useMateWorkingOn(mateProjectId);
  return useMemo(
    () =>
      workingOn.length === 0
        ? undefined
        : {
            mateName: mateName ?? "This Mate",
            is: ({ target, head }) =>
              target.kind === "change" &&
              worksOnChange(workingOn, {
                repository: target.repository,
                number: target.number,
                headSha: head,
              }),
          },
    [mateName, workingOn],
  );
}
