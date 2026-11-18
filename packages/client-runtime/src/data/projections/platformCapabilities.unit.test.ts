import { expect, it } from "vite-plus/test";

import { liveProjects } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import {
  creditOffers,
  platformCapabilities,
  platformMembership,
  roleOffers,
} from "./platformCapabilities.ts";

const stateOf = (inputs: AccountInput[]) =>
  inputs.reduce((s, i) => reduceAccount(s, i).state, emptyAccount);

/** Whether the organization's OWNER `member`, given `role` on project `p` itself, operates `p`. */
const operatesOverridden = (role: string) => {
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
  return platformCapabilities.derive(reads, {
    orgId: "org",
    projectId: "p",
    viewer: platformMembership.derive(reads, "org").viewer,
  }).operate;
};

// witness: packages/client-runtime/src/zerops/mateAccess.ts | entry.clientUserId === input.viewer.membershipId → entry.clientUserId === input.viewer.id
it("PJ28: A person's role on a project, where the project names one, replaces their organization role there", () => {
  expect(operatesOverridden("OWNER")).toBe(true);
  expect(operatesOverridden("ADMIN")).toBe(true);
  expect(operatesOverridden("BASIC_USER")).toBe(true);
  expect(operatesOverridden("READ_ONLY")).toBe(false);
  expect(operatesOverridden("NO_ACCESS")).toBe(false);
});

const offersTo = (role: string, mayCreate: boolean) => {
  const reads = readsOfState(
    stateOf([...liveProjects("org", [{ id: "p" }]), ...membershipInputs(role, mayCreate)]),
  );
  return roleOffers(
    platformCapabilities.derive(reads, {
      orgId: "org",
      viewer: platformMembership.derive(reads, "org").viewer,
    }),
  );
};

// witness: packages/shared/src/zeropsRoles.ts | (roleAtLeast(member.roleCode, "ADMIN") || member.canCreateProjects === true) → (roleAtLeast(member.roleCode, "BASIC_USER") || member.canCreateProjects === true)
it("PJ29: New project and a Chief are offered to an organization's Owner, its Admin and a member Zerops lets create projects, and to nobody else", () => {
  expect(offersTo("OWNER", false)).toEqual({ newProject: true, setUpChief: true });
  expect(offersTo("ADMIN", false)).toEqual({ newProject: true, setUpChief: true });
  expect(offersTo("NO_ACCESS", true)).toEqual({ newProject: true, setUpChief: true });
  expect(offersTo("NO_ACCESS", false)).toEqual({ newProject: false, setUpChief: false });
  expect(offersTo("READ_ONLY", false)).toEqual({ newProject: false, setUpChief: false });
  expect(offersTo("BASIC_USER", false)).toEqual({ newProject: false, setUpChief: false });
});

const creditTo = (role: string, canEditFinances: boolean) => {
  const reads = readsOfState(stateOf([...liveProjects("org", [{ id: "p" }])]));
  const viewer = {
    id: "org",
    name: "Org",
    membershipId: "member",
    roleCode: role,
    canEditFinances,
  };
  return creditOffers(platformCapabilities.derive(reads, { orgId: "org", viewer }));
};

// witness: packages/client-runtime/src/data/projections/platformCapabilities.ts | member.roleCode === "OWNER" → roleAtLeast(member.roleCode, "ADMIN")
it("PJ30: Adding the organization's credit is offered to its Owner and to any member who may edit finances, and to nobody else", () => {
  expect(creditTo("OWNER", false)).toEqual({ addCredit: true });
  expect(creditTo("ADMIN", false)).toEqual({ addCredit: false });
  expect(creditTo("ADMIN", true)).toEqual({ addCredit: true });
  expect(creditTo("BASIC_USER", true)).toEqual({ addCredit: true });
  expect(creditTo("NO_ACCESS", false)).toEqual({ addCredit: false });
});
