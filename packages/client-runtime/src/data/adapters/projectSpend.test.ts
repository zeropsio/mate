import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyHttp, zeropsNavigationLink } from "./zerops.ts";
import { detailScopeOf } from "../demand.ts";
import { SPEND_FRESH_MS } from "../families/projectSpend.ts";
import { computeSpend } from "../projections/projectSpend.ts";

const ORG = "acme";
const PATH = "/transaction-debit/group-by-search";
const DEMAND = { family: "projectSpend", ownerId: ORG } as const;
const ANSWER = {
  items: [
    {
      projectId: "tea-prod",
      projectName: "Tea Shop",
      from: "2026-10-18T00:00:00+02:00",
      till: "2026-10-18T23:59:59+02:00",
      sumTotalPrice: 1.25,
    },
  ],
  totalHits: 1,
  from: "2026-09-19T00:00:00+02:00",
  till: "2026-10-18T19:00:00+02:00",
};

/** Answers every navigation registration empty, and the spend search as `spend` says. */
const answers =
  (spend: () => Effect.Effect<unknown, StreamFault>) =>
  (request: WireRequest): Effect.Effect<unknown, StreamFault> =>
    request.path === PATH
      ? spend()
      : Effect.succeed(
          request.body?.wsOutputType === "updateStream" ? { success: true } : { items: [] },
        );

const run = (fixture: ReturnType<typeof fixtureWire>) =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    let next = 0;
    const link = zeropsNavigationLink({
      orgId: ORG,
      wire: fixture.wire,
      store,
      makeId: () => `sub-${String((next += 1))}`,
    });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    const spendOf = (projectIds: ReadonlyArray<string>) =>
      computeSpend.derive(readsOfState(store.state()), { orgId: ORG, projectIds });
    return { fiber, link, spendOf, store };
  });
const reads = (fixture: ReturnType<typeof fixtureWire>) =>
  fixture.requests.filter((request) => request.method === "POST" && request.path === PATH);

describe("the organization's spend read", () => {
  it.effect("asks billing once for every project's daily cost, by its client", () =>
    Effect.gen(function* () {
      const fixture = fixtureWire(answers(() => Effect.succeed(ANSWER)));
      const { fiber, link, spendOf } = yield* run(fixture);
      link.demandDetail(DEMAND);
      link.demandDetail(DEMAND);
      yield* settle;
      expect(reads(fixture)).toHaveLength(1);
      expect(reads(fixture)[0]?.body).toMatchObject({
        search: [{ name: "clientId", operator: "eq", value: ORG }],
        groupBy: "projectId",
        timeGroupBy: "1d",
      });
      expect(spendOf(["tea-prod"])).toMatchObject({ kind: "read" });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a refusal holds no figure: unknown, never zero", () =>
    Effect.gen(function* () {
      const fixture = fixtureWire(answers(() => Effect.fail(classifyHttp(400))));
      const { fiber, link, spendOf } = yield* run(fixture);
      link.demandDetail(DEMAND);
      yield* settle;
      expect(spendOf(["tea-prod"])).toEqual({ kind: "unknown" });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("is read again at most once an hour, and when a page opens after an hour", () =>
    Effect.gen(function* () {
      const fixture = fixtureWire(answers(() => Effect.succeed(ANSWER)));
      const { fiber, link } = yield* run(fixture);
      const release = link.demandDetail(DEMAND);
      yield* settle;
      yield* TestClock.adjust(SPEND_FRESH_MS / 2);
      yield* settle;
      expect(reads(fixture)).toHaveLength(1);
      release();
      yield* settle;
      const again = link.demandDetail(DEMAND);
      yield* settle;
      expect(reads(fixture)).toHaveLength(1);
      again();
      yield* settle;
      yield* TestClock.adjust(SPEND_FRESH_MS);
      link.demandDetail(DEMAND);
      yield* settle;
      expect(reads(fixture)).toHaveLength(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "A sampled scope re-reads at its family's freshness; spend wakes hourly, not every 30 s",
    () =>
      Effect.gen(function* () {
        const fixture = fixtureWire(answers(() => Effect.succeed(ANSWER)));
        const { fiber, link, store } = yield* run(fixture);
        const scope = detailScopeOf(ORG, DEMAND);
        const release = link.demandDetail(DEMAND);
        yield* settle;
        const readAt = yield* Clock.currentTimeMillis;
        const due = { kind: "revalidate", at: readAt + SPEND_FRESH_MS };
        expect(store.state().streams.get(scope)?.next).toEqual(due);
        // A new demand the held read answers keeps the instant that read set.
        yield* TestClock.adjust(SPEND_FRESH_MS / 2);
        release();
        yield* settle;
        link.demandDetail(DEMAND);
        yield* settle;
        expect(store.state().streams.get(scope)?.next).toEqual(due);
        const generation = store.state().streams.get(scope)?.generation;
        yield* TestClock.adjust(SPEND_FRESH_MS / 2 - 1);
        yield* settle;
        expect(store.state().streams.get(scope)?.generation).toBe(generation);
        expect(reads(fixture)).toHaveLength(1);
        yield* TestClock.adjust(1);
        yield* settle;
        expect(reads(fixture)).toHaveLength(2);
        expect(store.state().streams.get(scope)?.next).toEqual({
          kind: "revalidate",
          at: readAt + 2 * SPEND_FRESH_MS,
        });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("a screen held open past the hour reads it once more", () =>
    Effect.gen(function* () {
      const fixture = fixtureWire(answers(() => Effect.succeed(ANSWER)));
      const { fiber, link } = yield* run(fixture);
      link.demandDetail(DEMAND);
      yield* settle;
      for (let minute = 0; minute < 61; minute += 1) {
        yield* TestClock.adjust(60_000);
        yield* settle;
      }
      expect(reads(fixture)).toHaveLength(2);
      yield* Fiber.interrupt(fiber);
    }),
  );
});
