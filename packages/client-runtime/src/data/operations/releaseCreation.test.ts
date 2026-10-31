import { HqError } from "../../zerops/hq/client.ts";
import { classifyHqCall } from "../adapters/hqWire.ts";
import { expect, it } from "@effect/vitest";
import { HqReleaseTarget, type ReleaseServicePlan } from "@t3tools/shared/hqRelease";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";

import { makeHqPictureReads } from "../adapters/hqPictures.ts";
import {
  releaseReviewOwner,
  releaseReviewScope,
  type ReleaseReviewRequest,
} from "../families/hqReleaseReview.ts";
import { hqReleaseReview } from "../projections/hqReleaseReview.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import type { ScopeKey } from "../model.ts";
import { releaseRequestOf } from "./flowWrites.ts";

const HEAD = "1".repeat(40);
const COMMIT = "2".repeat(40);
const HASH = "a".repeat(64);
const TARGET = Schema.decodeUnknownSync(HqReleaseTarget)({
  environmentId: "prod",
  createdAt: "2026-10-31T00:00:00Z",
  declaration: "9007199254740993",
  target: { kind: "zerops", projectId: "prod" },
});
const PLAN: ReleaseServicePlan = {
  hash: HASH,
  operations: [
    {
      kind: "create",
      service: "database",
      settings: { hostname: "database", type: "postgresql@17", minContainers: 1 },
      cost: "Creates one additional billed production service: database.",
    },
    {
      kind: "create",
      service: "worker",
      settings: { hostname: "worker", type: "nodejs@22", minContainers: 2 },
      cost: "Creates one additional billed production service: worker.",
    },
    { kind: "deploy", service: "worker", sha: COMMIT },
  ],
};
const REQUEST: ReleaseReviewRequest = {
  appId: "shop",
  request: {
    tag: "v1.0.2",
    groupHead: HEAD,
    target: "zerops",
    releaseTarget: TARGET,
    entries: [{ service: "worker", sha: COMMIT }],
  },
};
const offer = {
  releaseTarget: TARGET,
  gate: { allowed: false as const, reason: "Production has no service worker." },
  permission: { allowed: true as const },
  missingServices: ["database", "worker"],
  groupHead: HEAD,
  suggestion: "v1.0.1",
  entries: [{ service: "worker", commit: COMMIT }],
};
const until = (store: AccountStore, ready: () => boolean) =>
  Effect.callback<void>((resume) => {
    const check = () => {
      if (ready()) resume(Effect.void);
    };
    const stop = store.subscribe(check);
    check();
    return Effect.sync(stop);
  }).pipe(Effect.timeout("2 seconds"));

const review = Effect.gen(function* () {
  const registry = AtomRegistry.make();
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  const store = makeAccountStore(registry);
  const owner = releaseReviewOwner(REQUEST);
  const key = { orgId: "org", owner };
  const scope = releaseReviewScope(key.orgId, owner);
  const refresh = new Set<typeof scope>();
  const asked: ReleaseReviewRequest[] = [];
  const answers = [
    yield* Deferred.make<ReleaseServicePlan>(),
    yield* Deferred.make<ReleaseServicePlan>(),
  ];
  const started = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
  const finished = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
  let ended = 0;
  const signalAt = (key: ScopeKey, event: StreamEvent) =>
    Effect.map(Clock.currentTimeMillis, (now) =>
      store.dispatch({ kind: "stream", key, now, event }),
    );
  const signal = (event: StreamEvent) => signalAt(scope, event);
  const observe = yield* makeHqPictureReads({
    orgId: key.orgId,
    store,
    refresh,
    read: () => Effect.die("Unexpected picture read"),
    signal: signalAt,
    releaseReview: (input) =>
      Effect.suspend(() => {
        const index = asked.push(input) - 1;
        return Deferred.succeed(started[index]!, undefined).pipe(
          Effect.andThen(Deferred.await(answers[index]!)),
        );
      }),
    wake: () => {
      Deferred.doneUnsafe(finished[ended++]!, Effect.void);
    },
  });
  const read = () => hqReleaseReview.derive(readsOfState(store.state()), key);
  yield* signal({ kind: "demand", demanded: true });
  yield* observe([scope]);
  yield* Deferred.await(started[0]!);
  return {
    store,
    scope,
    owner,
    read,
    signal,
    signalAt,
    observe,
    refresh,
    asked,
    answers,
    started,
    finished,
  };
});

it.live(
  "Review names each service the release will create in production with its settings and the extra billed service before approval.",
  () =>
    Effect.gen(function* () {
      const live = yield* review;
      expect(live.read()).toEqual({ kind: "pending" });
      yield* Deferred.succeed(live.answers[0]!, PLAN);
      yield* until(live.store, () => live.read().kind === "ready");
      expect(live.asked).toEqual([
        {
          appId: "shop",
          request: {
            tag: "v1.0.2",
            groupHead: HEAD,
            target: "zerops",
            releaseTarget: TARGET,
            entries: [{ service: "worker", sha: COMMIT }],
          },
        },
      ]);
      expect(live.read()).toEqual({
        kind: "ready",
        plan: {
          hash: HASH,
          operations: [
            {
              kind: "create",
              service: "database",
              settings: { hostname: "database", type: "postgresql@17", minContainers: 1 },
              cost: "Creates one additional billed production service: database.",
            },
            {
              kind: "create",
              service: "worker",
              settings: { hostname: "worker", type: "nodejs@22", minContainers: 2 },
              cost: "Creates one additional billed production service: worker.",
            },
            { kind: "deploy", service: "worker", sha: COMMIT },
          ],
        },
      });
    }).pipe(Effect.scoped),
);

