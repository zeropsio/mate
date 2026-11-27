import { checksGivenUpSentence } from "@t3tools/client-runtime/zerops/reviewVerdict";
import type { MateMessageNotAdmittedReason } from "@t3tools/contracts";

/** What the person can expect after a delivered check notice. */
export const noticePersonSentence = (mate: string, reason?: MateMessageNotAdmittedReason): string =>
  checksGivenUpSentence(reason === undefined ? undefined : { reason }) ?? `${mate} is fixing it.`;
