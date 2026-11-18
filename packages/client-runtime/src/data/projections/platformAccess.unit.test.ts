import { expect, it } from "vite-plus/test";

import { liveProjects } from "../__fixtures__/account.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { platformAccess } from "./platformAccess.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
const known = () =>
  liveProjects("org", [{ id: "p" }]).reduce((s, i) => reduceAccount(s, i).state, emptyAccount);
const accessIn = (state: AccountState) =>
  platformAccess.derive(readsOfState(state), { orgId: "org", projectId: "p", viewer }).kind;

// witness: packages/client-runtime/src/data/projections/platformAccess.ts | fact.reason === "denied" ? "denied" : "unknown" → fact.reason === "removed" ? "denied" : "unknown"
it("PJ35: A project Zerops denies the viewer reads as denied, and an outage keeps the access last read", () => {
  expect(
    accessIn(
      reduceAccount(known(), { kind: "access", family: "project", id: "p", access: "denied" })
        .state,
    ),
  ).toBe("denied");
  expect(
    accessIn(
      reduceAccount(known(), {
        kind: "stream",
        key: "zerops:org",
        now: 0,
        event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "offline" } },
      }).state,
    ),
  ).toBe("allowed");
});
