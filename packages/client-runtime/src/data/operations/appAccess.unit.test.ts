import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ZeropsApiError } from "../../zerops/errors.ts";
import type { ZeropsOrganizationMember } from "../../zerops/api/account.ts";
import { appAccessExecutor, type AppAccessPlatform } from "./executors/appAccess.ts";

const ORG = "org-1";
const PROJECTS = { places: ["prod", "stage"], mates: ["m-1"] };
const member = (id: string, roleCode: string, status = "ACTIVE"): ZeropsOrganizationMember => ({
  id,
  status,
  roleCode,
  user: { id: `u-${id}`, email: `${id}@example.com` },
});

function organization(
  members: ZeropsOrganizationMember[],
  grants: Record<string, Array<{ projectId: string; roleCode: string }>> = {},
  loseGrantWrite = false,
) {
  const writes: string[] = [];
  const unexpected = () => Promise.reject(new Error("Unexpected project or invitation operation."));
  const platform: AppAccessPlatform = {
    writeNewProjectAccess: unexpected,
    fetchProject: unexpected,
    validateOrganizationUser: unexpected,
    connectOrganizationUser: unexpected,
    listOrganizationMembers: async () => [...members],
    readMemberProjectRoles: async (id) => [...(grants[id] ?? [])],
    inviteOrganizationUser: async (_org, invite) => {
      writes.push("inviteOrganizationUser");
      members.push({
        id: "cu-new",
        status: "WAITING_AUTHORIZATION",
        roleCode: invite.roleCode,
        canCreateProjects: invite.canCreateProjects,
        user: { id: "u-new", email: invite.email },
      });
    },
    writeMemberProjectRoles: async (id, list) => {
      writes.push("writeMemberProjectRoles");
      if (loseGrantWrite) throw new ZeropsApiError("Lost.", "uncertain");
      grants[id] = [...list];
    },
    removeOrganizationMember: async (id) => {
      writes.push("removeOrganizationMember");
      members.splice(
        members.findIndex((one) => one.id === id),
        1,
      );
    },
  };
  return { executor: appAccessExecutor(platform, async () => undefined), writes, members, grants };
}

const set = (
  org: ReturnType<typeof organization>,
  clientUserId: string,
  change: "work" | "look" | "remove" | "withdraw",
) =>
  org.executor.setAccess("r1", {
    kind: "set-app-access",
    orgId: ORG,
    clientUserId,
    change,
    projects: PROJECTS,
    owned: [],
  });

// witness: packages/client-runtime/src/data/operations/executors/appAccess.ts | roleCode: "NO_ACCESS", → roleCode: "BASIC_USER",
it.effect(
  "OP15: A new address is invited with no organization access, then given the app's places",
  () =>
    Effect.gen(function* () {
      const org = organization([member("cu-owner", "OWNER")]);
      yield* org.executor.invite("r1", {
        kind: "invite-member",
        orgId: ORG,
        email: "eva@example.com",
        invitee: { kind: "new", firstName: "Eva", lastName: "Dvořáková" },
        level: "work",
        projects: PROJECTS,
      });
      expect(org.members.at(-1)).toMatchObject({ roleCode: "NO_ACCESS", canCreateProjects: true });
      expect(org.writes).toEqual(["inviteOrganizationUser", "writeMemberProjectRoles"]);
      expect(org.grants["cu-new"]).toEqual([
        { projectId: "prod", roleCode: "BASIC_USER" },
        { projectId: "stage", roleCode: "BASIC_USER" },
        { projectId: "m-1", roleCode: "READ_ONLY" },
      ]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/appAccess.ts | platform.writeMemberProjectRoles(clientUserId, planned.list) → platform.writeMemberProjectRoles(clientUserId, planned.list.filter((grant) => !current.some((held) => held.projectId === grant.projectId && held.roleCode === grant.roleCode)))
it.effect(
  "OP16: A project access level is written into the member's whole list, their other projects kept",
  () =>
    Effect.gen(function* () {
      const org = organization([member("cu-jan", "NO_ACCESS")], {
        "cu-jan": [{ projectId: "p-far", roleCode: "OWNER" }],
      });
      yield* set(org, "cu-jan", "look");
      expect(org.grants["cu-jan"]).toEqual([
        { projectId: "p-far", roleCode: "OWNER" },
        { projectId: "prod", roleCode: "READ_ONLY" },
        { projectId: "stage", roleCode: "READ_ONLY" },
        { projectId: "m-1", roleCode: "READ_ONLY" },
      ]);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/appAccess.ts | dropMembership = planned.dropMembership; → dropMembership = intent.change === "withdraw";
it.effect("OP17: Withdrawing an invitation that also opens another app keeps the invitation", () =>
  Effect.gen(function* () {
    const org = organization([member("cu-iva", "NO_ACCESS", "WAITING_AUTHORIZATION")], {
      "cu-iva": [
        { projectId: "prod", roleCode: "BASIC_USER" },
        { projectId: "p-other-app", roleCode: "BASIC_USER" },
      ],
    });
    yield* set(org, "cu-iva", "withdraw");
    expect(org.writes).not.toContain("removeOrganizationMember");
  }),
);

// witness: packages/client-runtime/src/data/operations/executors/appAccess.ts | sameList(read.success, planned.list) → sameList(read.success, current)
it.effect(
  "OP18: A lost access write that the member's list does not show is the person's to check, never sent again",
  () =>
    Effect.gen(function* () {
      const org = organization([member("cu-jan", "NO_ACCESS")], {}, true);
      const answer = yield* set(org, "cu-jan", "work");
      expect(org.writes).toEqual(["writeMemberProjectRoles"]);
      expect(answer).toMatchObject({
        unobservable: {
          nextActor: "person",
          nextAction: "Check their access, then choose again",
        },
      });
    }),
);
