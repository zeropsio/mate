import { describe, expect, it } from "vite-plus/test";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { organizationUserFamily } from "../families/organizationUser.ts";
import { platformCapabilities, platformMembership } from "./platformCapabilities.ts";

import { membershipInputs } from "../__fixtures__/membership.ts";
const stateOf = (inputs: AccountInput[]) =>
  inputs.reduce((s, i) => reduceAccount(s, i).state, emptyAccount);

describe("Zerops native capability table", () => {
  it.each([
    ["OWNER", true, true, true, true],
    ["ADMIN", true, true, true, true],
    ["BASIC_USER", false, true, true, false],
    ["READ_ONLY", false, true, false, false],
    ["NO_ACCESS", false, false, false, false],
  ] as const)(
    "%s matches project creation, read, operation and administration",
    (role, create, read, operate, administer) => {
      for (const flag of [false, true]) {
        const reads = readsOfState(
          stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs(role, flag)]),
        );
        expect(
          platformCapabilities.derive(reads, {
            orgId: "org",
            projectId: "p",
            viewer: platformMembership.derive(reads, "org").viewer,
          }),
        ).toEqual({
          createProject: create || flag,
          manageOrganization: administer,
          read,
          operate,
          administer,
        });
      }
    },
  );
  it.each(["OWNER", "ADMIN", "BASIC_USER", "READ_ONLY", "NO_ACCESS"])(
    "a %s project override replaces the organization role and uses the membership id",
    (role) => {
      const reads = readsOfState(
        stateOf([
          ...liveProjects("org", [
            {
              id: "p",
              userRoles: [
                { clientUserId: "member", roleCode: role },
                { clientUserId: "user", roleCode: "OWNER" },
              ],
            },
          ]),
          ...membershipInputs("OWNER"),
        ]),
      );
      expect(
        platformCapabilities.derive(reads, {
          orgId: "org",
          projectId: "p",
          viewer: platformMembership.derive(reads, "org").viewer,
        }).operate,
      ).toBe(["OWNER", "ADMIN", "BASIC_USER"].includes(role));
    },
  );
  it("membership arriving after first paint and a signed-in downgrade change the same capability source", () => {
    let state = stateOf([...liveProjects("org", [{ id: "p" }])]);
    const canOperate = () => {
      const reads = readsOfState(state);
      return platformCapabilities.derive(reads, {
        orgId: "org",
        projectId: "p",
        viewer: platformMembership.derive(reads, "org").viewer,
      }).operate;
    };
    expect(canOperate()).toBe(false);
    state = membershipInputs("ADMIN").reduce((s, i) => reduceAccount(s, i).state, state);
    expect(canOperate()).toBe(true);
    state = membershipInputs("READ_ONLY", false, 2).reduce(
      (s, i) => reduceAccount(s, i).state,
      state,
    );
    expect(canOperate()).toBe(false);
  });
  it("incomplete membership evidence cannot replace a verified role", () => {
    expect(
      organizationUserFamily.sampled!.decode({ id: "user", email: "test@example.test" }),
    ).toBeNull();
  });
});
