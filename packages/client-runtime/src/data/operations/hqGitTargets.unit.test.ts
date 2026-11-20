import type { HqGitOperationReceipt } from "@t3tools/shared/hqGitTargets";
import { gitEnvironment } from "../__fixtures__/hqWire.ts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { liveProjects, ORG } from "../__fixtures__/account.ts";
import { membershipInputs } from "../__fixtures__/membership.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { linkKeys } from "../model.ts";
import { HqError } from "../../zerops/hq/client.ts";

const TOKEN = "candidate-token-marker";
const intent = {
  kind: "connect-git-remote",
  orgId: ORG,
  appId: "shop",
  hqProjectId: "hq",
  repo: "web",
  url: "https://github.com/o/web.git",
} as const;
const answer = (requestId: string): HqGitOperationReceipt => ({
  requestId,
  operationId: requestId,
  executor: "hq",
  affected: [],
  handles: [requestId],
  acceptance: { kind: "accepted" },
  outcome: { kind: "succeeded", evidence: "HQ verified the remote." },
});

function setup(
  options: {
    orgRole?: string | null;
    send?: HqWrites["gitTargetWrite"];
    lookup?: HqWrites["gitTargetReceipt"];
  } = {},
) {
  const store = makeAccountStore(AtomRegistry.make());
  for (const key of [linkKeys.hq(ORG), hqAppsScope(ORG), placementsScope(ORG)]) {
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "attempt" } });
  }
  const orgRole = options.orgRole === undefined ? "ADMIN" : options.orgRole;
  if (orgRole !== null)
    for (const input of [...membershipInputs(orgRole), ...liveProjects(ORG, [{ id: "dev" }])])
      store.dispatch(input);
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [hqAppsScope(ORG), placementsScope(ORG)].map((scope) => ({ scope, generation: 1 })),
    reset: true,
    rows: [
      // A project the application develops in: who releases it is who develops in it.
      {
        family: "placement",
        id: "dev",
        revision: { kind: "hq", incarnation: "i", revision: 1 },
        value: {
          projectId: "dev",
          appId: "shop",
          name: "dev",
          kind: "mate",
          mate: null,
          person: { mine: false, ownerUserId: null, waitsOnViewer: false, unseen: null },
          signedInNow: {},
          everSignedIn: {},
        },
      } as never,
      {
        family: "hqApp",
        id: "shop",
        revision: { kind: "hq", incarnation: "i", revision: 1 },
        value: {
          id: "shop",
          name: "Shop",
          contents: { empty: false, deletingProjectIds: [] },
          projectIds: ["dev"],
          births: [],
          environments: [gitEnvironment],
        },
      } as never,
    ],
    removals: [],
  });
  const transcript: unknown[] = [];
  let bodyHadToken = false;
  const executor = makeHqExecutor({
    apiOf: () =>
      ({
        gitTargetWrite:
          options.send ??
          (async (id, write, candidate) => {
            bodyHadToken = candidate === TOKEN;
            transcript.push({
              method: "POST",
              operationId: id,
              kind: write.kind,
              repo: "repo" in write ? write.repo : undefined,
            });
            return answer(id);
          }),
        gitTargetReceipt: options.lookup,
      }) as HqWrites,
    zerops: {
      mintIntegrationToken: () => Promise.reject(new Error("Unexpected mint")),
      deleteIntegrationToken: () => Promise.reject(new Error("Unexpected revoke")),
    },
    gitStore: store,
    active: () => true,
    hqProjectIdOf: () => "hq",
  });
  const operations = makeOperations({ store, executors: { hq: executor }, makeId: () => "r1" });
  return { store, executor, operations, transcript, bodyHadToken: () => bodyHadToken };
}
const serialized = (store: AccountStore) => JSON.stringify([...store.state().operations]);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | api.gitTargetWrite(id, intent, token) → api.gitTargetWrite(id, Object.assign(intent, { token }), token)
it.effect(
  "OP38: A Git credential candidate reaches the executor once and never enters the intent, the store, the receipt or a retained transcript",
  () =>
    Effect.gen(function* () {
      const f = setup();
      const pending = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      expect(serialized(f.store)).not.toContain(TOKEN);
      yield* pending;
      const record = f.store.state().operations.get("r1");
      expect(JSON.stringify(record?.intent)).not.toContain(TOKEN);
      expect(serialized(f.store)).not.toContain(TOKEN);
      expect(JSON.stringify(record?.receipt)).not.toContain(TOKEN);
      expect(JSON.stringify(f.transcript)).not.toContain(TOKEN);
      expect(f.bodyHadToken()).toBe(true);
      expect(f.transcript).toEqual([
        { method: "POST", operationId: "r1", kind: "connect-git-remote", repo: "web" },
      ]);
      expect(record?.receipt?.operationId).toBe("r1");
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
    }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | if (offer.kind !== "allowed") → if (offer.kind === "refused")
it.effect("OP39: Every Git target write requires the server's offer", () =>
  Effect.gen(function* () {
    for (const orgRole of [null, "BASIC_USER"]) {
      const f = setup({ orgRole });
      yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      expect(f.transcript).toEqual([]);
      expect(f.store.state().operations.get("r1")?.receipt?.acceptance.kind).toBe("refused");
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
    }
  }),
);

// witness: packages/client-runtime/src/data/operations/executors/hq.ts | () => api.gitTargetReceipt(requestId, intent) → () => api.gitTargetReceipt(requestId, intent).then((receipt) => receipt ?? api.gitTargetWrite(requestId, intent))
it.effect("OP40: An absent owner answer never authorizes a second Git write", () =>
  Effect.gen(function* () {
    const writes: string[] = [];
    const f = setup({
      send: async (id) => {
        writes.push(id);
        throw new HqError({ kind: "uncertain", code: "lost", message: "Answer lost" });
      },
      lookup: async () => null,
    });
    yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
    yield* f.operations.retry("r1");
    expect(writes).toEqual(["r1"]);
    expect(operationProgress.derive(readsOfState(f.store.state()), "r1")).toEqual({
      stage: "uncertain",
      next: "ask-owner-again",
    });
  }),
);
