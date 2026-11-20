import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { AtomRegistry } from "effect/reactivity";
import { makeAccountStore } from "../store.ts";
import { presetMembership } from "../../zerops/teamRoles.ts";
import { admitPlatformOperation } from "./executors/platformAdmission.ts";
import type { OperationIntent } from "../model.ts";

const admitted = (intent: OperationIntent, roleCode: string) =>
  Effect.map(
    Effect.result(
      admitPlatformOperation({
        intent,
        store: makeAccountStore(AtomRegistry.make()),
        viewer: { id: "org", name: "Org", membershipId: "member", roleCode },
        active: () => true,
        readDetail: async () => false,
      }),
    ),
    Result.isSuccess,
  );

// witness: packages/client-runtime/src/data/operations/executors/platformAdmission.ts | intent.kind === "invite-member" || →
it.effect("OP20: Only an organization owner or admin invites people or changes their access", () =>
  Effect.gen(function* () {
    const projects = { places: ["p"], mates: [] };
    const check = { kind: "check-invitee", orgId: "org", email: "eva@example.com" } as const;
    const invite = {
      kind: "invite-member",
      orgId: "org",
      email: "eva@example.com",
      invitee: { kind: "existing", userId: "u-eva" },
      level: "work",
      projects,
    } as const;
    const app = {
      kind: "set-app-access",
      orgId: "org",
      clientUserId: "cu-eva",
      change: "look",
      projects,
      owned: [],
    } as const;
    const project = {
      kind: "set-project-access",
      orgId: "org",
      changes: [{ clientUserId: "cu-eva", projectId: "p", roleCode: "ADMIN" }],
    } as const;
    expect(yield* admitted(check, "ADMIN")).toBe(true);
    expect(yield* admitted(invite, "OWNER")).toBe(true);
    expect(yield* admitted(app, "ADMIN")).toBe(true);
    expect(yield* admitted(invite, "BASIC_USER")).toBe(false);
    expect(yield* admitted(app, "BASIC_USER")).toBe(false);
    expect(yield* admitted(project, "OWNER")).toBe(true);
    expect(yield* admitted(project, "BASIC_USER")).toBe(false);
  }),
);

// witness: packages/client-runtime/src/data/operations/executors/platformAdmission.ts | intent.kind === "set-org-role" || intent.kind === "remove-member" → intent.kind === "set-org-role"
it.effect("OP21: Only an organization owner or admin changes the team", () =>
  Effect.gen(function* () {
    const role = {
      kind: "set-org-role",
      orgId: "org",
      clientUserId: "cu-eva",
      membership: presetMembership("guest"),
    } as const;
    const remove = { kind: "remove-member", orgId: "org", clientUserId: "cu-eva" } as const;
    expect(yield* admitted(role, "OWNER")).toBe(true);
    expect(yield* admitted(remove, "ADMIN")).toBe(true);
    expect(yield* admitted(role, "BASIC_USER")).toBe(false);
    expect(yield* admitted(remove, "READ_ONLY")).toBe(false);
  }),
);
