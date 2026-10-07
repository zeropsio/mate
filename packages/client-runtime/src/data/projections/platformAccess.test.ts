import { describe, expect, it } from "vite-plus/test";
import { emptyAccount } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { platformAccess } from "./platformAccess.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
const known = () =>
  liveProjects("org", [{ id: "p" }]).reduce((s, i) => reduceAccount(s, i).state, emptyAccount);
describe("platform access from owner evidence", () => {
  it.each([
    ["unread", () => emptyAccount, "unknown"],
    ["listed", known, "allowed"],
    [
      "outage retains the role",
      () =>
        reduceAccount(known(), {
          kind: "stream",
          key: "zerops:org",
          now: 0,
          event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "offline" } },
        }).state,
      "allowed",
    ],
    ["partial roster does not grant an unknown project", () => emptyAccount, "unknown"],
    [
      "explicit denial",
      () =>
        reduceAccount(known(), { kind: "access", family: "project", id: "p", access: "denied" })
          .state,
      "denied",
    ],
  ] as const)("%s", (_name, state, expected) => {
    expect(
      platformAccess.derive(readsOfState(state()), { orgId: "org", projectId: "p", viewer }).kind,
    ).toBe(expected);
  });
});
