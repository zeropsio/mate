/** A Mate's attention as its server publishes it, for the tests of both paths that carry it. */
import type { MateAttention } from "@t3tools/contracts";

/** Its run is `incarnation` of start `epoch`: the first start unless said. */
export const attention = (
  incarnation: string,
  revision: number,
  working = 0,
  epoch = 1,
): MateAttention =>
  ({
    source: { environmentId: "env-ada", epoch, incarnation, revision },
    mainThreadId: "t-main",
    lastThreadId: "t-main",
    working,
    waiting: 0,
    results: [],
    questions: [],
    truncated: false,
  }) as unknown as MateAttention;
