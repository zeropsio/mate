import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import { fixtureWire, settle, type WireRequest } from "../__fixtures__/zeropsWire.ts";
import {
  ORGANIZATION_ID as ORG,
  PROBE_PROJECT_ID,
  RECORDED_PROCESS_TRAFFIC,
} from "../__fixtures__/zeropsOrg.ts";
import { scopeKeys } from "../model.ts";
import { makeAccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { zeropsNavigationLink } from "./zerops.ts";

const PROCESS_SEARCH = "/process/search";
const PROJECT_SEARCH = "/project/search";

const recorded = (index: number) => {
  const event = RECORDED_PROCESS_TRAFFIC[index];
  if (event === undefined) throw new Error(`No recorded event ${index}.`);
  return event;
};

/** Every recorded process row, by id, as its first observation holds it: what a read finds. */
const firstRows = new Map(
  RECORDED_PROCESS_TRAFFIC.flatMap((event) =>
    "frame" in event && event.frame === "updates"
      ? event.data.update.map((row) => [String(row.id), row] as const)
      : [],
  ).toReversed(),
);

const searched = (request: WireRequest) =>
  (request.body?.search as ReadonlyArray<{ readonly name: string; readonly value: unknown }>) ?? [];

/** Answers registrations with these baselines, and reads by id from the recorded rows. */
function answers(baselines: {
  readonly projects: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly running: () => ReadonlyArray<Readonly<Record<string, unknown>>>;
}) {
  return (request: WireRequest): Effect.Effect<unknown, StreamFault> => {
    const output = request.body?.wsOutputType;
    if (output === "updateStream") return Effect.succeed({ success: true });
    if (output === "listStream")
      return Effect.succeed({
        items: request.path === PROJECT_SEARCH ? baselines.projects : baselines.running(),
      });
    const ids = searched(request).find((term) => term.name === "id")
      ?.value as ReadonlyArray<string>;
    return Effect.succeed({ items: ids.flatMap((id) => firstRows.get(id) ?? []) });
  };
}

const PROBE_PROJECT = {
  id: PROBE_PROJECT_ID,
  name: "mate-rig-live",
  status: "ACTIVE",
  _version: 1,
};

describe("zeropsNavigationLink", () => {
  it.effect("replays the recorded running work: lit before membership, cleared by its end", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers({ projects: [PROBE_PROJECT], running: () => [] }));
      const fiber = yield* run(store, fixture);
      const running = () => store.state().running.get(PROBE_PROJECT_ID) ?? new Set();
      const replay = (from: number, to: number) =>
        Effect.gen(function* () {
          for (let index = from; index <= to; index += 1) {
            const event = recorded(index);
            if (!("frame" in event)) continue;
            yield* fixture.push(
              fixture.subscription(
                PROCESS_SEARCH,
                event.frame === "membership" ? "listStream" : "updateStream",
              ),
              event.data,
            );
            yield* settle;
          }
        });

      expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("live");

      // Rows of the new project's three processes come 140 ms before their membership.
      yield* replay(1, 1);
      expect(running().size).toBe(3);
      yield* replay(2, 3);
      expect(running().size).toBe(3);

      // Create and the service finish; the deploy runs on, then leaves and finishes.
      yield* replay(4, 10);
      expect([...running()]).toEqual(["K1bQIB8AQBeQGHaAe8mneg"]);
      yield* replay(11, 13);
      expect(running().size).toBe(0);

      // The delete's membership comes before its row: the row is read by id.
      yield* replay(14, 15);
      expect(fixture.requests.at(-1)).toMatchObject({ method: "POST", path: PROCESS_SEARCH });
      expect(running()).toEqual(new Set(["OOlnYMslSg6Hjbgt9ZKlFQ"]));
      yield* replay(16, 18);
      expect(running().size).toBe(0);
      expect(store.state().process.get("OOlnYMslSg6Hjbgt9ZKlFQ")?.content).toMatchObject({
        value: { status: "FINISHED" },
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("commits a baseline answered after frames that raced it, then replays them", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const answered = yield* Deferred.make<void>();
      const baselines = answers({
        projects: [PROBE_PROJECT],
        running: () => itemsOf(recorded(2)),
      });
      const fixture = fixtureWire((request) =>
        request.path === PROCESS_SEARCH && request.body?.wsOutputType === "listStream"
          ? Effect.andThen(Deferred.await(answered), baselines(request))
          : baselines(request),
      );
      const fiber = yield* run(store, fixture);
      expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("baselining");

      // The rows (older than the answer's) and the membership both arrive before the answer.
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), frameOf(1));
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "listStream"), {
        add: [],
        delete: ["8OBjlA8pQbuaDGH7nYvggg"],
      });
      yield* settle;
      expect(store.state().memberships.get(scopeKeys.running(ORG))?.coverage).toBe("unknown");

      yield* Deferred.succeed(answered, undefined);
      yield* settle;
      const membership = store.state().memberships.get(scopeKeys.running(ORG));
      expect(membership?.coverage).toBe("complete");
      expect(membership?.members.get("8OBjlA8pQbuaDGH7nYvggg")).toBe("removed");
      expect(store.state().running.get(PROBE_PROJECT_ID)?.size).toBe(2);
      expect(store.state().process.get("J3TU3gE0SvCFrPDutSacqw")).toMatchObject({
        revision: { version: 2 },
        method: "baseline",
      });
      expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("never lights a process that starts and finishes inside one frame", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers({ projects: [PROBE_PROJECT], running: () => [] }));
      const fiber = yield* run(store, fixture);
      const quick = { id: "quick", projectId: PROBE_PROJECT_ID, actionName: "stack.restart" };
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), {
        update: [
          { ...quick, status: "RUNNING", _version: 1 },
          { ...quick, status: "FINISHED", _version: 2 },
        ],
      });
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "listStream"), {
        add: ["quick"],
        delete: ["quick"],
      });
      yield* settle;
      expect(store.state().running.get(PROBE_PROJECT_ID) ?? new Set()).toEqual(new Set());
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("re-registers after an outage and takes the answer as truth, inventing no ends", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let outage = false;
      const projects = (ids: ReadonlyArray<string>) =>
        ids.map((id) => ({ id, name: id, status: "ACTIVE", _version: 1 }));
      const baselines = (request: WireRequest) =>
        answers({
          projects: outage ? projects(["kept"]) : projects(["kept", "deleted", "denied"]),
          running: () => (outage ? itemsOf(recorded(14)) : []),
        })(request);
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: request.path.endsWith("/deleted") ? 404 : 403, body: null })
          : baselines(request),
      );
      const fiber = yield* run(store, fixture);
      // The deploy runs when the socket breaks; it finishes while the client is away.
      for (const index of [1, 3, 10])
        yield* fixture.push(
          fixture.subscription(PROCESS_SEARCH, index === 3 ? "listStream" : "updateStream"),
          frameOf(index),
        );
      yield* settle;
      expect([...(store.state().running.get(PROBE_PROJECT_ID) ?? [])]).toEqual([
        "K1bQIB8AQBeQGHaAe8mneg",
      ]);

      outage = true;
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const link = store.state().streams.get(scopeKeys.zeropsLink(ORG));
      expect(link?.phase).toBe("recovering");
      expect(store.state().streams.get(scopeKeys.projects(ORG))?.phase).toBe("stale");
      expect(store.state().project.get("deleted")?.content.kind).toBe("value");
      expect(store.state().running.get(PROBE_PROJECT_ID)?.size).toBe(1);

      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(
        fixture.requests.filter((request) => request.body?.receiverId === "receiver-2"),
      ).toHaveLength(4);
      expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("live");
      expect(store.state().running.get(PROBE_PROJECT_ID)?.size).toBe(0);
      expect(store.state().process.get("K1bQIB8AQBeQGHaAe8mneg")?.content).toMatchObject({
        value: { status: "RUNNING" },
      });
      expect(store.state().project.get("kept")?.content.kind).toBe("value");
      expect(store.state().project.get("deleted")?.content).toEqual({
        kind: "deleted",
        evidence: "GET /project/deleted answered 404",
      });
      expect(store.state().project.get("denied")).toMatchObject({
        content: { kind: "purged" },
        access: "denied",
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("keeps a member whose baseline row is damaged, with the value it had", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let reconnected = false;
      const deploy = { id: "deploy", projectId: PROBE_PROJECT_ID, actionName: "stack.deploy" };
      const fixture = fixtureWire(
        answers({
          projects: [PROBE_PROJECT],
          running: () =>
            reconnected
              ? [{ id: "deploy", projectId: PROBE_PROJECT_ID, status: 42 }]
              : [{ ...deploy, status: "RUNNING", _version: 1 }],
        }),
      );
      const fiber = yield* run(store, fixture);
      expect(store.state().running.get(PROBE_PROJECT_ID)).toEqual(new Set(["deploy"]));

      reconnected = true;
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const link = store.state().streams.get(scopeKeys.zeropsLink(ORG));
      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(store.state().streams.get(scopeKeys.running(ORG))?.phase).toBe("live");
      expect(store.state().memberships.get(scopeKeys.running(ORG))?.members.get("deploy")).toBe(
        "member",
      );
      expect(store.state().running.get(PROBE_PROJECT_ID)).toEqual(new Set(["deploy"]));
      yield* Fiber.interrupt(fiber);
    }),
  );
});

const itemsOf = (event: ReturnType<typeof recorded>) => ("items" in event ? event.items : []);
const frameOf = (index: number) => {
  const event = recorded(index);
  if (!("frame" in event)) throw new Error(`Recorded event ${index} is no frame.`);
  return event.data;
};

const run = (store: ReturnType<typeof makeAccountStore>, fixture: ReturnType<typeof fixtureWire>) =>
  Effect.gen(function* () {
    const link = zeropsNavigationLink({ orgId: ORG, wire: fixture.wire, store, makeId: counter() });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return fiber;
  });

function counter() {
  let next = 0;
  return () => `sub-${(next += 1)}`;
}
