import { expect, it } from "vite-plus/test";
import { restartWay } from "./mateRestart.ts";

// witness: packages/client-runtime/src/data/operations/mateRestart.ts | return offered || containerFailed(status) ? "hq" : "restart"; → return containerFailed(status) ? "hq" : "restart";
it("OP+1: A Mate's restart goes to HQ where HQ offers it or its container failed, and to Zerops otherwise; breaks: a Mate that stopped answering while Zerops shows it running is restarted past the restart HQ offers for it", () => {
  const ways = (
    [
      ["ACTIVE", true],
      ["SERVICE_ACTIVE", true],
      [undefined, true],
      ["FAILED", false],
      ["SERVICE_ACTION_FAILED", false],
      ["ACTIVE", false],
      [undefined, false],
    ] as const
  ).map(([status, offered]) => restartWay(status, offered));
  expect(ways).toEqual(["hq", "hq", "hq", "hq", "hq", "restart", "restart"]);
});
