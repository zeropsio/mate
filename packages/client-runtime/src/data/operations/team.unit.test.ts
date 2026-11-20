import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { teamExecutor } from "./executors/team.ts";

// witness: packages/client-runtime/src/data/operations/executors/team.ts | verb(() => platform.listOrganizationMembers(orgId)), → verb(async () => (await platform.listOrganizationMembers(orgId)).map(({ roleCode: _role, ...member }) => member)),
it.effect("OP19: An admin taking another admin out of the team is refused before it is sent", () =>
  Effect.gen(function* () {
    const removed: string[] = [];
    const executor = teamExecutor(
      {
        listOrganizationMembers: async () => [
          {
            id: "cu-eva",
            status: "ACTIVE",
            roleCode: "ADMIN",
            user: { id: "u-cu-eva", email: "cu-eva@example.com" },
          },
        ],
        updateOrganizationMember: () => Promise.reject(new Error("Unexpected role change.")),
        removeOrganizationMember: async (id) => {
          removed.push(id);
        },
      },
      async () => undefined,
      () => "ADMIN",
    );
    const answer = yield* Effect.result(
      executor.removeMember("r1", {
        kind: "remove-member",
        orgId: "org-1",
        clientUserId: "cu-eva",
      }),
    );
    expect(removed).toEqual([]);
    expect(Result.isFailure(answer) && answer.failure).toMatchObject({
      message: "Admins can't remove an owner or another admin.",
    });
  }),
);
