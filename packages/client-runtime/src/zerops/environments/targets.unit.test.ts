import { EnvironmentId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import type { Known } from "../knowledge/known.ts";
import type { CandidateRow } from "../projections/candidates.ts";
import { listTargets, type RememberedTarget } from "./targets.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const KEY = "project-1:service-1";

/** A Mate a session kept, reached in `org-1`. */
const kept: RememberedTarget = {
  targetKey: KEY,
  environmentId: EnvironmentId.make("env-a"),
  origin: ORIGIN,
  orgId: "org-1",
};

/** An organization's whole listing, naming no project. */
const empty: Known<ReadonlyArray<CandidateRow>> = {
  state: "known",
  value: [],
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
};

const presenceOn = (organizationIds: ReadonlyArray<string>) =>
  listTargets({
    listings: organizationIds.map((organizationId) => ({ organizationId, listing: empty })),
    remembered: [kept],
    lastPresence: () => null,
  }).targets.find((target) => target.key === KEY)?.presence;

// witness: packages/client-runtime/src/zerops/environments/targets.ts | organizationId === record.orgId → organizationId !== record.orgId
it("EN+10: A remembered Mate is gone only on its own organization's listing", () => {
  expect(presenceOn(["org-2"])).toEqual({ kind: "remembered", origin: ORIGIN });
  expect(presenceOn(["org-1"])).toEqual({
    kind: "gone",
    evidence: "complete-scope-omits-verified",
  });
});
