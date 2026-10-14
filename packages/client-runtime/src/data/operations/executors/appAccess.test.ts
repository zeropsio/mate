import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsApiError, type ZeropsOrganizationMember } from "../../../zerops/api.ts";
import { appAccessExecutor, type AppAccessPlatform } from "./appAccess.ts";

const ORG = "org-1";
const PROJECTS = { places: ["prod", "stage"], mates: ["m-1"] };

type Verb = keyof AppAccessPlatform;

/**
 * A Zerops organization in memory: its members and each one's own grants, answering as Zerops
 * does unless `fail` says a verb answers otherwise. Records each call and each read-back.
 */
function organization(
  members: Array<ZeropsOrganizationMember>,
  grants: Record<string, Array<{ projectId: string; roleCode: string }>> = {},
  fail: Partial<Record<Verb, "landed" | (() => Promise<never>)>> = {},
) {
  const calls: Array<string> = [];
  const readBack: Array<ReadonlyArray<string>> = [];
  const failing = <A>(verb: Verb, run: () => A | Promise<A>) => {
    calls.push(verb);
    const failure = fail[verb];
    if (failure === undefined) return Promise.resolve().then(run);
    // Zerops took it; only its answer was lost.
    if (failure === "landed") return Promise.resolve().then(run).then(lost);
    return failure();
  };
  const platform: AppAccessPlatform = {
    validateOrganizationUser: (_org, email) =>
      failing("validateOrganizationUser", () => {
        if (members.some((one) => one.user?.email === email))
          throw new ZeropsApiError(
            "Already.",
            "invalid-input",
            400,
            "userAlreadyConnectedToCompany",
          );
        return email === "known@example.com"
          ? { kind: "existing" as const, userId: "u-known" }
          : { kind: "new" as const };
      }),
    inviteOrganizationUser: (_org, invite) =>
      failing("inviteOrganizationUser", () => {
        members.push({
          id: "cu-new",
          status: "WAITING_AUTHORIZATION",
          roleCode: invite.roleCode,
          canCreateProjects: invite.canCreateProjects,
          user: { id: "u-new", email: invite.email },
        });
      }),
    connectOrganizationUser: (_org, invite) =>
      failing("connectOrganizationUser", () => {
        members.push({
          id: "cu-known",
          status: "WAITING_AUTHORIZATION",
          roleCode: invite.roleCode,
          user: { id: invite.userId, email: "Known@Example.com" },
        });
      }),
    listOrganizationMembers: () => failing("listOrganizationMembers", () => [...members]),
    readMemberProjectRoles: (id) =>
      failing("readMemberProjectRoles", () => [...(grants[id] ?? [])]),
    writeMemberProjectRoles: (id, list) =>
      failing("writeMemberProjectRoles", () => {
        grants[id] = [...list];
      }),
    removeOrganizationMember: (id) =>
      failing("removeOrganizationMember", () => {
        members.splice(
          members.findIndex((one) => one.id === id),
          1,
        );
      }),
  };
  const executor = appAccessExecutor(platform, async (orgId, projectIds) => {
    expect(orgId).toBe(ORG);
    readBack.push(projectIds);
  });
  return { executor, calls, readBack, members, grants };
}

const member = (id: string, roleCode: string, status = "ACTIVE"): ZeropsOrganizationMember => ({
  id,
  status,
  roleCode,
  user: { id: `u-${id}`, email: `${id}@example.com` },
});

const lost = () => Promise.reject(new ZeropsApiError("Lost.", "uncertain"));
const forbidden = () =>
  Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403, "forbidden"));

