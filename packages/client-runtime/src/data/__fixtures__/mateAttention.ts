/** A Mate's attention as its server publishes it, for the tests of both paths that carry it. */
import type { MateAttention } from "@t3tools/contracts";

export const attention = (incarnation: string, revision: number, working = 0): MateAttention =>
  ({
    source: { environmentId: "env-ada", epoch: 1, incarnation, revision },
    mainThreadId: "t-main",
    lastThreadId: "t-main",
    working,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
  }) as unknown as MateAttention;
