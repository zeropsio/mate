import { expect, it } from "vite-plus/test";

import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { appReleaseRows } from "./appReleaseRows.ts";

const key = { orgId: "org", appId: "shop" };
const scope = hqAppDetailScope(key.orgId, key.appId);
const apply = (inputs: ReadonlyArray<AccountInput>, state: AccountState = emptyAccount) =>
  inputs.reduce((s, input) => reduceAccount(s, input).state, state);
const release = {
  tag: "v1.0.0",
  sha: "a".repeat(40),
  entries: [{ service: "api", sha: "b".repeat(40) }],
  at: "2026-10-07T00:00:00Z",
  by: "user",
  reason: null,
  rollbackOf: null,
  state: "approved" as const,
};

// witness: packages/client-runtime/src/data/projections/appReleaseRows.ts | ? { kind: "unread", reason } → ? { kind: "known", releases: [], live: detail.live, reason }
it("PJ46: An application whose releases HQ withholds for lack of access shows no releases, without claiming it has none", () => {
  const known = apply([
    { kind: "stream", key: linkKeys.hq("org"), now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
    {
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: 1 }],
      reset: true,
      removals: [],
      rows: [
        {
          family: "hqAppDetail",
          id: "shop/releases",
          value: { kind: "releases", value: [release] },
          revision: { kind: "hq", incarnation: "i", revision: 1 },
        },
      ],
    },
  ]);
  const removed = apply(
    [
      {
        kind: "delivery",
        via: "hq-stream",
        scopes: [{ scope, generation: 1 }],
        reset: false,
        rows: [],
        removals: [{ family: "hqAppDetail", id: "shop/releases" }],
      },
    ],
    known,
  );
  expect(appReleaseRows.derive(readsOfState(removed), key).kind).toBe("unread");
});