describe("checking an address before it is invited", () => {
  it.effect.each([
    { email: "known@example.com", result: { kind: "existing", userId: "u-known" } },
    { email: "new@example.com", result: { kind: "new" } },
  ])("An address is answered as who it is to Zerops: $email", ({ email, result }) =>
    Effect.gen(function* () {
      const { executor } = organization([]);
      const receipt = yield* executor.check("r1", { kind: "check-invitee", orgId: ORG, email });
      expect(receipt).toMatchObject({
        acceptance: { kind: "accepted", result },
        outcome: { kind: "succeeded" },
      });
    }),
  );

  it.effect("An address already in the organization is answered as that member", () =>
    Effect.gen(function* () {
      const { executor } = organization([member("cu-eva", "NO_ACCESS")]);
      const receipt = yield* executor.check("r1", {
        kind: "check-invitee",
        orgId: ORG,
        email: "cu-eva@example.com",
      });
      expect(receipt).toMatchObject({
        acceptance: {
          result: {
            kind: "member",
            clientUserId: "cu-eva",
            userId: "u-cu-eva",
            roleCode: "NO_ACCESS",
          },
        },
      });
    }),
  );

  it.effect.each([
    {
      sentence:
        "An address Zerops says is taken, which its member list doesn't show, is said in words",
      fail: {
        validateOrganizationUser: () =>
          Promise.reject(new ZeropsApiError("Dup.", "invalid-input", 400, "duplicatedUser")),
      },
      message: "Already in this organization — change their access in the list.",
    },
    {
      sentence: "Zerops refusing the viewer says who may invite",
      fail: { validateOrganizationUser: forbidden },
      message: "Only an organization owner or admin can invite.",
    },
  ])("$sentence", ({ fail, message }) =>
    Effect.gen(function* () {
      const { executor } = organization([], {}, fail);
      const answer = yield* Effect.result(
        executor.check("r1", { kind: "check-invitee", orgId: ORG, email: "eva@example.com" }),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({ message });
    }),
  );

  it.effect("A check whose answer was lost is asked again by the person, never a write", () =>
    Effect.gen(function* () {
      const { executor } = organization([], {}, { validateOrganizationUser: lost });
      const answer = yield* Effect.result(
        executor.check("r1", { kind: "check-invitee", orgId: ORG, email: "new@example.com" }),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({ outcome: "transient" });
    }),
  );
});

describe("inviting someone to an app", () => {
  it.effect(
    "A new address is invited with no organization access, then given the app's places",
    () =>
      Effect.gen(function* () {
        const org = organization([member("cu-owner", "OWNER")]);
        const receipt = yield* org.executor.invite("r1", {
          kind: "invite-member",
          orgId: ORG,
          email: "eva@example.com",
          invitee: { kind: "new", firstName: "Eva", lastName: "Dvořáková" },
          level: "work",
          projects: PROJECTS,
        });
        expect(org.calls).toEqual([
          "inviteOrganizationUser",
          "listOrganizationMembers",
          "readMemberProjectRoles",
          "writeMemberProjectRoles",
        ]);
        expect(org.members.at(-1)).toMatchObject({
          roleCode: "NO_ACCESS",
          canCreateProjects: true,
        });
        expect(org.grants["cu-new"]).toEqual([
          { projectId: "prod", roleCode: "BASIC_USER" },
          { projectId: "stage", roleCode: "BASIC_USER" },
          { projectId: "m-1", roleCode: "READ_ONLY" },
        ]);
        expect(org.readBack).toEqual([["prod", "stage"]]);
        expect(receipt).toMatchObject({
          acceptance: { kind: "accepted", result: { clientUserId: "cu-new" } },
          outcome: { kind: "succeeded" },
        });
      }),
  );

  it.effect("An existing account is connected, and someone who only looks can't add projects", () =>
    Effect.gen(function* () {
      const org = organization([]);
      yield* org.executor.invite("r1", {
        kind: "invite-member",
        orgId: ORG,
        email: "known@example.com",
        invitee: { kind: "existing", userId: "u-known" },
        level: "look",
        projects: PROJECTS,
      });
      expect(org.calls[0]).toBe("connectOrganizationUser");
      expect(org.grants["cu-known"]).toEqual([
        { projectId: "prod", roleCode: "READ_ONLY" },
        { projectId: "stage", roleCode: "READ_ONLY" },
        { projectId: "m-1", roleCode: "READ_ONLY" },
      ]);
    }),
  );

  const inviteEva = (org: ReturnType<typeof organization>) =>
    org.executor.invite("r1", {
      kind: "invite-member",
      orgId: ORG,
      email: "eva@example.com",
      invitee: { kind: "new", firstName: "Eva", lastName: "D" },
      level: "work",
      projects: PROJECTS,
    });

  it.effect("An invitation whose answer was lost goes on once the member list shows it", () =>
    Effect.gen(function* () {
      const org = organization([], {}, { inviteOrganizationUser: "landed" });
      const receipt = yield* inviteEva(org);
      expect(receipt).toMatchObject({ outcome: { kind: "succeeded" } });
      expect(org.calls.filter((verb) => verb === "inviteOrganizationUser")).toHaveLength(1);
    }),
  );

  it.effect(
    "An invitation whose answer was lost, and that the list doesn't show, is the person's to check",
    () =>
      Effect.gen(function* () {
        const org = organization([], {}, { inviteOrganizationUser: lost });
        const answer = yield* inviteEva(org);
        expect(answer).toMatchObject({
          unobservable: {
            nextActor: "person",
            nextAction: "Check the organization's members in Zerops, then invite again",
          },
        });
        expect(org.calls.filter((verb) => verb === "inviteOrganizationUser")).toHaveLength(1);
      }),
  );

  it.effect("An invitation Zerops took, but whose access it refused, says both", () =>
    Effect.gen(function* () {
      const org = organization(
        [],
        {},
        {
          writeMemberProjectRoles: () =>
            Promise.reject(new ZeropsApiError("Nope.", "invalid-input", 400, "x", "Nope.")),
        },
      );
      const receipt = yield* org.executor.invite("r1", {
        kind: "invite-member",
        orgId: ORG,
        email: "eva@example.com",
        invitee: { kind: "new", firstName: "Eva", lastName: "D" },
        level: "work",
        projects: PROJECTS,
      });
      expect(receipt).toMatchObject({
        outcome: {
          kind: "failed",
          evidence: "They're invited, but Zerops didn't take their access here: Nope.",
        },
      });
    }),
  );

  it.effect("An address invited meanwhile is said in words", () =>
    Effect.gen(function* () {
      const org = organization(
        [],
        {},
        {
          inviteOrganizationUser: () =>
            Promise.reject(new ZeropsApiError("Dup.", "invalid-input", 400, "duplicatedUser")),
        },
      );
      const answer = yield* Effect.result(
        org.executor.invite("r1", {
          kind: "invite-member",
          orgId: ORG,
          email: "eva@example.com",
          invitee: { kind: "new", firstName: "Eva", lastName: "D" },
          level: "work",
          projects: PROJECTS,
        }),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "Already in this organization — change their access in the list.",
      });
    }),
  );
});

describe("changing a member's access to an app", () => {
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

  it.effect("A level is written into the member's whole list, their other projects kept", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-jan", "NO_ACCESS")], {
        "cu-jan": [{ projectId: "p-far", roleCode: "OWNER" }],
      });
      const receipt = yield* set(org, "cu-jan", "look");
      expect(org.grants["cu-jan"]).toEqual([
        { projectId: "p-far", roleCode: "OWNER" },
        { projectId: "prod", roleCode: "READ_ONLY" },
        { projectId: "stage", roleCode: "READ_ONLY" },
        { projectId: "m-1", roleCode: "READ_ONLY" },
      ]);
      expect(org.readBack).toEqual([["prod", "stage"]]);
      expect(receipt).toMatchObject({
        acceptance: { result: { membershipEnded: false } },
        outcome: { kind: "succeeded" },
      });
    }),
  );

  it.effect("A level the member already has writes nothing", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-jan", "READ_ONLY")]);
      yield* set(org, "cu-jan", "look");
      expect(org.calls).not.toContain("writeMemberProjectRoles");
    }),
  );

  it.effect("Withdrawing an invitation that opened only this app ends it", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-iva", "NO_ACCESS", "WAITING_AUTHORIZATION")], {
        "cu-iva": [{ projectId: "prod", roleCode: "BASIC_USER" }],
      });
      const receipt = yield* set(org, "cu-iva", "withdraw");
      expect(org.calls.slice(-2)).toEqual(["writeMemberProjectRoles", "removeOrganizationMember"]);
      expect(org.members).toEqual([]);
      expect(receipt).toMatchObject({ acceptance: { result: { membershipEnded: true } } });
    }),
  );

  it.effect("Withdrawing an invitation that opens another app too keeps it", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-iva", "NO_ACCESS", "WAITING_AUTHORIZATION")], {
        "cu-iva": [
          { projectId: "prod", roleCode: "BASIC_USER" },
          { projectId: "p-other-app", roleCode: "BASIC_USER" },
        ],
      });
      yield* set(org, "cu-iva", "withdraw");
      expect(org.calls).not.toContain("removeOrganizationMember");
    }),
  );

  it.effect("A grants write whose answer was lost is proven by reading the list back", () =>
    Effect.gen(function* () {
      const org = organization(
        [member("cu-jan", "NO_ACCESS")],
        {},
        {
          writeMemberProjectRoles: "landed",
        },
      );
      const receipt = yield* set(org, "cu-jan", "work");
      expect(receipt).toMatchObject({ outcome: { kind: "succeeded" } });
    }),
  );

  it.effect(
    "A lost grants write the list doesn't show is the person's to check, never resent",
    () =>
      Effect.gen(function* () {
        const org = organization(
          [member("cu-jan", "NO_ACCESS")],
          {},
          {
            writeMemberProjectRoles: lost,
          },
        );
        const answer = yield* set(org, "cu-jan", "work");
        expect(answer).toMatchObject({
          unobservable: {
            nextActor: "person",
            nextAction: "Check their access, then choose again",
          },
        });
        expect(org.calls.filter((verb) => verb === "writeMemberProjectRoles")).toHaveLength(1);
      }),
  );

  it.effect("Someone no longer in the organization is said so, and nothing is written", () =>
    Effect.gen(function* () {
      const org = organization([]);
      const answer = yield* Effect.result(set(org, "cu-gone", "work"));
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "They're no longer in this organization.",
      });
      expect(org.calls).toEqual(["listOrganizationMembers"]);
    }),
  );

  it.effect("Zerops refusing the viewer says who may change access", () =>
    Effect.gen(function* () {
      const org = organization(
        [member("cu-jan", "NO_ACCESS")],
        {},
        {
          writeMemberProjectRoles: forbidden,
        },
      );
      const answer = yield* Effect.result(set(org, "cu-jan", "work"));
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "Only an organization owner or admin can change who has access.",
      });
    }),
  );
});

