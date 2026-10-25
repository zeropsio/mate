import { describe, expect, it } from "vite-plus/test";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { liveProjects } from "../__fixtures__/account.ts";
import { organizationUserFamily } from "../families/organizationUser.ts";
import {
  creditOffers,
  platformCapabilities,
  platformMembership,
  platformViewer,
  projectRoleOffers,
  roleOffers,
  teamOffers,
} from "./platformCapabilities.ts";

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
          setUpChief: (create || flag) && administer,
          reachesEveryProject: role !== "NO_ACCESS",
          manageOrganization: administer,
          editFinances: role === "OWNER",
          projectAccessKnown: true,
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
    // An owner and an admin make projects and mark the organization's Chief.
    ["OWNER", false, true],
    ["ADMIN", false, true],
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
  it("a Developer who may create projects is offered New project but no Chief: only an Owner or Admin marks the organization's", () => {
    const reads = readsOfState(
      stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs("NO_ACCESS", true)]),
    );
    const capabilities = platformCapabilities.derive(reads, {
      orgId: "org",
      viewer: platformMembership.derive(reads, "org").viewer,
    });
    expect(roleOffers(capabilities)).toEqual({ newProject: true, setUpChief: false });
  });
  it.each([
    ["OWNER", true, true],
    ["ADMIN", false, true],
    // A Developer and a Guest bring nobody in: Zerops lets only an owner or an admin invite.
    ["NO_ACCESS", true, false],
    ["NO_ACCESS", false, false],
    ["BASIC_USER", false, false],
    ["READ_ONLY", false, false],
  ] as const)(
    "a %s member (may create projects: %s) is offered inviting people: %s",
    (role, flag, offered) => {
      const reads = readsOfState(
        stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs(role, flag)]),
      );
      const capabilities = platformCapabilities.derive(reads, {
        orgId: "org",
        viewer: platformMembership.derive(reads, "org").viewer,
      });
      expect(teamOffers(capabilities)).toEqual({ invite: offered });
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

  it("a Guest whose role the session last knew is offered no New project, Chief or address door while the membership is read again", () => {
    const reads = readsOfState(stateOf([...liveProjects("org", [{ id: "p" }])]));
    const guest = { id: "org", name: "Org", membershipId: "member", roleCode: "NO_ACCESS" };
    const viewer = platformViewer({
      orgId: "org",
      read: platformMembership.derive(reads, "org").viewer,
      lastKnown: guest,
    });
    expect(roleOffers(platformCapabilities.derive(reads, { orgId: "org", viewer }))).toEqual({
      newProject: false,
      setUpChief: false,
    });
    expect(
      projectRoleOffers(
        platformCapabilities.derive(reads, { orgId: "org", projectId: "p", viewer }),
      ),
    ).toEqual({ manageAddresses: false });
  });
  it("the membership as read outranks the role the session last knew, and another organization's says nothing", () => {
    const reads = readsOfState(
      stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs("READ_ONLY")]),
    );
    const owner = { id: "org", name: "Org", membershipId: "member", roleCode: "OWNER" };
    const read = platformMembership.derive(reads, "org").viewer;
    expect(platformViewer({ orgId: "org", read, lastKnown: owner })?.roleCode).toBe("READ_ONLY");
    expect(
      platformViewer({ orgId: "org", read: undefined, lastKnown: { ...owner, id: "other" } }),
    ).toBeUndefined();
    expect(
      platformViewer({
        orgId: "org",
        read: undefined,
        lastKnown: { id: "org", name: "Org", membershipId: "member" },
      }),
    ).toBeUndefined();
  });

  it.each([
    ["OWNER", false, true],
    ["ADMIN", false, false],
    ["ADMIN", true, true],
    ["BASIC_USER", true, true],
    ["NO_ACCESS", false, false],
  ] as const)(
    "a %s member who may edit finances (%s) is offered adding the organization's credit: %s",
    (role, canEditFinances, offered) => {
      const reads = readsOfState(stateOf([...liveProjects("org", [{ id: "p" }])]));
      const viewer = {
        id: "org",
        name: "Org",
        membershipId: "member",
        roleCode: role,
        canEditFinances,
      };
      expect(creditOffers(platformCapabilities.derive(reads, { orgId: "org", viewer }))).toEqual({
        addCredit: offered,
      });
    },
  );

  it.each([
    ["OWNER", undefined, true],
    ["ADMIN", undefined, true],
    ["BASIC_USER", undefined, true],
    ["READ_ONLY", undefined, false],
    // A Guest given Read on a project reads its addresses and changes none; given Full, manages them.
    ["NO_ACCESS", "READ_ONLY", false],
    ["NO_ACCESS", "ADMIN", true],
  ] as const)(
    "a %s member with %s on a project is offered its addresses to manage: %s",
    (role, grant, offered) => {
      const reads = readsOfState(
        stateOf([
          ...liveProjects("org", [
            {
              id: "p",
              ...(grant === undefined
                ? {}
                : { userRoles: [{ clientUserId: "member", roleCode: grant }] }),
            },
          ]),
          ...membershipInputs(role),
        ]),
      );
      const capabilities = platformCapabilities.derive(reads, {
        orgId: "org",
        projectId: "p",
        viewer: platformMembership.derive(reads, "org").viewer,
      });
      expect(projectRoleOffers(capabilities)).toEqual({ manageAddresses: offered });
    },
  );
  it("a project whose access is not read yet keeps its address doors drawn", () => {
    const reads = readsOfState(stateOf([...membershipInputs("NO_ACCESS")]));
    const capabilities = platformCapabilities.derive(reads, {
      orgId: "org",
      projectId: "p",
      viewer: platformMembership.derive(reads, "org").viewer,
    });
    expect(projectRoleOffers(capabilities)).toEqual({ manageAddresses: true });
  });
});
