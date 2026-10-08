/** What the person is told of a Mate's restart Zerops did not take, wherever it was asked. */
import type { OperationProgress } from "@t3tools/client-runtime/data";

import { restartRefusal } from "./mateNoticeVoice";

/** Carries receipt-specific guidance through the rejected restart promise without using diagnostics as copy. */
export class MateRestartError extends Error {
  constructor(readonly receipt: OperationProgress) {
    super(restartRefusal(receipt) ?? "The restart did not complete.");
  }
}
