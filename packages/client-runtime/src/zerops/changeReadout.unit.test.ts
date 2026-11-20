import { expect, it } from "vite-plus/test";

import type { MergeabilityKind } from "./changeMergeability.ts";
import { type ChangeReadout, changeReadoutJudged } from "./changeReadout.ts";

const readout = (mergeability: MergeabilityKind): ChangeReadout => ({
  files: [],
  filesKnown: true,
  diffBase: null,
  filesCut: false,
  commits: [],
  commitsKnown: true,
  commitsCut: false,
  mergeability,
  conflict: [],
  behind: false,
  description: undefined,
});

// witness: packages/client-runtime/src/zerops/changeReadout.ts | if (readout.mergeability !== "checking" || judged === undefined) return readout; → if (judged === undefined) return readout;
it("ZV+4: Whether a change merges comes from HQ's record, else from HQ's judgement of the shown head and main", () => {
  const conflict = { kind: "conflict", paths: ["src/a.ts"] } as const;

  const recorded = changeReadoutJudged(readout("mergeable"), conflict);
  expect(recorded.mergeability).toBe("mergeable");
  expect(recorded.conflict).toEqual([]);

  const judged = changeReadoutJudged(readout("checking"), conflict);
  expect(judged.mergeability).toBe("conflicting");
  expect(judged.conflict).toEqual(["src/a.ts"]);

  expect(changeReadoutJudged(readout("checking"), undefined).mergeability).toBe("checking");
});
