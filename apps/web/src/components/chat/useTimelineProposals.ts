import { useMemo } from "react";
import { useProposalDecisionsRead } from "../../zerops/proposalRecord";
import { type MessagesTimelineRow } from "./MessagesTimeline.logic";

/** The conversation's proposals: their decisions read from HQ, and the newest release ask. */
export function useTimelineProposals(stableRows: MessagesTimelineRow[]) {
  // What was decided of every proposal in the conversation, read from HQ in one call.
  const proposalIds = useMemo(
    () =>
      stableRows.flatMap((row) =>
        row.kind === "proposal" && row.operation.proposal !== undefined
          ? [row.operation.proposal.id]
          : [],
      ),
    [stableRows],
  );
  useProposalDecisionsRead(proposalIds);
  // The newest release ask: an earlier one in the conversation says it took its place.
  const newestReleaseAsk = useMemo(
    () =>
      stableRows
        .flatMap((row) =>
          row.kind === "proposal" && row.operation.proposal?.kind === "release.offer"
            ? [row.operation.proposal.id]
            : [],
        )
        .at(-1) ?? null,
    [stableRows],
  );
  return newestReleaseAsk;
}
