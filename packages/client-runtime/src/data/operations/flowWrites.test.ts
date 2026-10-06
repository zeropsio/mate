import { describe, expect, it } from "@effect/vitest";
import type { HqChange } from "@t3tools/shared/hqChanges";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import type { Release } from "@t3tools/shared/hqRelease";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ORG } from "../__fixtures__/account.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { operationResult, type OperationIntent } from "../model.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { HqError } from "../../zerops/hq/client.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";

const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const LINK = { appId: "shop", repo: "web", number: 7 };
const DEPLOYS: HqDeployAnswer = { jobs: [], note: "Deploying to production." };

const release = (tag: string, over: Partial<Release> = {}): Release => ({
  tag,
  sha: SHA,
  entries: [{ service: "api", sha: SHA }],
  by: "ada",
  at: "2026-10-06T00:00:00Z",
  state: "approved",
  reason: null,
  rollbackOf: null,
  ...over,
});
const change = (state: HqChange["state"]): HqChange => ({
  appId: "shop",
  repo: "web",
  number: 7,
  mateProjectId: "ada",
  title: "Add a page",
  body: "",
  state,
  head: HEAD,
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-06T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-06T00:00:00Z",
  mergeability: "clean",
  behind: false,
  ready: true,
  comments: null,
});
const job = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "deploy",
  service: "api",
  sha: SHA,
  state: "queued",
  cause: "run_again",
  ref: null,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-10-06T00:00:00Z",
  endedAt: null,
  supersededBy: null,
  ...over,
});

let revision = 0;
const next = () => ({ kind: "hq", incarnation: "i", revision: (revision += 1) }) as const;
/** HQ's app-detail scope saying one of the application's records. */
const detail = (store: AccountStore, key: "releases" | "changes", value: unknown) =>
  store.dispatch({
    kind: "hq-delivery",
    scopes: [{ scope: hqAppDetailScope(ORG, "shop"), generation: 0 }],
    reset: false,
    rows: [
      {
        family: "hqAppDetail",
        id: `shop/${key}`,
        revision: next(),
        value: { kind: key, value },
      } as never,
    ],
    removals: [],
  });
/** HQ's navigation saying the application's stage, with its jobs. */
const stageJobs = (store: AccountStore, jobs: ReadonlyArray<unknown>) =>
  store.dispatch({
    kind: "hq-delivery",
    scopes: [{ scope: hqAppsScope(ORG), generation: 0 }],
    reset: false,
    rows: [
      {
        family: "hqApp",
        id: "shop",
        revision: next(),
        value: {
          id: "shop",
          name: "Shop",
          can: {},
          contents: { empty: false, deletingProjectIds: [] },
          projectIds: ["stage"],
          births: [],
          environments: [
            {
              projectId: "stage",
              tier: "stage",
              name: "stage",
              sources: ["main"],
              order: 1,
              keyHeld: true,
              keyInvalid: false,
              can: {},
              jobs,
              release: null,
              birth: null,
            },
          ],
        },
      } as never,
    ],
    removals: [],
  });

/** HQ's writes, each answering `answer` and recording its call. */
function hqOf(answer: () => Promise<unknown>) {
  const calls: unknown[] = [];
  const call =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return answer() as never;
    };
  const writes = {
    commentOnChange: call("commentOnChange"),
    createApp: call("createApp"),
    recordBirth: call("recordBirth"),
    bindBirth: call("bindBirth"),
    attachProject: call("attachProject"),
    createMate: call("createMate"),
    recordClosedOff: call("recordClosedOff"),
    keepDeployToken: call("keepDeployToken"),
    release: call("release"),
    rollback: call("rollback"),
    redeploy: call("redeploy"),
    addService: call("addService"),
    mergeChange: call("mergeChange"),
    closeChange: call("closeChange"),
  } satisfies HqWrites;
  return { writes, calls };
}

function operationsOf(store: AccountStore, answer: () => Promise<unknown>) {
  const { writes, calls } = hqOf(answer);
  const operations = makeOperations({
    store,
    executors: {
      hq: makeHqExecutor({
        apiOf: (orgId) => (orgId === ORG ? writes : null),
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("Unexpected token mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token deletion")),
        },
      }),
    },
    makeId: () => "r1",
  });
  return { operations, calls };
}

const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

