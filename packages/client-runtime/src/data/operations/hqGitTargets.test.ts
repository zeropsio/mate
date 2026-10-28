import type { HqDeliveryNavigationJob } from "@t3tools/shared/hqStream";
import type { HqApplicationOffers } from "@t3tools/shared/hqOffers";
import { gitRemote, gitAdoption, gitEnvironment } from "../__fixtures__/hqWire.ts";
import { HqEnvironmentId } from "@t3tools/contracts";
import * as data from "@t3tools/client-runtime/data";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import type { HqGitTargetIntent } from "./hqGitTargets.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { ORG } from "../__fixtures__/account.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { linkKeys, type OperationReceipt } from "../model.ts";
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
const answer = (requestId: string): OperationReceipt => ({
  requestId,
  operationId: requestId,
  executor: "hq",
  affected: [],
  handles: [requestId],
  acceptance: { kind: "accepted" },
  outcome: { kind: "succeeded", evidence: "HQ verified the remote." },
});
let revision = 0;
const publish = (
  store: AccountStore,
  can: HqApplicationOffers,
  jobs: ReadonlyArray<HqDeliveryNavigationJob> = gitEnvironment.jobs,
) =>
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: hqAppsScope(ORG), generation: 1 }],
    reset: true,
    rows: [
      {
        family: "hqApp",
        id: "shop",
        revision: { kind: "hq", incarnation: "i", revision: ++revision },
        value: {
          id: "shop",
          name: "Shop",
          can,
          contents: { empty: false, deletingProjectIds: [] },
          projectIds: [],
          births: [],
          environments: [
            {
              ...gitEnvironment,
              jobs,
              can: { remove_git_environment: { allow: true }, redeploy: { allow: true } },
            },
          ],
        },
      } as never,
    ],
    removals: [],
  });
