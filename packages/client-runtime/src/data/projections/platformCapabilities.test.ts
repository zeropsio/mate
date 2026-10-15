import { describe, expect, it } from "vite-plus/test";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { organizationUserFamily } from "../families/organizationUser.ts";
import { platformCapabilities, platformMembership, roleOffers } from "./platformCapabilities.ts";

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
          membershipKnown: true,
          createProject: create || flag,
          setUpChief: create || flag,
          reachesEveryProject: role !== "NO_ACCESS",
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
  it("a membership not read yet is not known, so no control reads it as a refusal", () => {
    const reads = readsOfState(stateOf([...liveProjects("org", [{ id: "p" }])]));
    expect(
      platformCapabilities.derive(reads, {
        orgId: "org",
        viewer: platformMembership.derive(reads, "org").viewer,
      }),
    ).toMatchObject({ membershipKnown: false, createProject: false, setUpChief: false });
  });
  it("incomplete membership evidence cannot replace a verified role", () => {
    expect(
      organizationUserFamily.sampled!.decode({ id: "user", email: "test@example.test" }),
    ).toBeNull();
  });

  it.each([
    // An owner, an admin and a Developer make projects and a Chief of their own.
    ["OWNER", false, true],
    ["ADMIN", false, true],
    ["NO_ACCESS", true, true],
    // A Guest is never told to start a project, nor offered a Chief, which would be one.
    ["NO_ACCESS", false, false],
    ["READ_ONLY", false, false],
    ["BASIC_USER", false, false],
  ] as const)(
    "a %s member who may create projects (%s) is offered New project and a Chief: %s",
    (role, flag, offered) => {
      const reads = readsOfState(
        stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs(role, flag)]),
      );
      const capabilities = platformCapabilities.derive(reads, {
        orgId: "org",
        viewer: platformMembership.derive(reads, "org").viewer,
      });
      expect(roleOffers(capabilities)).toEqual({ newProject: offered, setUpChief: offered });
    },
  );
  it("while the membership is not read, what is drawn stays drawn", () => {
    const reads = readsOfState(stateOf([...liveProjects("org", [{ id: "p" }])]));
    const capabilities = platformCapabilities.derive(reads, {
      orgId: "org",
      viewer: platformMembership.derive(reads, "org").viewer,
    });
    expect(roleOffers(capabilities)).toEqual({ newProject: true, setUpChief: true });
  });
});
