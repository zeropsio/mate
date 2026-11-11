import { OperationStopped } from "@t3tools/client-runtime/data";

/** What a refused write says: HQ's own reason where HQ gave one, else the words for a lost answer. */
export const stoppedWords = (cause: unknown, lost: string): string =>
  cause instanceof OperationStopped ? cause.message : lost;