function setup(
  options: {
    can?: HqApplicationOffers;
    send?: HqWrites["gitTargetWrite"];
    lookup?: HqWrites["gitTargetReceipt"];
  } = {},
) {
  const store = makeAccountStore(AtomRegistry.make());
  for (const key of [linkKeys.hq(ORG), hqAppsScope(ORG)]) {
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "demand", demanded: true } });
    store.dispatch({ kind: "stream", key, now: 0, event: { kind: "attempt" } });
  }
  publish(
    store,
    options.can ?? {
      add_mate: { allow: true },
      structure: { allow: true },
      release: { allow: true },
      add_git_environment: { allow: true },
    },
  );
  const transcript: unknown[] = [];
  let bodyHadToken = false;
  const executor = makeHqExecutor({
    apiOf: () =>
      ({
        gitTargetWrite:
          options.send ??
          (async (id, write, candidate) => {
            // Inspect the transient HTTP input; retained transcript contains only safe metadata.
            const body = JSON.stringify({
              operationId: id,
              ...write,
              ...(candidate === undefined ? {} : { token: candidate }),
            });
            bodyHadToken = body.includes(TOKEN);
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

describe("Git target operations through the existing HQ executor", () => {
  it.effect(
    "a candidate reaches the executor once without entering intent, store, receipt or retained transcript",
    () =>
      Effect.gen(function* () {
        const f = setup();
        expect(typeof f.executor.submitGitCandidate).toBe("function");
        const pending = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
        expect(serialized(f.store)).not.toContain(TOKEN);
        expect(JSON.stringify(f.executor)).not.toContain(TOKEN);
        yield* pending;
        expect(f.bodyHadToken()).toBe(true);
        expect(f.transcript).toEqual([
          { method: "POST", operationId: "r1", kind: intent.kind, repo: "web" },
        ]);
        expect(serialized(f.store)).not.toContain(TOKEN);
        expect(JSON.stringify(f.transcript)).not.toContain(TOKEN);
        expect(f.store.state().operations.get("r1")?.receipt?.operationId).toBe("r1");
        expect(f.executor.hasGitCandidate("r1")).toBe(false);
      }),
  );
  it.effect("a cancelled candidate is cleared before any write", () =>
    Effect.gen(function* () {
      const f = setup();
      const pending = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      f.executor.cancelGitCandidate("r1");
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
      yield* pending;
      expect(f.transcript).toEqual([]);
      expect(serialized(f.store)).not.toContain(TOKEN);
    }),
  );
  it.effect("account close clears a candidate and fences a later submit", () =>
    Effect.gen(function* () {
      const f = setup();
      const pending = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      f.store.close();
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
      yield* pending;
      expect(f.transcript).toEqual([]);
      expect(serialized(f.store)).not.toContain(TOKEN);
    }),
  );
  it.effect("a used candidate cannot be resent after a lost answer", () =>
    Effect.gen(function* () {
      let sends = 0;
      const f = setup({
        send: async () => {
          sends += 1;
          throw new HqError({ kind: "uncertain", code: "lost", message: "Answer lost" });
        },
      });
      yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      yield* f.operations.retry("r1");
      expect(sends).toBe(1);
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
      expect(operationProgress.derive(readsOfState(f.store.state()), "r1").stage).toBe("uncertain");
      expect(serialized(f.store)).not.toContain(TOKEN);
    }),
  );
  it.effect("a delayed owner receipt is accepted only for the original operation identity", () =>
    Effect.gen(function* () {
      let reply: OperationReceipt | null = { ...answer("other"), operationId: "other" };
      const f = setup({
        send: async () => {
          throw new HqError({ kind: "uncertain", code: "lost", message: "Answer lost" });
        },
        lookup: async () => reply,
      });
      yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      expect(f.store.state().operations.get("r1")?.receipt).toBeNull();
      reply = answer("r1");
      yield* f.operations.retry("r1");
      expect(f.store.state().operations.get("r1")?.receipt?.operationId).toBe("r1");
      expect(serialized(f.store)).not.toContain(TOKEN);
    }),
  );
  it.effect.each<{ readonly can: HqApplicationOffers; readonly reason: string }>([
    { can: {}, reason: "unknown" },
    { can: { structure: { allow: false, reason: "not_structure_writer" } }, reason: "refused" },
  ])("every write requires the server offer: $reason", ({ can }) =>
    Effect.gen(function* () {
      const f = setup({ can });
      yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      expect(f.transcript).toEqual([]);
      expect(f.store.state().operations.get("r1")?.receipt?.acceptance.kind).toBe("refused");
      expect(f.executor.hasGitCandidate("r1")).toBe(false);
    }),
  );
  it.effect(
    "a failed replacement preserves observed remote facts and fences stale local invalidation",
    () =>
      Effect.gen(function* () {
        const f = setup({
          send: async () => {
            throw new HqError({
              kind: "refused",
              code: "credential",
              message: "Candidate refused",
            });
          },
        });
        const scope = hqAppDetailScope(ORG, "shop");
        f.store.dispatch({
          kind: "stream",
          key: scope,
          now: 0,
          event: { kind: "demand", demanded: true },
        });
        f.store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
        f.store.dispatch({
          kind: "delivery",
          via: "hq-stream",
          scopes: [{ scope, generation: 1 }],
          reset: true,
          rows: [
            {
              family: "hqAppDetail",
              id: "shop/repos",
              revision: { kind: "hq", incarnation: "i", revision: 2 },
              value: {
                kind: "repos",
                value: [
                  {
                    name: "web",
                    mainHead: gitAdoption.mainHead,
                    updatedAt: gitRemote.keptAt,
                    remote: gitRemote,
                  },
                ],
              },
            } as never,
          ],
          removals: [],
        });
        expect(readsOfState(f.store.state()).fact("hqAppDetail", "shop/repos")).toMatchObject({
          kind: "known",
          value: { kind: "repos", value: [{ remote: gitRemote }] },
        });
        const before = JSON.stringify([...f.store.state().facts]);
        yield* f.executor.submitGitCandidate(
          f.operations,
          "r1",
          {
            kind: "replace-git-remote-token",
            orgId: ORG,
            appId: "shop",
            hqProjectId: "hq",
            repo: "web",
          },
          TOKEN,
        );
        expect(JSON.stringify([...f.store.state().facts])).toBe(before);
        expect(f.store.state().operations.get("r1")?.receipt?.acceptance.kind).toBe("refused");
        expect(serialized(f.store)).not.toContain(TOKEN);
      }),
  );
});

const app = { orgId: ORG, appId: "shop", hqProjectId: "hq" };
const target = { kind: "git", branch: "main", delivery: "direct" } as const;
it.effect.each<HqGitTargetIntent>([
  { ...intent, kind: "probe-git-remote" },
  intent,
  { ...app, kind: "replace-git-remote-token", repo: "web" },
  { ...app, kind: "disconnect-git-remote", repo: "web" },
  { ...app, kind: "preview-git-environment", request: { target } },
  {
    ...app,
    kind: "add-git-environment",
    request: { tier: "production", name: "Production", target, adoption: [gitAdoption] },
  },
  {
    ...app,
    kind: "remove-git-environment",
    environmentId: HqEnvironmentId.make(gitEnvironment.id),
  },
  { ...app, kind: "preflight-git-release" },
  {
    ...app,
    kind: "run-git-again",
    environmentId: HqEnvironmentId.make(gitEnvironment.id),
    repo: "web",
  },
])("$kind forwards only the offered operation and reviewed input to HQ", (write) =>
  Effect.gen(function* () {
    let observed: HqGitTargetIntent | undefined;
    const f = setup({
      send: async (id, input) => {
        observed = input;
        return answer(id);
      },
    });
    if (
      write.kind === "connect-git-remote" ||
      write.kind === "probe-git-remote" ||
      write.kind === "replace-git-remote-token"
    )
      yield* f.executor.submitGitCandidate(f.operations, "r1", write, TOKEN);
    else yield* f.operations.submit(write);
    expect(observed).toEqual(write);
    expect(f.store.state().operations.get("r1")?.receipt?.requestId).toBe("r1");
    expect(serialized(f.store)).not.toContain(TOKEN);
    if (write.kind === "run-git-again") {
      expect(observed).not.toHaveProperty("sha");
      expect(observed).not.toHaveProperty("force");
    }
  }),
);
it.effect("candidate errors and echoed answers never retain the candidate marker", () =>
  Effect.gen(function* () {
    for (const send of [
      async () => {
        throw new HqError({ kind: "refused", code: TOKEN, message: TOKEN });
      },
      async (id: string) => ({
        ...answer(id),
        outcome: { kind: "succeeded" as const, evidence: TOKEN },
      }),
    ]) {
      const f = setup({ send });
      yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      expect(serialized(f.store)).not.toContain(TOKEN);
    }
  }),
);
it.effect(
  "a cancelled candidate effect cannot consume a replacement candidate under the same identity",
  () =>
    Effect.gen(function* () {
      const f = setup();
      const old = f.executor.submitGitCandidate(f.operations, "r1", intent, "old-marker");
      f.executor.cancelGitCandidate("r1");
      const replacement = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
      yield* old;
      expect(f.transcript).toEqual([]);
      yield* replacement;
      expect(f.bodyHadToken()).toBe(true);
      expect(f.transcript).toHaveLength(1);
    }),
);

it.effect(
  "an accepted Run again follows its exact job and sha when the owner fact arrives after submission",
  () =>
    Effect.gen(function* () {
      const original = {
        ...gitEnvironment.jobs[0]!,
        environment: "Production",
        job: "push-v2",
        state: "queued" as const,
        behind: null,
      };
      const f = setup({
        send: async (id) => ({
          ...answer(id),
          acceptance: { kind: "accepted", result: { jobs: [original], note: null } },
          outcome: { kind: "pending" },
        }),
      });
      publish(f.store, {}, []);
      const write = {
        ...app,
        kind: "run-git-again",
        environmentId: HqEnvironmentId.make(gitEnvironment.id),
        repo: "web",
      } as const;
      yield* f.operations.submit(write);
      expect(operationProgress.derive(readsOfState(f.store.state()), "r1").stage).toBe("accepted");
      publish(f.store, {}, [{ ...gitEnvironment.jobs[0]!, id: "another-job" }]);
      expect(operationProgress.derive(readsOfState(f.store.state()), "r1").stage).toBe("accepted");
      publish(f.store, {}, gitEnvironment.jobs);
      expect(operationProgress.derive(readsOfState(f.store.state()), "r1")).toMatchObject({
        stage: "done",
        outcome: "succeeded",
      });
    }),
);

it.effect("an absent owner answer never authorizes a second Git write", () =>
  Effect.gen(function* () {
    let sends = 0;
    const f = setup({
      send: async () => {
        sends += 1;
        throw new HqError({ kind: "uncertain", code: "lost", message: "Answer lost" });
      },
      lookup: async () => null,
    });
    yield* f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
    yield* f.operations.retry("r1");
    expect(sends).toBe(1);
    expect(operationProgress.derive(readsOfState(f.store.state()), "r1")).toEqual({
      stage: "uncertain",
      next: "ask-owner-again",
    });
  }),
);
it.effect("a server offer withdrawn after candidate entry prevents the write", () =>
  Effect.gen(function* () {
    const f = setup();
    const pending = f.executor.submitGitCandidate(f.operations, "r1", intent, TOKEN);
    publish(f.store, { structure: { allow: false, reason: "not_structure_writer" } });
    yield* pending;
    expect(f.transcript).toEqual([]);
    expect(operationProgress.derive(readsOfState(f.store.state()), "r1")).toMatchObject({
      stage: "refused",
      reason: "not_structure_writer",
    });
  }),
);
it.effect(
  "a refused or diverged release offer cannot send preflight or manufacture a release",
  () =>
    Effect.gen(function* () {
      for (const reason of ["credential", "diverged", "releasing"]) {
        const f = setup({ can: { release: { allow: false, reason } } });
        yield* f.operations.submit({ ...app, kind: "preflight-git-release" });
        expect(f.transcript).toEqual([]);
        expect(operationProgress.derive(readsOfState(f.store.state()), "r1")).toMatchObject({
          stage: "refused",
          reason,
        });
      }
    }),
);
it.effect(
  "Git host recovery preserves the current remote and never invalidates it in the client",
  () =>
    Effect.gen(function* () {
      const f = setup({
        send: async () => {
          throw new HqError({
            kind: "unavailable",
            code: "rate_limit",
            status: 429,
            message: "GitHub asked HQ to wait",
          });
        },
      });
      const before = JSON.stringify([...f.store.state().facts]);
      yield* f.operations.submit({ ...app, kind: "preflight-git-release" });
      expect(JSON.stringify([...f.store.state().facts])).toBe(before);
      expect(operationProgress.derive(readsOfState(f.store.state()), "r1").stage).toBe("unsent");
    }),
);

it("the public data entry exposes the single delivery answer and environment readers", () => {
  expect(typeof data.deliveryAnswerSaid).toBe("function");
  expect(typeof data.deliveryAnswerFollowing).toBe("function");
  expect(typeof data.deliveryEnvironmentsOf).toBe("function");
  const job = gitEnvironment.jobs[0]!;
  const answer = {
    jobs: [{ ...job, environment: "Production", job: job.id, behind: null }],
    note: null,
  };
  expect(data.deliveryAnswerSaid(answer).environments[0]?.jobs[0]?.text).toBe(
    "web bbbbbbb pushed to refs/heads/main",
  );
  expect(data.deliveryAnswerFollowing(answer, new Map([[job.id, job]])).jobs[0]?.sha).toBe(
    "b".repeat(40),
  );
  expect(data.deliveryEnvironmentsOf([gitEnvironment])?.[0]?.id).toBe("git-production");
});

it.effect(
  "A reviewed remote address update is one authority-gated operation with a stable id and no token",
  () =>
    Effect.gen(function* () {
      const f = setup({ can: { structure: { allow: true } } });
      const update = {
        kind: "update-git-remote-address",
        orgId: ORG,
        appId: "shop",
        hqProjectId: "hq",
        repo: "web",
        url: "https://github.com/renamed/web",
      } as const;
      yield* f.operations.submit(update, "address-1");
      expect(f.transcript).toEqual([
        {
          method: "POST",
          operationId: "address-1",
          kind: "update-git-remote-address",
          repo: "web",
        },
      ]);
      expect(serialized(f.store)).not.toContain(TOKEN);
      expect(f.store.state().operations.get("address-1")?.receipt?.operationId).toBe("address-1");
    }),
);
