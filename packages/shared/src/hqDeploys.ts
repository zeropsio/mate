/**
 * HQ's words for a deploy it refused and asks again on its next pass because Zerops did not
 * answer (`apps/hq/src/deploys.ts`): written into the deploy's record, and read back by the client,
 * which says a stage's first deploy waits on Zerops (`stopComing.ts`).
 *
 * @module hqDeploys
 */

const ZEROPS_DID_NOT_ANSWER = "Zerops did not answer";

/** The refusal's message, with what Zerops failed at. */
export const zeropsDidNotAnswer = (detail: string): string => `${ZEROPS_DID_NOT_ANSWER}: ${detail}`;

/** Whether a deploy's message is that refusal. */
export const saysZeropsDidNotAnswer = (message: string | null): boolean =>
  message?.startsWith(`${ZEROPS_DID_NOT_ANSWER}:`) === true;
