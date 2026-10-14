import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { ZeropsApiError, type ZeropsOrganizationMember } from "../../../zerops/api.ts";
import { teamExecutor, type TeamPlatform } from "./team.ts";

const ORG = "org-1";

type Verb = keyof TeamPlatform;

/**
 * A Zerops organization in memory: its memberships, answering as Zerops does unless `fail` says a
 * verb answers otherwise. Records each call and each read-back; the viewer holds `viewerRole`.
 */
function organization(
  members: Array<ZeropsOrganizationMember>,
  viewerRole = "OWNER",
  fail: Partial<Record<Verb, "landed" | (() => Promise<never>)>> = {},
) {
  const calls: Array<string> = [];
  const readBack: Array<string> = [];
  const failing = <A>(verb: Verb, run: () => A | Promise<A>) => {
    calls.push(verb);
    const failure = fail[verb];
    if (failure === undefined) return Promise.resolve().then(run);
    // Zerops took it; only its answer was lost.
    if (failure === "landed") return Promise.resolve().then(run).then(lost);
    return failure();
  };
  const sent: Array<unknown> = [];
  const platform: TeamPlatform = {
    listOrganizationMembers: () => failing("listOrganizationMembers", () => [...members]),
    updateOrganizationMember: (id, membership) =>
      failing("updateOrganizationMember", () => {
        sent.push(membership);
        const at = members.findIndex((one) => one.id === id);
        members[at] = { ...members[at]!, ...membership };
      }),
    removeOrganizationMember: (id) =>
      failing("removeOrganizationMember", () => {
        members.splice(
          members.findIndex((one) => one.id === id),
          1,
        );
      }),
  };
  const executor = teamExecutor(
    platform,
    async (orgId, clientUserId) => {
      expect(orgId).toBe(ORG);
      readBack.push(clientUserId);
    },
    () => viewerRole,
  );
  return { executor, calls, readBack, members, sent };
}

const member = (
  id: string,
  roleCode: string,
  extra: Partial<ZeropsOrganizationMember> = {},
): ZeropsOrganizationMember => ({
  id,
  status: "ACTIVE",
  roleCode,
  user: { id: `u-${id}`, email: `${id}@example.com` },
  ...extra,
});

const lost = () => Promise.reject(new ZeropsApiError("Lost.", "uncertain"));
const forbidden = () =>
  Promise.reject(new ZeropsApiError("Not allowed.", "forbidden", 403, "forbidden"));

const setRole = (
  org: ReturnType<typeof organization>,
  role: "owner" | "admin" | "developer" | "guest",
) =>
  Effect.result(
    org.executor.setRole("r1", { kind: "set-org-role", orgId: ORG, clientUserId: "cu-eva", role }),
  );