it.live(
  "Approve sends the plan hash the person reviewed; a changed plan refuses and the review reloads.",
  () =>
    Effect.gen(function* () {
      const live = yield* review;
      yield* Deferred.succeed(live.answers[0]!, PLAN);
      yield* until(live.store, () => live.read().kind === "ready");
      const approved = live.read();
      expect(approved.kind).toBe("ready");
      if (approved.kind !== "ready") return;
      expect(releaseRequestOf(offer, "v1.0.2", approved.plan)).toEqual({
        kind: "release",
        tag: "v1.0.2",
        groupHead: HEAD,
        entries: [{ service: "worker", sha: COMMIT }],
        planHash: HASH,
        releaseTarget: TARGET,
      });
      yield* Deferred.await(live.finished[0]!);
      yield* live.signal({
        kind: "fault",
        jitter: 0,
        fault: {
          outcome: "definitive-refusal",
          message: "Production plan changed; review it again.",
        },
      });
      expect(live.read()).toEqual({
        kind: "failed",
        reason: "Production plan changed; review it again.",
      });
      expect(releaseRequestOf(offer, "v1.0.2")).toHaveProperty("refused");
      live.refresh.add(live.scope);
      yield* live.signal({ kind: "manual-retry" });
      yield* live.observe([live.scope]);
      yield* Deferred.await(live.started[1]!);
      expect(live.read()).toEqual({ kind: "pending" });
      yield* Deferred.succeed(live.answers[1]!, { ...PLAN, hash: "b".repeat(64) });
      yield* until(live.store, () => live.read().kind === "ready");
      expect(live.asked).toHaveLength(2);
      const reloaded = live.read();
      expect(reloaded.kind).toBe("ready");
      if (reloaded.kind !== "ready") return;
      expect(releaseRequestOf(offer, "v1.0.2", reloaded.plan)).toHaveProperty(
        "planHash",
        "b".repeat(64),
      );
      expect(
        releaseRequestOf(
          {
            ...offer,
            permission: { allowed: false, reason: "You cannot release this application." },
          },
          "v1.0.2",
          reloaded.plan,
        ),
      ).toHaveProperty("refused");
    }).pipe(Effect.scoped),
);

it("A release that needs no creation reviews and approves exactly as today.", () => {
  const ready = { ...offer, gate: { allowed: true as const }, missingServices: [] };
  const expected = {
    kind: "release",
    tag: "v1.0.1",
    groupHead: HEAD,
    entries: [{ service: "worker", sha: COMMIT }],
  };
  expect(releaseRequestOf(ready)).toHaveProperty("refused");
  expect(releaseRequestOf(ready, undefined, PLAN)).toEqual({
    ...expected,
    planHash: HASH,
    releaseTarget: TARGET,
  });
  expect(
    releaseRequestOf(
      { ...ready, permission: { allowed: false, reason: "You cannot release." } },
      undefined,
      PLAN,
    ),
  ).toEqual({ refused: "You cannot release.", says: false });
});

it.live.each(["changed input", "released account", "superseded attempt"] as const)(
  "A delayed creation review cannot authorize approval after %s.",
  (ending) =>
    Effect.gen(function* () {
      const live = yield* review;
      let currentScope = live.scope;
      let currentOwner = live.owner;
      if (ending === "changed input") {
        yield* live.signal({ kind: "demand", demanded: false });
        currentOwner = releaseReviewOwner({
          ...REQUEST,
          request: { ...REQUEST.request, tag: "v1.0.3" },
        });
        currentScope = releaseReviewScope("org", currentOwner);
        yield* live.signalAt(currentScope, { kind: "demand", demanded: true });
        yield* live.observe([currentScope]);
      } else if (ending === "released account") {
        yield* live.signal({ kind: "demand", demanded: false });
        yield* live.observe([]);
      } else {
        yield* live.signal({ kind: "deadline" });
        yield* live.signal({ kind: "manual-retry" });
        yield* live.observe([live.scope]);
      }
      yield* Deferred.await(live.finished[0]!);
      yield* Deferred.succeed(live.answers[0]!, PLAN);
      const readCurrent = () =>
        hqReleaseReview.derive(readsOfState(live.store.state()), {
          orgId: "org",
          owner: currentOwner,
        });
      expect(readCurrent()).toEqual(
        ending === "superseded attempt"
          ? { kind: "failed", reason: "No answer came in time." }
          : { kind: "pending" },
      );
      expect(live.store.state().facts.size).toBe(0);
      if (ending === "released account") return;
      yield* Deferred.await(live.started[1]!);
      expect(live.asked[1]?.request.tag).toBe(ending === "changed input" ? "v1.0.3" : "v1.0.2");
      yield* Deferred.succeed(live.answers[1]!, { ...PLAN, hash: "b".repeat(64) });
      yield* until(live.store, () => readCurrent().kind === "ready");
      expect(readCurrent()).toEqual({ kind: "ready", plan: { ...PLAN, hash: "b".repeat(64) } });
    }).pipe(Effect.scoped),
);

it.live("Release review renders HQ's refusal findings without inventing a failed release.", () =>
  Effect.gen(function* () {
    const live = yield* review;
    const problems = [
      {
        code: "invalid_recipe",
        what: "Correct the production service declaration",
        where: { appId: "shop", service: "worker", tier: "production", file: "production.yaml" },
        rule: { source: "zerops-schema", schemaPath: "/services/0" },
        next: {
          actor: "mate",
          action: "Propose a corrected declaration, merge it and review the new head.",
        },
      },
    ] as const;
    yield* live.signal({
      kind: "fault",
      jitter: 0,
      fault: classifyHqCall(
        new HqError({ kind: "refused", code: "conflict", message: "Review refused", problems }),
      ),
    });
    expect(live.read()).toEqual({ kind: "failed", reason: "Review refused", problems });
  }).pipe(Effect.scoped),
);
