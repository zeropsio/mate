import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore } from "../../store.ts";
import { liveProjects } from "../../__fixtures__/account.ts";
import { admitPlatformOperation } from "./platformAdmission.ts";
import type { OperationIntent } from "../../model.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
describe("operation admission from the account store", () => {
  it.effect.each([
    { kind: "delete-project", orgRole: "ADMIN", projectRole: "BASIC_USER", allowed: false },
    { kind: "rename-project", orgRole: "ADMIN", projectRole: "BASIC_USER", allowed: false },
    { kind: "start-project", orgRole: "ADMIN", projectRole: "BASIC_USER", allowed: true },
    { kind: "assign-mate-owner", orgRole: "NO_ACCESS", projectRole: "OWNER", allowed: false },
    { kind: "finish-mate-handover", orgRole: "NO_ACCESS", projectRole: "OWNER", allowed: false },
    { kind: "finish-mate-handover", orgRole: "ADMIN", projectRole: "ADMIN", allowed: true },
  ] as const)("$kind requires its actual project or organization role", (entry) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      for (const input of liveProjects("org", [
        { id: "p", userRoles: [{ clientUserId: "member", roleCode: entry.projectRole }] },
      ]))
        store.dispatch(input);
      const intent: OperationIntent =
        entry.kind === "rename-project"
          ? { kind: entry.kind, orgId: "org", projectId: "p", name: "New name" }
          : entry.kind === "assign-mate-owner"
            ? { kind: entry.kind, orgId: "org", projectId: "p", clientUserId: "ada" }
            : entry.kind === "finish-mate-handover"
              ? {
                  kind: entry.kind,
                  orgId: "org",
                  projectId: "p",
                  clientUserId: "ada",
                  previousOwnerIds: ["bob"],
                }
              : { kind: entry.kind, orgId: "org", projectId: "p" };
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent,
          store,
          viewer: { ...viewer, roleCode: entry.orgRole },
          active: () => true,
          readDetail: async () => false,
        }),
      );
      expect(Result.isSuccess(result)).toBe(entry.allowed);
    }),
  );

  it.effect.each([
    { kind: "check-invitee", orgRole: "ADMIN", allowed: true },
    { kind: "invite-member", orgRole: "OWNER", allowed: true },
    { kind: "set-app-access", orgRole: "ADMIN", allowed: true },
    { kind: "invite-member", orgRole: "BASIC_USER", allowed: false },
    { kind: "set-app-access", orgRole: "BASIC_USER", allowed: false },
    { kind: "set-project-access", orgRole: "OWNER", allowed: true },
    { kind: "set-project-access", orgRole: "BASIC_USER", allowed: false },
  ] as const)(
    "Only an organization owner or admin invites people or changes their access: $kind as $orgRole",
    (entry) =>
      Effect.gen(function* () {
        const projects = { places: ["p"], mates: [] };
        const intent: OperationIntent =
          entry.kind === "check-invitee"
            ? { kind: entry.kind, orgId: "org", email: "eva@example.com" }
            : entry.kind === "set-project-access"
              ? {
                  kind: entry.kind,
                  orgId: "org",
                  changes: [{ clientUserId: "cu-eva", projectId: "p", roleCode: "ADMIN" }],
                }
              : entry.kind === "invite-member"
                ? {
                    kind: entry.kind,
                    orgId: "org",
                    email: "eva@example.com",
                    invitee: { kind: "existing", userId: "u-eva" },
                    level: "work",
                    projects,
                  }
                : {
                    kind: entry.kind,
                    orgId: "org",
                    clientUserId: "cu-eva",
                    change: "look",
                    projects,
                    owned: [],
                  };
        const result = yield* Effect.result(
          admitPlatformOperation({
            intent,
            store: makeAccountStore(AtomRegistry.make()),
            viewer: { ...viewer, roleCode: entry.orgRole },
            active: () => true,
            readDetail: async () => false,
          }),
        );
        expect(Result.isSuccess(result)).toBe(entry.allowed);
      }),
  );

  it.effect.each([
    { kind: "set-org-role", orgRole: "OWNER", allowed: true },
    { kind: "remove-member", orgRole: "ADMIN", allowed: true },
    { kind: "set-org-role", orgRole: "BASIC_USER", allowed: false },
    { kind: "remove-member", orgRole: "READ_ONLY", allowed: false },
  ] as const)("Only an organization owner or admin changes the team: $kind as $orgRole", (entry) =>
    Effect.gen(function* () {
      const intent: OperationIntent =
        entry.kind === "set-org-role"
          ? { kind: entry.kind, orgId: "org", clientUserId: "cu-eva", role: "guest" }
          : { kind: entry.kind, orgId: "org", clientUserId: "cu-eva" };
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent,
          store: makeAccountStore(AtomRegistry.make()),
          viewer: { ...viewer, roleCode: entry.orgRole },
          active: () => true,
          readDetail: async () => false,
        }),
      );
      expect(Result.isSuccess(result)).toBe(entry.allowed);
      if (Result.isFailure(result))
        expect(result.failure.message).toBe(
          "Only an organization owner or admin can change the team.",
        );
    }),
  );

  it.effect.each([
    {
      name: "a known project",
      listed: true,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: true,
      reads: 0,
    },
    {
      name: "an outage retains access",
      listed: true,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: true,
      reads: 0,
      outage: true,
    },
    {
      name: "unknown coverage",
      listed: false,
      active: true,
      denied: false,
      role: "ADMIN",
      allowed: false,
      reads: 1,
    },
    {
      name: "an authoritative denial",
      listed: true,
      active: true,
      denied: true,
      role: "ADMIN",
      allowed: false,
      reads: 0,
    },
    {
      name: "a reader cannot write",
      listed: true,
      active: true,
      denied: false,
      role: "READ_ONLY",
      allowed: false,
      reads: 0,
    },
    {
      name: "the account closed",
      listed: true,
      active: false,
      denied: false,
      role: "ADMIN",
      allowed: false,
      reads: 0,
    },
  ])("$name", (entry) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      if (entry.listed)
        for (const input of liveProjects("org", [{ id: "p" }])) store.dispatch(input);
      if (entry.denied)
        store.dispatch({ kind: "access", family: "project", id: "p", access: "denied" });
      if (entry.outage)
        store.dispatch({
          kind: "stream",
          key: "zerops:org",
          now: 0,
          event: { kind: "fault", jitter: 0, fault: { outcome: "transient", message: "Offline" } },
        });
      let reads = 0;
      const intent: OperationIntent = { kind: "start-project", orgId: "org", projectId: "p" };
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent,
          store,
          viewer: { ...viewer, roleCode: entry.role },
          active: () => entry.active,
          readDetail: async (demand) => {
            expect(demand).toEqual({ family: "project", listing: "project", ownerId: "p" });
            reads++;
            return false;
          },
        }),
      );
      expect(Result.isSuccess(result)).toBe(entry.allowed);
      if (Result.isFailure(result)) expect(result.failure.outcome).toBe("definitive-refusal");
      expect(reads).toBe(entry.reads);
    }),
  );
  it.effect("rechecks the account after an awaited access read", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let active = true;
      const result = yield* Effect.result(
        admitPlatformOperation({
          intent: { kind: "start-project", orgId: "org", projectId: "p" },
          store,
          viewer,
          active: () => active,
          readDetail: async () => {
            for (const input of liveProjects("org", [{ id: "p" }])) store.dispatch(input);
            active = false;
            return true;
          },
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
    }),
  );
});

describe("giving a project just made its people", () => {
  it.effect.each([
    { orgRole: "BASIC_USER", canCreateProjects: true, allowed: true },
    { orgRole: "READ_ONLY", canCreateProjects: false, allowed: false },
  ] as const)(
    "Whoever may create projects gives the one they made its people: $orgRole",
    ({ orgRole, canCreateProjects, allowed }) =>
      Effect.gen(function* () {
        const result = yield* Effect.result(
          admitPlatformOperation({
            intent: {
              kind: "grant-new-project-access",
              orgId: "org",
              projectId: "p",
              userRoles: [{ clientUserId: "cu-ada", roleCode: "ADMIN" }],
            },
            store: makeAccountStore(AtomRegistry.make()),
            viewer: { ...viewer, roleCode: orgRole, canCreateProjects },
            active: () => true,
            readDetail: async () => false,
          }),
        );
        expect(Result.isSuccess(result)).toBe(allowed);
      }),
  );
});