describe("changing a person's role on the team", () => {
  it.effect.each([
    {
      role: "developer" as const,
      written: { roleCode: "NO_ACCESS", canCreateProjects: true },
    },
    { role: "guest" as const, written: { roleCode: "NO_ACCESS", canCreateProjects: false } },
    { role: "admin" as const, written: { roleCode: "ADMIN", canCreateProjects: true } },
    { role: "owner" as const, written: { roleCode: "OWNER", canCreateProjects: true } },
  ])(
    "Making someone $role writes their membership, then reads the team again",
    ({ role, written }) =>
      Effect.gen(function* () {
        const org = organization([member("cu-eva", "BASIC_USER", { canViewFinances: true })]);
        const answer = yield* setRole(org, role);
        expect(Result.isSuccess(answer) && answer.success).toMatchObject({
          outcome: { kind: "succeeded" },
        });
        // Finances stay Zerops HQ's: sent back as they were.
        expect(org.sent).toEqual([{ ...written, canViewFinances: true, canEditFinances: false }]);
        expect(org.readBack).toEqual(["cu-eva"]);
      }),
  );

  it.effect("A role they hold already is written nowhere", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS", { canCreateProjects: false })]);
      yield* setRole(org, "guest");
      expect(org.calls).toEqual(["listOrganizationMembers"]);
      expect(org.readBack).toEqual(["cu-eva"]);
    }),
  );

  it.effect.each([
    {
      sentence: "Someone no longer in the organization is said so, and nothing is written",
      members: [],
      viewerRole: "OWNER",
      role: "guest" as const,
      message: "They're no longer in this organization.",
    },
    {
      sentence: "An admin changing an owner is refused before it is sent",
      members: [member("cu-eva", "OWNER")],
      viewerRole: "ADMIN",
      role: "guest" as const,
      message: "Admins can't change an owner's or another admin's role.",
    },
    {
      sentence: "An admin making someone an admin is refused before it is sent",
      members: [member("cu-eva", "NO_ACCESS")],
      viewerRole: "ADMIN",
      role: "admin" as const,
      message: "Only an organization owner can make someone an owner or admin.",
    },
  ])("$sentence", ({ members, viewerRole, role, message }) =>
    Effect.gen(function* () {
      const org = organization([...members], viewerRole);
      const answer = yield* setRole(org, role);
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        outcome: "definitive-refusal",
        message,
      });
      expect(org.calls).not.toContain("updateOrganizationMember");
    }),
  );

  it.effect("Zerops refusing the viewer says who may change the team", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS")], "OWNER", {
        updateOrganizationMember: forbidden,
      });
      const answer = yield* setRole(org, "developer");
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "Only an organization owner or admin can change the team.",
      });
    }),
  );

  it.effect("A role change whose answer was lost is proven by the team read again", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS")], "OWNER", {
        updateOrganizationMember: "landed",
      });
      const answer = yield* setRole(org, "developer");
      expect(Result.isSuccess(answer) && answer.success).toMatchObject({
        outcome: { kind: "succeeded" },
      });
      expect(org.calls.filter((one) => one === "updateOrganizationMember")).toHaveLength(1);
    }),
  );

  it.effect("A role change lost and not shown is the person's to check, never sent again", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS")], "OWNER", {
        updateOrganizationMember: lost,
      });
      const answer = yield* setRole(org, "developer");
      expect(Result.isSuccess(answer) && answer.success).toMatchObject({
        unobservable: { nextActor: "person" },
      });
      expect(org.calls.filter((one) => one === "updateOrganizationMember")).toHaveLength(1);
    }),
  );
});

describe("taking someone off the team", () => {
  const remove = (org: ReturnType<typeof organization>) =>
    Effect.result(
      org.executor.removeMember("r1", {
        kind: "remove-member",
        orgId: ORG,
        clientUserId: "cu-eva",
      }),
    );

  it.effect("Removing someone ends their membership, then reads the team again", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS")]);
      const answer = yield* remove(org);
      expect(Result.isSuccess(answer) && answer.success).toMatchObject({
        outcome: { kind: "succeeded" },
      });
      expect(org.members).toEqual([]);
      expect(org.readBack).toEqual(["cu-eva"]);
    }),
  );

  it.effect("Someone already gone is gone: nothing is sent", () =>
    Effect.gen(function* () {
      const org = organization([]);
      const answer = yield* remove(org);
      expect(Result.isSuccess(answer)).toBe(true);
      expect(org.calls).toEqual(["listOrganizationMembers"]);
    }),
  );

  it.effect("An admin taking another admin out is refused before it is sent", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "ADMIN")], "ADMIN");
      const answer = yield* remove(org);
      expect(Result.isFailure(answer) && answer.failure).toMatchObject({
        message: "Admins can't remove an owner or another admin.",
      });
      expect(org.calls).not.toContain("removeOrganizationMember");
    }),
  );

  it.effect("A removal whose answer was lost is proven by the team read again", () =>
    Effect.gen(function* () {
      const org = organization([member("cu-eva", "NO_ACCESS")], "OWNER", {
        removeOrganizationMember: "landed",
      });
      const answer = yield* remove(org);
      expect(Result.isSuccess(answer) && answer.success).toMatchObject({
        outcome: { kind: "succeeded" },
      });
    }),
  );
});
