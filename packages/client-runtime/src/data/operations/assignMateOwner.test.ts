import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { liveZerops, ORG, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { accountOf, progressOf, zeropsOperations } from "../__fixtures__/operations.ts";
import { projectsScope } from "../families/project.ts";
import type { AccountStore } from "../store.ts";
import { ZeropsApiError, type ZeropsProject } from "../../zerops/api.ts";
import { assignMateOwnerExecutor } from "./executors/projectWrites.ts";

const ASSIGN = {
  kind: "assign-mate-owner",
  orgId: ORG,
  projectId: "p1",
  clientUserId: "ada",
} as const;

const owners = (...ids: ReadonlyArray<string>) =>
  ids.map((clientUserId) => ({ clientUserId, roleCode: "OWNER" }));

const account = () =>
  accountOf(liveZerops({ running: [], projects: [{ id: "p1", userRoles: owners("bob") }] }));

const roles = (store: AccountStore, userRoles: ReturnType<typeof owners>, version: number) =>
  store.dispatch({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "project",
        id: "p1",
        value: projectValue({ id: "p1", userRoles }),
        revision: zeropsVersion(version),
      },
    ],
  });

type Write = { readonly clientUserId: string; readonly roleCode: "OWNER" | null };

function operationsOf(store: AccountStore, answer: (write: Write) => Promise<ZeropsProject>) {
  const calls: Write[] = [];
  const submit = assignMateOwnerExecutor({
    setProjectMemberRole: (input) => {
      calls.push({ clientUserId: input.clientUserId, roleCode: input.roleCode });
      return answer(input);
    },
  });
  return { operations: zeropsOperations(store, submit), calls };
}

const handed = { id: "p1", name: "p1", status: "ACTIVE", userRoles: owners("ada", "bob") };

describe("assign-mate-owner", () => {
  it.effect("hands the Mate over, then takes it from every previous owner", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, async () => handed);
      yield* operations.submit(ASSIGN);
      expect(calls).toEqual([
        { clientUserId: "ada", roleCode: "OWNER" },
        { clientUserId: "bob", roleCode: null },
      ]);
      expect(progressOf(store)).toEqual({ stage: "done", operationId: "p1", outcome: "succeeded" });
    }),
  );

  it.effect(
    "says a hand over its previous owner still holds, and a refusal that wrote nothing",
    () =>
      Effect.gen(function* () {
        for (const [answer, expected, evidence] of [
          [
            async (write: Write) => {
              if (write.roleCode === null)
                throw new ZeropsApiError("Not allowed.", "forbidden", 403);
              return handed;
            },
            { stage: "done", operationId: "p1", outcome: "failed" },
            "It was handed over, but its previous owner still owns it too: Not allowed.",
          ],
          [
            async () => {
              throw new ZeropsApiError("Not allowed.", "forbidden", 403);
            },
            { stage: "refused", reason: "Not allowed." },
            null,
          ],
        ] as const) {
          const store = account();
          const { operations } = operationsOf(store, answer);
          yield* operations.submit(ASSIGN);
          expect(progressOf(store)).toEqual(expected);
          const outcome = store.state().operations.get("r1")?.receipt?.outcome;
          expect(outcome?.kind === "failed" ? outcome.evidence : null).toBe(evidence);
        }
      }),
  );

  it.effect("adopts a lost answer only once the project names the Mate's one owner", () =>
    Effect.gen(function* () {
      const store = account();
      const { operations, calls } = operationsOf(store, () =>
        Promise.reject(new ZeropsApiError("No answer.", "network")),
      );
      yield* operations.submit(ASSIGN);
      roles(store, owners("ada", "bob"), 2);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      roles(store, owners("ada"), 3);
      yield* operations.retry("r1");
      expect(progressOf(store)).toEqual({ stage: "done", operationId: "p1", outcome: "succeeded" });
      expect(calls).toEqual([{ clientUserId: "ada", roleCode: "OWNER" }]);
    }),
  );
});
