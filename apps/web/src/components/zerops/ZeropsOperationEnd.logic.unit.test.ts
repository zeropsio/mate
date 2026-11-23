import type { HqOperationStanding } from "@t3tools/client-runtime/data";
import { expect, it } from "vite-plus/test";

import { endOperationIntent } from "./ZeropsOperationEnd.logic.ts";

const waiting = {
  kind: "waiting",
  id: "op-1",
  continueBy: "u-maker",
  yours: false,
} as const satisfies HqOperationStanding;

// witness: apps/web/src/components/zerops/ZeropsOperationEnd.logic.ts | standing.endable !== true → standing.yours !== true
it("MN+4: A waiting rename, deletion or setup draws End only where HQ offers this reader its end, and that End ends this operation of this application; breaks: an application whose maker left stays held with no way out, or a reader HQ refuses is shown an End", () => {
  const intent = { kind: "end-operation", orgId: "org-1", id: "op-1", appId: "app-1" };
  const cases: ReadonlyArray<readonly [HqOperationStanding, typeof intent | undefined]> = [
    [{ ...waiting, endable: true }, intent],
    [waiting, undefined],
    [{ ...waiting, yours: true }, undefined],
    [{ kind: "going" }, undefined],
    [{ kind: "none" }, undefined],
  ];
  for (const [standing, expected] of cases) {
    expect(endOperationIntent(standing, "org-1", "app-1"), JSON.stringify(standing)).toEqual(
      expected,
    );
  }
});