const RELEASE = {
  kind: "release",
  orgId: ORG,
  appId: "shop",
  tag: "v1.0.1",
  groupHead: HEAD,
  entries: [{ service: "api", sha: SHA }],
} as const;
const ROLL_BACK = {
  kind: "roll-back",
  orgId: ORG,
  appId: "shop",
  tag: "v1.0.0",
  groupHead: HEAD,
} as const;
const REDEPLOY = {
  kind: "redeploy",
  orgId: ORG,
  appId: "shop",
  projectId: "stage",
  environment: "stage",
  service: "api",
  sha: SHA,
  after: "j1",
} as const;
const ADD_SERVICE = {
  kind: "add-service",
  orgId: ORG,
  appId: "shop",
  projectId: "stage",
  environment: "stage",
  service: "db",
} as const;
const MERGE = { kind: "merge-change", orgId: ORG, link: LINK, expectedHead: HEAD } as const;
const CLOSE = { kind: "close-change", orgId: ORG, link: LINK } as const;

describe("a flow's writes, executed by HQ", () => {
  it.effect.each([
    {
      name: "a release",
      intent: RELEASE,
      answer: { made: release("v1.0.1"), deploys: DEPLOYS },
      call: [
        "release",
        "shop",
        { tag: "v1.0.1", groupHead: HEAD, entries: [{ service: "api", sha: SHA }] },
      ],
      operationId: "v1.0.1",
      result: { tag: "v1.0.1", deploys: DEPLOYS },
      before: (store: AccountStore) => detail(store, "releases", [release("v1.0.0")]),
      after: (store: AccountStore) =>
        detail(store, "releases", [release("v1.0.1"), release("v1.0.0")]),
    },
    {
      name: "a roll back",
      intent: ROLL_BACK,
      answer: { made: release("v1.0.2", { rollbackOf: "v1.0.0" }), deploys: DEPLOYS },
      call: ["rollback", "shop", "v1.0.0", { groupHead: HEAD }],
      operationId: "v1.0.2",
      result: { tag: "v1.0.2", deploys: DEPLOYS },
      before: (store: AccountStore) => detail(store, "releases", [release("v1.0.0")]),
      after: (store: AccountStore) =>
        detail(store, "releases", [release("v1.0.2", { rollbackOf: "v1.0.0" }), release("v1.0.0")]),
    },
    {
      name: "a deploy asked again",
      intent: REDEPLOY,
      answer: DEPLOYS,
      call: ["redeploy", "shop", "stage", { service: "api", sha: SHA }],
      operationId: "stage/api",
      result: { deploys: DEPLOYS },
      before: (store: AccountStore) => stageJobs(store, [job("j1", { state: "failed" })]),
      after: (store: AccountStore) => stageJobs(store, [job("j2"), job("j1", { state: "failed" })]),
    },
    {
      name: "a merge",
      intent: MERGE,
      answer: { made: change("merged"), deploys: DEPLOYS },
      call: ["mergeChange", LINK, HEAD],
      operationId: "web#7",
      result: { deploys: DEPLOYS },
      before: (store: AccountStore) => detail(store, "changes", [change("open")]),
      after: (store: AccountStore) => detail(store, "changes", [change("merged")]),
    },
    {
      name: "a close",
      intent: CLOSE,
      answer: change("closed"),
      call: ["closeChange", LINK],
      operationId: "web#7",
      result: undefined,
      before: (store: AccountStore) => detail(store, "changes", [change("open")]),
      after: (store: AccountStore) => detail(store, "changes", [change("closed")]),
    },
  ])(
    "$name is accepted with HQ's answer, and ends once HQ's records show it",
    ({ intent, answer, call, operationId, result, before, after }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        before(store);
        const { operations, calls } = operationsOf(store, async () => answer);
        yield* operations.submit(intent as OperationIntent);
        expect(calls).toEqual([call]);
        expect(progress(store)).toEqual({ stage: "accepted", operationId });
        expect(operationResult(store.state().operations.get("r1"), intent.kind as never)).toEqual(
          result,
        );
        after(store);
        expect(progress(store)).toEqual({ stage: "done", operationId, outcome: "succeeded" });
      }),
  );

  it.effect("adds a service, done with HQ's answer", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations, calls } = operationsOf(store, async () => DEPLOYS);
      yield* operations.submit(ADD_SERVICE);
      expect(calls).toEqual([["addService", "shop", "stage", "db"]]);
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: "stage/db",
        outcome: "succeeded",
      });
      expect(operationResult(store.state().operations.get("r1"), "add-service")).toEqual({
        deploys: DEPLOYS,
      });
    }),
  );

  it.effect("a release HQ records refused ends failed, in HQ's words", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const made = release("v1.0.1", { state: "refused", reason: "Production is busy." });
      const { operations } = operationsOf(store, async () => ({ made, deploys: undefined }));
      yield* operations.submit(RELEASE);
      detail(store, "releases", [made]);
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: "v1.0.1",
        outcome: "failed",
        reason: "Production is busy.",
      });
    }),
  );

  it.effect.each([
    {
      name: "HQ refuses it",
      cause: new HqError({
        kind: "refused",
        code: "conflict",
        reason: "tag_taken",
        status: 409,
        message: "That name is taken.",
      }),
      expected: { stage: "refused", reason: "That name is taken." },
    },
    {
      name: "HQ cannot be reached",
      cause: new HqError({ kind: "unavailable", code: "network", message: "HQ is down." }),
      expected: { stage: "unsent", next: "send-again", reason: "HQ is down." },
    },
  ])("is not taken when $name", ({ cause, expected }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations } = operationsOf(store, () => Promise.reject(cause));
      yield* operations.submit(RELEASE);
      expect(progress(store)).toEqual(expected);
    }),
  );

  it.effect("is refused without an HQ to send it to, and nothing is sent", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const { operations, calls } = operationsOf(store, async () => DEPLOYS);
      yield* operations.submit({ ...MERGE, orgId: "elsewhere" });
      expect(calls).toEqual([]);
      expect(progress(store)).toEqual({
        stage: "refused",
        reason: "This organization's HQ is not open here.",
      });
    }),
  );

  it.effect.each([
    {
      name: "a release, by the name it asked for",
      intent: RELEASE,
      before: [release("v1.0.0")],
      stranger: [release("v1.0.0"), release("v1.0.9")],
      shown: [release("v1.0.1"), release("v1.0.0")],
      operationId: "v1.0.1",
    },
    {
      name: "a roll back, by the earlier release it lists",
      intent: ROLL_BACK,
      before: [release("v1.0.1", { rollbackOf: "v0.9.0" }), release("v1.0.0")],
      stranger: [release("v1.0.2"), release("v1.0.1", { rollbackOf: "v0.9.0" })],
      shown: [release("v1.0.3", { rollbackOf: "v1.0.0" }), release("v1.0.2")],
      operationId: "v1.0.3",
    },
  ])("after a lost answer adopts $name, never sending again", (row) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      detail(store, "releases", row.before);
      const lost = new HqError({ kind: "uncertain", code: "network", message: "No answer." });
      const { operations, calls } = operationsOf(store, () => Promise.reject(lost));
      yield* operations.submit(row.intent);
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      detail(store, "releases", row.stranger);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({ stage: "uncertain", next: "ask-owner-again" });
      detail(store, "releases", row.shown);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: row.operationId,
        outcome: "succeeded",
      });
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("after a lost answer adopts a merge HQ shows landed", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      detail(store, "changes", [change("open")]);
      const lost = new HqError({ kind: "uncertain", code: "network", message: "No answer." });
      const { operations, calls } = operationsOf(store, () => Promise.reject(lost));
      yield* operations.submit(MERGE);
      detail(store, "changes", [change("merged")]);
      yield* operations.retry("r1");
      expect(progress(store)).toEqual({
        stage: "done",
        operationId: "web#7",
        outcome: "succeeded",
      });
      expect(calls).toHaveLength(1);
    }),
  );

  it.each([
    { intent: RELEASE, demand: { family: "hqAppDetail", ownerId: "shop" } },
    { intent: MERGE, demand: { family: "hqAppDetail", ownerId: "shop" } },
    { intent: REDEPLOY, demand: null },
  ])("holds where $intent.kind's end shows while it runs", async ({ intent, demand }) => {
    const { FLOW_WRITE_KINDS } = await import("./flowWrites.ts");
    const kind = FLOW_WRITE_KINDS.find((entry) => entry.kind === intent.kind);
    const receipt = {
      requestId: "r1",
      operationId: "x",
      executor: "hq",
      affected: [],
      handles: ["x"],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    } as const;
    expect(kind?.observedIn?.(intent as never, receipt) ?? null).toEqual(demand);
  });
});
