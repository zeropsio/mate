/**
 * The decisions HQ holds of proposals, read where a conversation draws their cards: every id named
 * in as few calls as HQ allows (`HqApi.proposalDecisions`). A tab keeps what it read in memory
 * beside its own writes, which go as operations (`decide-proposal`).
 *
 * @module data/adapters/hqProposalDecisions
 */
import type { HqApi } from "../../zerops/hq/client.ts";

/** What HQ holds of `ids`, through the organization's official HQ; rejects where HQ did not answer. */
export function readProposalDecisions(
  api: Pick<HqApi, "proposalDecisions">,
): HqApi["proposalDecisions"] {
  return (ids, signal) => api.proposalDecisions(ids, signal);
}
