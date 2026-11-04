import { describe, expect, it } from "vite-plus/test";

import { liveProjects } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateVisibility } from "./mateVisibility.ts";

const stateOf = (inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
const verdict = (inputs: ReadonlyArray<AccountInput>, projectId = "mate") =>
  mateVisibility.derive(readsOfState(stateOf(inputs)), { orgId: "org", projectId });

// Brief W3 (Karel, 2026-11-04): HQ lists every Mate of the organization; the client hides what the
// person cannot reach, from the project row and their own org role as Zerops pushes them.
describe("a Mate's visibility from live Zerops data", () => {
  it.each([
    ["READ_ONLY", [], "listed"],
    ["BASIC_USER", [], "open"],
    ["READ_ONLY", [{ clientUserId: "member", roleCode: "BASIC_USER" }], "open"],
    ["OWNER", [{ clientUserId: "member", roleCode: "NO_ACCESS" }], "hidden"],
  ] as const)("an org %s member with grants %j on its project: %s", (role, userRoles, want) => {
    expect(
      verdict([...liveProjects("org", [{ id: "mate", userRoles }]), ...membershipInputs(role)]),
    ).toBe(want);
  });

  it("hides a Mate HQ lists whose project the person's whole roster lacks", () => {
    expect(
      verdict([...liveProjects("org", [{ id: "other" }]), ...membershipInputs("NO_ACCESS")]),
    ).toBe("hidden");
  });

  it("hides nothing before the person's membership or roster is read", () => {
    expect(verdict(liveProjects("org", [{ id: "other" }]))).toBe("unknown");
    expect(verdict(membershipInputs("NO_ACCESS"))).toBe("unknown");
  });
});