describe("setting who reaches some projects", () => {
  const set = (
    org: ReturnType<typeof organization>,
    changes: ReadonlyArray<{
      clientUserId: string;
      projectId: string;
      roleCode: "ADMIN" | "READ_ONLY" | null;
    }>,
  ) => org.executor.setProjectAccess("r1", { kind: "set-project-access", orgId: ORG, changes });

  it.effect("Each person's change is one write of their own list, their other projects kept", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-ada", "NO_ACCESS"), member("cu-bo", "BASIC_USER")], {
        "cu-ada": [{ projectId: "p-far", roleCode: "OWNER" }],
        "cu-bo": [{ projectId: "stage", roleCode: "READ_ONLY" }],
      });
      const receipt = yield* set(org, [
        { clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" },
        { clientUserId: "cu-ada", projectId: "prod", roleCode: "ADMIN" },
        { clientUserId: "cu-bo", projectId: "stage", roleCode: null },
      ]);
      expect(org.grants).toEqual({
        "cu-ada": [
          { projectId: "p-far", roleCode: "OWNER" },
          { projectId: "stage", roleCode: "ADMIN" },
          { projectId: "prod", roleCode: "ADMIN" },
        ],
        "cu-bo": [],
      });
      expect(org.calls.filter((verb) => verb === "writeMemberProjectRoles")).toHaveLength(2);
      // The member list and every project touched are read again before it reports done.
      expect(org.readBack).toEqual([["stage", "prod"]]);
      expect(receipt).toMatchObject({ outcome: { kind: "succeeded" } });
    }),
  );

  it.effect("A change someone already has writes nothing", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-ada", "READ_ONLY")]);
      yield* set(org, [{ clientUserId: "cu-ada", projectId: "stage", roleCode: "READ_ONLY" }]);
      expect(org.calls).not.toContain("writeMemberProjectRoles");
    }),
  );

  it.effect("A project write whose answer was lost is proven by reading the list back", () =>
    Effect.gen(function* () {
      const org = organization(
        [member("cu-ada", "NO_ACCESS")],
        {},
        { writeMemberProjectRoles: "landed" },
      );
      const receipt = yield* set(org, [
        { clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" },
      ]);
      expect(receipt).toMatchObject({ outcome: { kind: "succeeded" } });
    }),
  );

  it.effect("A lost project write the list doesn't show is the person's to check", () =>
    Effect.gen(function* () {
      const org = organization(
        [member("cu-ada", "NO_ACCESS")],
        {},
        { writeMemberProjectRoles: lost },
      );
      const answer = yield* set(org, [
        { clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" },
      ]);
      expect(answer).toMatchObject({
        unobservable: { nextActor: "person", nextAction: "Check their access, then choose again" },
      });
      expect(org.readBack).toEqual([["stage"]]);
    }),
  );

  it.effect("Someone who left the organization is said so before anything is written", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-ada", "NO_ACCESS")]);
      const answer = yield* Effect.result(
        set(org, [
          { clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" },
          { clientUserId: "cu-gone", projectId: "stage", roleCode: "ADMIN" },
        ]),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "They're no longer in this organization.",
      });
      expect(org.calls).toEqual(["listOrganizationMembers"]);
    }),
  );

  it.effect("Zerops refusing a project change says who may change access", () =>
    Effect.gen(function* () {
      const org = organization(
        [member("cu-ada", "NO_ACCESS")],
        {},
        { writeMemberProjectRoles: forbidden },
      );
      const answer = yield* Effect.result(
        set(org, [{ clientUserId: "cu-ada", projectId: "stage", roleCode: "ADMIN" }]),
      );
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "Only an organization owner or admin can change who has access.",
      });
      expect(org.readBack).toEqual([["stage"]]);
    }),
  );
});
