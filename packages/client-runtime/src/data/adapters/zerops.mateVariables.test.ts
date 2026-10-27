import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";

import { fixtureWire, settle } from "../__fixtures__/zeropsWire.ts";
import { mateVariablesScope } from "../families/mateVariables.ts";
import { linkKeys } from "../model.ts";
import { mateVariables } from "../projections/mateVariables.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { STREAM_POLICY, type StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { zeropsNavigationLink } from "./zerops.ts";

const ORG = "org";
const SERVICE = "zcp";
const DEMAND = { family: "mateVariables", ownerId: SERVICE } as const;
const SCOPE = mateVariablesScope(ORG, SERVICE);
const PRESENT = {
  items: [{ key: "ZCP_MATE_ENABLED", content: "1" }],
};

const setup = Effect.fnUntraced(function* () {
  const store = makeAccountStore(AtomRegistry.make());
  const answer: { body: unknown; fault?: StreamFault } = { body: PRESENT };
  const fixture = fixtureWire((request) =>
    request.path === "/user-data/search"
      ? answer.fault === undefined
        ? Effect.succeed(answer.body)
        : Effect.fail(answer.fault)
      : Effect.succeed({ items: [] }),
  );
  let id = 0;
  const link = zeropsNavigationLink({
    orgId: ORG,
    wire: fixture.wire,
    store,
    makeId: () => `registration-${++id}`,
  });
  const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
  const fiber = yield* Effect.forkChild(supervisor.run);
  yield* settle;
  const reads = () => fixture.requests.filter(({ path }) => path === "/user-data/search");
  const projection = () =>
    mateVariables.derive(readsOfState(store.state()), { orgId: ORG, serviceId: SERVICE });
  return { store, answer, fixture, link, fiber, reads, projection };
});

describe("Mate variables through the sampled Zerops adapter", () => {
  it.effect("navigation reads none; holders share a sample and our write refreshes it", () =>
    Effect.gen(function* () {
      const { link, fiber, reads, projection, answer } = yield* setup();
      expect(reads()).toHaveLength(0);
      const release = link.demandDetail(DEMAND);
      const releaseSecond = link.demandDetail(DEMAND);
      yield* settle;
      expect(reads()).toHaveLength(1);
      expect(reads()[0]?.body?.search).toEqual([
        { name: "clientId", operator: "eq", value: ORG },
        { name: "serviceStackId", operator: "eq", value: SERVICE },
        { name: "key", operator: "in", value: ["ZCP_MATE_ENABLED"] },
      ]);
      expect(projection()).toEqual({ flag: true });
      answer.body = { items: [{ key: "ZCP_MATE_ENABLED", content: "0" }] };
      link.revalidate(DEMAND);
      yield* settle;
      expect(reads()).toHaveLength(2);
      expect(projection()).toEqual({ flag: false });
      release();
      releaseSecond();
      yield* settle;
      yield* TestClock.adjust(STREAM_POLICY.sampledIntervalMs * 3);
      yield* settle;
      expect(reads()).toHaveLength(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each([
    { name: "damaged", body: { items: [{ key: "ZCP_MATE_ENABLED", content: 123 }] } },
    { name: "partial", body: { items: [{ key: "ZCP_MATE_ENABLED", content: "0" }], totalHits: 2 } },
    { name: "transient", fault: { outcome: "transient", message: "HTTP 503" } as StreamFault },
  ])("a $name answer keeps the last complete sample and affects only this scope", (failure) =>
    Effect.gen(function* () {
      const { store, link, fiber, projection, answer } = yield* setup();
      link.demandDetail(DEMAND);
      yield* settle;
      Object.assign(answer, failure);
      link.revalidate(DEMAND);
      yield* settle;
      expect(projection()).toEqual({ flag: true });
      expect(store.state().streams.get(SCOPE)?.phase).toBe("recovering");
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a definitive refusal survives remount, time and revalidation", () =>
    Effect.gen(function* () {
      const { store, link, fiber, reads, answer } = yield* setup();
      answer.fault = { outcome: "definitive-refusal", message: "not supported" };
      const release = link.demandDetail(DEMAND);
      yield* settle;
      expect(store.state().streams.get(SCOPE)?.phase).toBe("refused");
      delete answer.fault;
      release();
      link.demandDetail(DEMAND);
      link.revalidate(DEMAND);
      yield* TestClock.adjust(STREAM_POLICY.sampledIntervalMs * 3);
      yield* settle;
      expect(reads()).toHaveLength(1);
      link.retryDetail(DEMAND);
      yield* settle;
      expect(reads()).toHaveLength(2);
      expect(store.state().streams.get(SCOPE)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a socket outage retains the sample; sampling resumes after reconnect", () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber, reads, projection, answer } = yield* setup();
      link.demandDetail(DEMAND);
      yield* settle;
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      expect(projection()).toEqual({ flag: true });
      answer.body = { items: [{ key: "ZCP_MATE_ENABLED", content: "0" }] };
      const down = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(down?.next.kind === "retry" ? down.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(projection()).toEqual({ flag: true });
      yield* TestClock.adjust(STREAM_POLICY.sampledIntervalMs);
      yield* settle;
      expect(reads()).toHaveLength(2);
      expect(projection()).toEqual({ flag: false });
      yield* Fiber.interrupt(fiber);
    }),
  );
});
