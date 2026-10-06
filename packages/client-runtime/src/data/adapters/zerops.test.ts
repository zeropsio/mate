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
import { makeAccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyHttp, zeropsNavigationLink } from "./zerops.ts";
import { historyScope, runningScope } from "../families/process.ts";
import { projectsScope } from "../families/project.ts";
import { activeScope, versionScope } from "../families/version.ts";
import { factOf, indexOf } from "../reducer.ts";
import { linkKeys } from "../model.ts";
import { detailScopeOf } from "../demand.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { projectRoutingsScope, routingsScope } from "../families/publicRouting.ts";
import { STREAM_POLICY } from "../streamMachine.ts";

import {
  RECORDED_ROUTING,
  RECORDED_SERVICE,
  REMOVED_ROUTING,
  ROUTING_PROJECT,
} from "../__fixtures__/publicRouting.ts";

const PROCESS_SEARCH = "/process/search";
const PROJECT_SEARCH = "/project/search";

const PROBE_PROJECT = {
  id: PROBE_PROJECT_ID,
  name: "mate-rig-live",
  status: "ACTIVE",
  _version: 1,
};

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
function answers(
  running: () => ReadonlyArray<Readonly<Record<string, unknown>>>,
  projects: () => ReadonlyArray<Readonly<Record<string, unknown>>> = () => [PROBE_PROJECT],
) {
  return (request: WireRequest): Effect.Effect<unknown, StreamFault> => {
    const output = request.body?.wsOutputType;
    if (output === "updateStream") return Effect.succeed({ success: true });
    if (output === "listStream")
      return Effect.succeed({
        items:
          request.path === PROJECT_SEARCH
            ? projects()
            : request.path === PROCESS_SEARCH
              ? running()
              : [],
      });
    const ids = searched(request).find((term) => term.name === "id")
      ?.value as ReadonlyArray<string>;
    return Effect.succeed({ items: ids.flatMap((id) => firstRows.get(id) ?? []) });
  };
}

describe("zeropsNavigationLink", () => {
  it.effect("replays the recorded running work: lit before membership, cleared by its end", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers(() => []));
      const fiber = yield* run(store, fixture);
      const running = () => indexOf(store.state(), "running", PROBE_PROJECT_ID) ?? new Set();
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

      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");

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
      expect(factOf(store.state(), "process", "OOlnYMslSg6Hjbgt9ZKlFQ")?.content).toMatchObject({
        value: { status: "FINISHED" },
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("commits a baseline answered after frames that raced it, then replays them", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const answered = yield* Deferred.make<void>();
      const baselines = answers(() => itemsOf(recorded(2)));
      const fixture = fixtureWire((request) =>
        request.path === PROCESS_SEARCH && request.body?.wsOutputType === "listStream"
          ? Effect.andThen(Deferred.await(answered), baselines(request))
          : baselines(request),
      );
      const fiber = yield* run(store, fixture);
      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("baselining");

      // The rows (older than the answer's) and the membership both arrive before the answer.
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), frameOf(1));
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "listStream"), {
        add: [],
        delete: ["8OBjlA8pQbuaDGH7nYvggg"],
      });
      yield* settle;
      expect(store.state().memberships.get(runningScope(ORG))?.coverage).toBe("unknown");

      yield* Deferred.succeed(answered, undefined);
      yield* settle;
      const membership = store.state().memberships.get(runningScope(ORG));
      expect(membership?.coverage).toBe("complete");
      expect(membership?.members.get("8OBjlA8pQbuaDGH7nYvggg")).toBe("removed");
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID)?.size).toBe(2);
      expect(factOf(store.state(), "process", "J3TU3gE0SvCFrPDutSacqw")).toMatchObject({
        revision: { version: 2 },
        method: "baseline",
      });
      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("never lights a process that starts and finishes inside one frame", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers(() => []));
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
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID) ?? new Set()).toEqual(new Set());
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("re-registers after an outage and takes the answer as truth, inventing no ends", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let outage = false;
      const projects = (ids: ReadonlyArray<string>) =>
        ids.map((id) => ({ id, name: id, status: "ACTIVE", _version: 1 }));
      const baselines = answers(
        () => (outage ? itemsOf(recorded(14)) : []),
        () => (outage ? projects(["kept"]) : projects(["kept", "deleted", "denied"])),
      );
      // As measured: a deleted project's read answers `400 projectNotFound`, which the wire
      // reports as not found; a project taken from the viewer answers 403.
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
      expect([...(indexOf(store.state(), "running", PROBE_PROJECT_ID) ?? [])]).toEqual([
        "K1bQIB8AQBeQGHaAe8mneg",
      ]);

      outage = true;
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const link = store.state().streams.get(linkKeys.zerops(ORG));
      expect(link?.phase).toBe("recovering");
      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("stale");
      expect(store.state().streams.get(projectsScope(ORG))?.phase).toBe("stale");
      expect(factOf(store.state(), "project", "deleted")?.content.kind).toBe("value");
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID)?.size).toBe(1);

      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(
        fixture.requests.filter((request) => request.body?.receiverId === "receiver-2"),
      ).toHaveLength(10);
      // One project was taken from the viewer meanwhile: every scope is registered once more.
      const again = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(again?.next.kind === "retry" ? again.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(3);
      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID)?.size).toBe(0);
      expect(factOf(store.state(), "process", "K1bQIB8AQBeQGHaAe8mneg")?.content).toMatchObject({
        value: { status: "RUNNING" },
      });
      expect(factOf(store.state(), "project", "kept")?.content.kind).toBe("value");
      expect(factOf(store.state(), "project", "deleted")?.content).toEqual({
        kind: "deleted",
        evidence: "GET /project/deleted answered 404",
      });
      expect(factOf(store.state(), "project", "denied")).toMatchObject({
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
      const deploy = {
        id: "deploy",
        projectId: PROBE_PROJECT_ID,
        actionName: "stack.deploy",
        created: "2026-10-05T18:49:08Z",
      };
      const fixture = fixtureWire(
        answers(() =>
          reconnected
            ? [{ id: "deploy", projectId: PROBE_PROJECT_ID, status: 42 }]
            : [{ ...deploy, status: "RUNNING", _version: 1 }],
        ),
      );
      const fiber = yield* run(store, fixture);
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID)).toEqual(new Set(["deploy"]));

      reconnected = true;
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const link = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");
      expect(store.state().memberships.get(runningScope(ORG))?.members.get("deploy")).toBe(
        "member",
      );
      expect(indexOf(store.state(), "running", PROBE_PROJECT_ID)).toEqual(new Set(["deploy"]));
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("fences out frames of a registration its scope has since replaced", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(answers(() => []));
      const fiber = yield* run(store, fixture);
      const running = runningScope(ORG);
      // Another attempt takes the scope over; this receiver's registration is now superseded.
      for (const event of [{ kind: "parent-lost" }, { kind: "attempt" }] as const)
        store.dispatch({ kind: "stream", key: running, now: 0, event });

      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), frameOf(1));
      yield* settle;
      expect(factOf(store.state(), "process", "J3TU3gE0SvCFrPDutSacqw")).toBeUndefined();
      yield* Fiber.interrupt(fiber);
    }),
  );
  it.effect(
    "registers every scope again once the viewer's access changed, taking its answer as truth",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let listed = ["kept", "taken"];
        const fixture = fixtureWire((request) =>
          request.method === "GET"
            ? Effect.succeed({ status: 403, body: null })
            : answers(
                () => [],
                () => listed.map((id) => ({ id, name: id, status: "ACTIVE", _version: 1 })),
              )(request),
        );
        const fiber = yield* run(store, fixture);
        // A project taken from the viewer leaves only its own roster; the other scopes say nothing.
        listed = ["kept"];
        yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
          add: [],
          delete: ["taken"],
        });
        yield* settle;
        expect(factOf(store.state(), "project", "taken")?.content.kind).toBe("purged");
        const link = store.state().streams.get(linkKeys.zerops(ORG));
        expect(link?.phase).toBe("recovering");
        yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
        yield* settle;
        expect(fixture.opens()).toBe(2);
        expect(store.state().streams.get(projectsScope(ORG))?.phase).toBe("live");
        expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "lets a project that moved to another organization leave this one's roster, claiming nothing",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const row = (id: string) => ({ id, name: id, status: "ACTIVE", _version: 1 });
        const fixture = fixtureWire((request) =>
          request.method === "GET"
            ? Effect.succeed({
                status: 200,
                body: {
                  ...row(request.path.split("/").at(-1)!),
                  clientId: request.path.endsWith("/moved") ? "other-org" : ORG,
                },
              })
            : answers(
                () => [],
                () => ["kept", "moved", "lagging"].map(row),
              )(request),
        );
        const fiber = yield* run(store, fixture);
        yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
          add: [],
          delete: ["moved", "lagging"],
        });
        yield* settle;
        const members = store.state().memberships.get(projectsScope(ORG))?.members;
        // It exists, in another organization: it leaves this roster, neither deleted nor withheld.
        expect(members?.has("moved")).toBe(false);
        expect(factOf(store.state(), "project", "moved")?.content.kind).toBe("value");
        // Still this organization's: the roster's index lags; it stays, unverified.
        expect(members?.get("lagging")).toBe("absent-unverified");
        expect(fixture.opens()).toBe(1);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("registers again once for several projects taken at once, each withheld", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let listed = ["kept", "a", "b"];
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: 403, body: null })
          : answers(
              () => [],
              () => listed.map((id) => ({ id, name: id, status: "ACTIVE", _version: 1 })),
            )(request),
      );
      const fiber = yield* run(store, fixture);
      listed = ["kept"];
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
        add: [],
        delete: ["a", "b"],
      });
      yield* settle;
      expect(factOf(store.state(), "project", "a")?.content.kind).toBe("purged");
      expect(factOf(store.state(), "project", "b")?.content.kind).toBe("purged");
      const link = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(store.state().streams.get(projectsScope(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("ends the attempt when a read of a member answers 401: the session is repaired", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let revoked = false;
      const fixture = fixtureWire((request) => {
        if (!revoked || request.body?.wsOutputType !== undefined) return answers(() => [])(request);
        // The session is renewed by the repair: the next read passes.
        revoked = false;
        return Effect.fail({ outcome: "recoverable-session", message: "HTTP 401" } as const);
      });
      const fiber = yield* run(store, fixture);
      revoked = true;
      // A new member: its row is read by id, and that read is refused for the credential.
      yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
        add: ["fresh"],
        delete: [],
      });
      yield* settle;
      expect(fixture.opens()).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "restores a denied project from a later baseline that lists it, never from a push",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const project = { id: "p", name: "p", status: "ACTIVE", _version: 1 };
        const fixture = fixtureWire((request) =>
          request.method === "GET"
            ? Effect.succeed({ status: 403, body: null })
            : answers(
                () => [],
                () => [project],
              )(request),
        );
        const fiber = yield* run(store, fixture);
        yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "listStream"), {
          add: [],
          delete: ["p"],
        });
        yield* settle;
        expect(factOf(store.state(), "project", "p")?.content.kind).toBe("purged");

        yield* fixture.push(fixture.subscription(PROJECT_SEARCH, "updateStream"), {
          update: [project],
        });
        yield* settle;
        expect(factOf(store.state(), "project", "p")?.content.kind).toBe("purged");

        yield* fixture.drop({ outcome: "transient", message: "socket closed" });
        yield* settle;
        const link = store.state().streams.get(linkKeys.zerops(ORG));
        yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
        yield* settle;
        expect(factOf(store.state(), "project", "p")).toMatchObject({
          content: { kind: "value", value: { name: "p" } },
          access: "allowed",
        });
        expect(store.state().memberships.get(projectsScope(ORG))?.members.get("p")).toBe("member");
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

const runLink = (
  store: ReturnType<typeof makeAccountStore>,
  fixture: ReturnType<typeof fixtureWire>,
) =>
  Effect.gen(function* () {
    const link = zeropsNavigationLink({ orgId: ORG, wire: fixture.wire, store, makeId: counter() });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { fiber, link, supervisor };
  });

const run = (store: ReturnType<typeof makeAccountStore>, fixture: ReturnType<typeof fixtureWire>) =>
  Effect.map(runLink(store, fixture), ({ fiber }) => fiber);

function counter() {
  let next = 0;
  return () => `sub-${(next += 1)}`;
}

describe("a demanded detail", () => {
  const HISTORY_PATH = `/project/${PROBE_PROJECT_ID}/process?limit=100`;
  const history = historyScope(ORG, PROBE_PROJECT_ID);
  const DEMAND = { family: "process", listing: "history", ownerId: PROBE_PROJECT_ID } as const;
  const finished = {
    id: "old",
    projectId: PROBE_PROJECT_ID,
    status: "FINISHED",
    actionName: "stack.deploy",
    created: "2026-10-05T18:00:00Z",
  };
  const historyReads = (fixture: ReturnType<typeof fixtureWire>) =>
    fixture.requests.filter((request) => request.method === "GET" && request.path === HISTORY_PATH)
      .length;

  it.effect("reads a demanded history once as its baseline and lets it go when released", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: 200, body: { list: [finished] } })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      expect(historyReads(fixture)).toBe(0);

      const release = link.demandDetail(DEMAND);
      yield* settle;
      expect(historyReads(fixture)).toBe(1);
      expect(store.state().streams.get(history)?.phase).toBe("live");
      expect(store.state().memberships.get(history)?.members.get("old")).toBe("member");
      expect(factOf(store.state(), "process", "old")?.content).toMatchObject({
        value: { status: "FINISHED" },
      });

      release();
      yield* settle;
      expect(store.state().streams.get(history)).toMatchObject({
        phase: "paused",
        demanded: false,
      });
      expect(factOf(store.state(), "process", "old")?.content.kind).toBe("value");

      link.demandDetail(DEMAND);
      yield* settle;
      expect(historyReads(fixture)).toBe(2);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "takes a service read by its id over the listing's row when Zerops updated it since",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const zcp = {
          id: "s1",
          clientId: ORG,
          projectId: PROBE_PROJECT_ID,
          name: "zcp",
          status: "ACTIVE",
        };
        const fixture = fixtureWire((request) =>
          request.method === "GET" && request.path === "/service-stack/s1"
            ? // Its own row, after its address was turned on: no `_version`, a newer lastUpdate.
              Effect.succeed({
                status: 200,
                body: { ...zcp, subdomainAccess: true, lastUpdate: "2026-10-02T12:01:50Z" },
              })
            : request.path === "/service-stack/search" &&
                request.body?.wsOutputType === "listStream"
              ? Effect.succeed({
                  items: [
                    {
                      ...zcp,
                      subdomainAccess: false,
                      lastUpdate: "2026-10-02T12:01:40Z",
                      _version: 3,
                    },
                  ],
                })
              : answers(() => [])(request),
        );
        const { fiber, link } = yield* runLink(store, fixture);
        expect(factOf(store.state(), "service", "s1")?.content).toMatchObject({
          value: { subdomainAccess: false },
        });

        link.demandDetail({ family: "service", listing: "service", ownerId: "s1" });
        yield* settle;
        expect(factOf(store.state(), "service", "s1")?.content).toMatchObject({
          value: { subdomainAccess: true },
        });
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("goes stale with its link and reads every demanded history again when it returns", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: 200, body: { list: [finished] } })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(DEMAND);
      yield* settle;

      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      expect(store.state().streams.get(history)?.phase).toBe("stale");
      expect(store.state().memberships.get(history)?.members.get("old")).toBe("member");

      const down = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(down?.next.kind === "retry" ? down.next.at : 0);
      yield* settle;
      expect(historyReads(fixture)).toBe(2);
      expect(store.state().streams.get(history)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each([
    { status: 403, phase: "refused", outcome: "authoritative-denial" },
    { status: 404, phase: "refused", outcome: "definitive-refusal" },
  ])(
    "refuses only the history its owner answers $status to; navigation stays live",
    ({ status, phase, outcome }) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire((request) =>
          request.method === "GET"
            ? Effect.succeed({ status, body: null })
            : answers(() => [])(request),
        );
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail(DEMAND);
        yield* settle;
        expect(store.state().streams.get(history)).toMatchObject({ phase, fault: { outcome } });
        expect(store.state().streams.get(runningScope(ORG))?.phase).toBe("live");
        expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("retries a demanded history whose read is lost on the way alone, the link stays", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.fail({ outcome: "transient", message: "HTTP 503" } as const)
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(DEMAND);
      yield* settle;
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      expect(store.state().streams.get(history)?.phase).toBe("recovering");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("reads a history again that a screen let go and held again in one tick", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: 200, body: { list: [finished] } })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      const release = link.demandDetail(DEMAND);
      yield* settle;
      // A card unmounts and the next one mounts in the same commit.
      release();
      link.demandDetail(DEMAND);
      yield* settle;
      expect(historyReads(fixture)).toBe(2);
      expect(store.state().streams.get(history)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("what a baseline and a read by id may claim", () => {
  const VERSION_SEARCH = "/app-version/search";
  const activeVersions =
    (items: ReadonlyArray<unknown>, totalHits = items.length) =>
    (request: WireRequest): Effect.Effect<unknown, StreamFault> =>
      request.path === VERSION_SEARCH && request.body?.wsOutputType === "listStream"
        ? Effect.succeed({ items, totalHits })
        : answers(() => [])(request);
  const version = (id: string) => ({
    id,
    projectId: "p1",
    serviceStackId: "s1",
    status: "ACTIVE",
    source: "GIT",
    _version: 1,
  });

  it.effect("a baseline cut at the page limit is no complete list, and leaves no member out", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fiber = yield* run(store, fixtureWire(activeVersions([version("v1")], 2_001)));
      expect(store.state().memberships.get(activeScope(ORG))?.coverage).toBe("partial");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a baseline with a row it cannot read keeps the member and says it is partial", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const damaged = { id: "v2", status: "ACTIVE" };
      const fiber = yield* run(store, fixtureWire(activeVersions([version("v1"), damaged])));
      const membership = store.state().memberships.get(activeScope(ORG));
      expect(membership?.coverage).toBe("partial");
      expect(membership?.members.get("v2")).toBe("member");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect(
    "a read by id that fails is tried again alone: the link and its registrations stay",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let failing = true;
        const fixture = fixtureWire((request) =>
          request.body?.wsOutputType === undefined && request.path === PROCESS_SEARCH && failing
            ? Effect.fail<StreamFault>({
                outcome: "transient",
                message: "HTTP 503",
                retryAfterMs: 5_000,
              })
            : answers(() => [])(request),
        );
        const fiber = yield* run(store, fixture);
        const registered = fixture.requests.filter((request) => request.body?.wsOutputType).length;
        yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "listStream"), {
          add: ["J3TU3gE0SvCFrPDutSacqw"],
          delete: [],
        });
        yield* settle;
        expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
        failing = false;
        // Not before what Zerops asked for.
        yield* TestClock.adjust(4_000);
        yield* settle;
        expect(factOf(store.state(), "process", "J3TU3gE0SvCFrPDutSacqw")).toBeUndefined();
        yield* TestClock.adjust(6_000);
        yield* settle;
        expect(factOf(store.state(), "process", "J3TU3gE0SvCFrPDutSacqw")).toBeDefined();
        expect(fixture.opens()).toBe(1);
        expect(fixture.requests.filter((request) => request.body?.wsOutputType)).toHaveLength(
          registered,
        );
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "a detail read that fails retries itself on the retry policy, the link stays live",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        let failing = true;
        const fixture = fixtureWire((request) =>
          request.method === "GET" && request.path === "/app-version/v9"
            ? failing
              ? Effect.fail<StreamFault>({
                  outcome: "transient",
                  message: "HTTP 429",
                  retryAfterMs: 3_000,
                })
              : Effect.succeed({ status: 200, body: version("v9") })
            : answers(() => [])(request),
        );
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail({ family: "version", listing: "version", ownerId: "v9" });
        yield* settle;
        expect(store.state().streams.get(versionScope(ORG, "v9"))?.phase).toBe("recovering");
        expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
        failing = false;
        yield* TestClock.adjust(3_000);
        yield* settle;
        expect(store.state().streams.get(versionScope(ORG, "v9"))?.phase).toBe("live");
        expect(factOf(store.state(), "version", "v9")).toBeDefined();
        expect(fixture.opens()).toBe(1);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect(
    "a refused detail stays refused across link attempts, until the person asks again",
    () =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const fixture = fixtureWire((request) =>
          request.method === "GET" && request.path === "/app-version/gone"
            ? Effect.fail<StreamFault>({ outcome: "definitive-refusal", message: "HTTP 400" })
            : answers(() => [])(request),
        );
        const { fiber, link, supervisor } = yield* runLink(store, fixture);
        link.demandDetail({ family: "version", listing: "version", ownerId: "gone" });
        yield* settle;
        const reads = () =>
          fixture.requests.filter((request) => request.path === "/app-version/gone");
        expect(reads()).toHaveLength(1);
        yield* fixture.drop({ outcome: "transient", message: "socket closed" });
        yield* settle;
        const down = store.state().streams.get(linkKeys.zerops(ORG));
        yield* TestClock.adjust(down?.next.kind === "retry" ? down.next.at : 0);
        yield* settle;
        expect(fixture.opens()).toBe(2);
        expect(reads()).toHaveLength(1);
        expect(store.state().streams.get(versionScope(ORG, "gone"))?.phase).toBe("refused");
        yield* supervisor.signal("manual-retry");
        yield* settle;
        expect(reads()).toHaveLength(2);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect("a version read by id is held; one the platform does not have refuses its read", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire((request) =>
        request.method === "GET" && request.path === "/app-version/v9"
          ? Effect.succeed({
              status: 200,
              body: { ...version("v9"), status: "BACKUP", source: "NONE" },
            })
          : request.method === "GET" && request.path === "/app-version/gone"
            ? Effect.fail<StreamFault>({ outcome: "definitive-refusal", message: "HTTP 400" })
            : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail({ family: "version", listing: "version", ownerId: "v9" });
      link.demandDetail({ family: "version", listing: "version", ownerId: "gone" });
      yield* settle;
      expect(factOf(store.state(), "version", "v9")?.content).toMatchObject({
        value: { source: "NONE", status: "BACKUP" },
      });
      expect(store.state().streams.get(versionScope(ORG, "gone"))?.phase).toBe("refused");
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("a sampled detail", () => {
  const MEMBERS_PATH = `/client/${ORG}/user/list?limit=100`;
  const AGENTS_PATH = "/user-data/search";
  const MEMBERS = { family: "organizationMembers", ownerId: ORG } as const;
  const AGENTS = { family: "serviceAgents", ownerId: "s1" } as const;
  const members = membersScope(ORG);
  const member = (id: string) => ({ id, user: { fullName: id } });
  const readsOf = (
    fixture: ReturnType<typeof fixtureWire>,
    path: string,
    method: "GET" | "POST" = "GET",
  ) =>
    fixture.requests.filter((request) => request.method === method && request.path === path).length;
  /**
   * Answers the member list with whatever `list` holds when it is read,
   * and a service's agent keys.
   */
  const sampledAnswers =
    (list: { current: ReadonlyArray<unknown> }, held?: Deferred.Deferred<void>) =>
    (request: WireRequest): Effect.Effect<unknown, StreamFault> => {
      if (request.path === AGENTS_PATH)
        return Effect.succeed({
          items: [{ id: "e1", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "1" }],
        });
      if (request.method !== "GET") return answers(() => [])(request);
      const body = { clientUserList: list.current };
      return held === undefined
        ? Effect.succeed({ status: 200, body })
        : Effect.andThen(Deferred.await(held), Effect.succeed({ status: 200, body }));
    };

  it.effect("reads the owner's whole value as one fact and never claims it live", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(sampledAnswers({ current: [member("m1")] }));
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(1);
      expect(store.state().streams.get(members)).toMatchObject({
        phase: "live",
        mode: "once",
        next: { kind: "await-input-change" },
      });
      expect(factOf(store.state(), "organizationMembers", ORG)?.content).toEqual({
        kind: "value",
        value: [member("m1")],
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("reads a sampled detail without waiting for the navigation's baselines", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const held = yield* Deferred.make<void>();
      const fixture = fixtureWire((request) =>
        request.body?.wsOutputType === "listStream"
          ? Effect.andThen(Deferred.await(held), answers(() => [])(request))
          : sampledAnswers({ current: [member("m1")] })(request),
      );
      const link = zeropsNavigationLink({
        orgId: ORG,
        wire: fixture.wire,
        store,
        makeId: counter(),
      });
      link.demandDetail(MEMBERS);
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(1);
      expect(factOf(store.state(), "organizationMembers", ORG)?.content.kind).toBe("value");
      yield* Deferred.succeed(held, undefined);
      yield* settle;
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("reads a member list once: no cadence, and a new demand reads nothing", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(sampledAnswers({ current: [member("m1")] }));
      const { fiber, link } = yield* runLink(store, fixture);
      const release = link.demandDetail(MEMBERS);
      yield* settle;
      yield* TestClock.adjust(STREAM_POLICY.sampledIntervalMs * 10);
      yield* settle;
      release();
      yield* settle;
      link.demandDetail(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(1);
      expect(store.state().streams.get(members)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("reads a service's agents by a search of their own keys, never its variables", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(sampledAnswers({ current: [] }));
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(AGENTS);
      yield* settle;
      expect(factOf(store.state(), "serviceAgents", "s1")?.content).toEqual({
        kind: "value",
        value: ["claude-code"],
      });
      const search = fixture.requests.find((request) => request.path === AGENTS_PATH)?.body
        ?.search as ReadonlyArray<{ readonly name: string; readonly value: unknown }>;
      expect(search).toContainEqual({ name: "serviceStackId", operator: "eq", value: "s1" });
      const keys = search.find((term) => term.name === "key")?.value as ReadonlyArray<string>;
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => key.startsWith("ZCP_AGENT_OAUTH_"))).toBe(true);
      expect(fixture.requests.some((request) => request.path.endsWith("/env"))).toBe(false);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each([
    { name: "agents within their freshness", passed: 1_000, reads: 1 },
    { name: "agents past their freshness", passed: STREAM_POLICY.sampledIntervalMs, reads: 2 },
  ])("a new demand of $name reads $reads time(s) in all", ({ passed, reads }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(sampledAnswers({ current: [] }));
      const { fiber, link } = yield* runLink(store, fixture);
      const release = link.demandDetail(AGENTS);
      yield* settle;
      release();
      yield* settle;
      yield* TestClock.adjust(passed);
      link.demandDetail(AGENTS);
      yield* settle;
      expect(readsOf(fixture, AGENTS_PATH, "POST")).toBe(reads);
      expect(store.state().streams.get(detailScopeOf(ORG, AGENTS))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("reads it again at once after our own write, held or held next", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = fixtureWire(sampledAnswers({ current: [member("m1")] }));
      const { fiber, link } = yield* runLink(store, fixture);
      const release = link.demandDetail(MEMBERS);
      yield* settle;
      link.revalidate(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(2);

      release();
      yield* settle;
      link.revalidate(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(2);
      link.demandDetail(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(3);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("our write while a read is under way reads it once more after that read", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const held = yield* Deferred.make<void>();
      const list = { current: [member("m1")] as ReadonlyArray<unknown> };
      const fixture = fixtureWire((request) =>
        request.method === "GET" && readsOf(fixture, MEMBERS_PATH) === 1
          ? sampledAnswers(list, held)(request)
          : sampledAnswers(list)(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(MEMBERS);
      yield* settle;
      expect(store.state().streams.get(members)?.phase).toBe("baselining");

      // The birth minted the anchor while the list was being read: its answer may predate it.
      list.current = [member("m1"), member("anchor")];
      link.revalidate(MEMBERS);
      yield* Deferred.succeed(held, undefined);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(2);
      expect(factOf(store.state(), "organizationMembers", ORG)?.content).toEqual({
        kind: "value",
        value: [member("m1"), member("anchor")],
      });
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a refusal stays refused through its cadence; only the person's again reads it", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let status = 403;
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status, body: status === 200 ? { clientUserList: [] } : null })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(MEMBERS);
      yield* settle;
      expect(store.state().streams.get(members)?.phase).toBe("refused");
      status = 200;
      link.revalidate(MEMBERS);
      yield* TestClock.adjust(STREAM_POLICY.sampledIntervalMs * 3);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(1);
      link.retryDetail(MEMBERS);
      yield* settle;
      expect(readsOf(fixture, MEMBERS_PATH)).toBe(2);
      expect(store.state().streams.get(members)?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("an answer it cannot read keeps the last value and retries alone", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      let body: unknown = { clientUserList: [member("m1")] };
      const fixture = fixtureWire((request) =>
        request.method === "GET"
          ? Effect.succeed({ status: 200, body })
          : answers(() => [])(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      link.demandDetail(MEMBERS);
      yield* settle;
      body = { clientUserList: "not a list" };
      link.revalidate(MEMBERS);
      yield* settle;
      expect(store.state().streams.get(members)?.phase).toBe("recovering");
      expect(factOf(store.state(), "organizationMembers", ORG)?.content).toEqual({
        kind: "value",
        value: [member("m1")],
      });
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("the organization's routings refused to the viewer", () => {
  const ROUTING_SEARCH = "/public-http-routing/search";
  const routingPosts = (fixture: ReturnType<typeof fixtureWire>) =>
    fixture.requests.filter((request) => request.path === ROUTING_SEARCH).length;

  it.effect.each([
    { name: "401, a member without organization read", status: 401 },
    { name: "403, a member without organization read", status: 403 },
  ])("$name: refuses that scope alone, never the link or its other scopes", ({ status }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const base = answers(() => []);
      const fixture = fixtureWire((request) =>
        request.path === ROUTING_SEARCH ? Effect.fail(classifyHttp(status)) : base(request),
      );
      const fiber = yield* run(store, fixture);
      expect(store.state().streams.get(linkKeys.zerops(ORG))?.phase).toBe("live");
      expect(store.state().streams.get(projectsScope(ORG))?.phase).toBe("live");
      expect(store.state().streams.get(routingsScope(ORG))?.phase).toBe("refused");
      // Its pair stops at the first refusal: the listing is never asked for.
      expect(routingPosts(fixture)).toBe(1);

      // The link's next attempt registers the rest again and leaves the refused scope be.
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const link = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(link?.next.kind === "retry" ? link.next.at : 0);
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(store.state().streams.get(projectsScope(ORG))?.phase).toBe("live");
      expect(store.state().streams.get(routingsScope(ORG))?.phase).toBe("refused");
      expect(routingPosts(fixture)).toBe(1);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect("a project a surface shows is read through its own listing, once per demand", () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const base = answers(() => []);
      const path = `/project/${PROBE_PROJECT_ID}/public-http-routing`;
      const fixture = fixtureWire((request) =>
        request.path === ROUTING_SEARCH
          ? Effect.fail(classifyHttp(403))
          : request.path === path
            ? Effect.succeed({
                status: 200,
                body: {
                  list: [
                    {
                      id: "r1",
                      isSynced: true,
                      sslEnabled: true,
                      domains: [{ domainName: "shop.example.com" }],
                      locations: [{ path: "/", port: 80, serviceStackId: "s1" }],
                    },
                  ],
                },
              })
            : base(request),
      );
      const { fiber, link } = yield* runLink(store, fixture);
      const reads = () => fixture.requests.filter((request) => request.path === path).length;
      expect(reads()).toBe(0);
      const release = link.demandDetail({
        family: "publicRouting",
        listing: "projectRoutings",
        ownerId: PROBE_PROJECT_ID,
      });
      yield* settle;
      expect(reads()).toBe(1);
      const scope = projectRoutingsScope(ORG, PROBE_PROJECT_ID);
      expect(store.state().streams.get(scope)?.phase).toBe("live");
      expect(store.state().memberships.get(scope)?.members.get("r1")).toBe("member");
      // Held, it is not read again while the link stays.
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(reads()).toBe(1);
      release();
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("recorded routing membership frames", () => {
  it.effect.each([
    { name: "delete without add", data: { delete: [REMOVED_ROUTING] }, expected: "removed" },
    {
      name: "delete with empty add",
      data: { add: [], delete: [REMOVED_ROUTING] },
      expected: "removed",
    },
  ])("$name", ({ data, expected }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const base = answers(() => []);
      const fixture = fixtureWire((request) =>
        request.path === "/public-http-routing/search" &&
        request.body?.wsOutputType === "listStream"
          ? Effect.succeed({ items: [{ ...RECORDED_ROUTING, id: REMOVED_ROUTING }] })
          : base(request),
      );
      const fiber = yield* run(store, fixture);
      yield* fixture.push(fixture.subscription("/public-http-routing/search", "listStream"), data);
      yield* settle;
      expect(store.state().memberships.get(routingsScope(ORG))?.members.get(REMOVED_ROUTING)).toBe(
        expected,
      );
      expect([...indexOf(store.state(), "routingProject", ROUTING_PROJECT)]).toEqual([]);
      yield* Fiber.interrupt(fiber);
    }),
  );

  it.effect.each(["read", "push-first", "push-during-read", "listed-row"] as const)(
    "id-only add resolved by %s",
    (source) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const resolved = yield* Deferred.make<void>();
        const base = answers(() => []);
        const fixture = fixtureWire((request) =>
          request.path === "/public-http-routing/search" && !request.body?.wsOutputType
            ? Effect.as(Deferred.await(resolved), { items: [RECORDED_ROUTING] })
            : base(request),
        );
        const fiber = yield* run(store, fixture);
        const push = fixture.push(
          fixture.subscription("/public-http-routing/search", "updateStream"),
          { update: [RECORDED_ROUTING] },
        );
        if (source === "push-first") {
          yield* push;
          yield* settle;
        }
        yield* fixture.push(fixture.subscription("/public-http-routing/search", "listStream"), {
          add: [RECORDED_ROUTING.id],
          ...(source === "listed-row" ? { update: [RECORDED_ROUTING] } : {}),
        });
        yield* settle;
        expect(
          store.state().memberships.get(routingsScope(ORG))?.members.get(RECORDED_ROUTING.id),
        ).toBe("member");
        if (source !== "push-first" && source !== "listed-row") {
          expect(factOf(store.state(), "publicRouting", RECORDED_ROUTING.id)).toBeUndefined();
          expect([...indexOf(store.state(), "routingProject", ROUTING_PROJECT)]).toEqual([]);
          expect(fixture.requests.at(-1)?.body?.search).toContainEqual({
            name: "id",
            operator: "in",
            value: [RECORDED_ROUTING.id],
          });
          if (source === "push-during-read") yield* push;
          else yield* Deferred.succeed(resolved, undefined);
          yield* settle;
        }
        expect([...indexOf(store.state(), "routingProject", ROUTING_PROJECT)]).toEqual([
          RECORDED_ROUTING.id,
        ]);
        yield* Fiber.interrupt(fiber);
      }),
  );
});

describe("project routing subscriptions after organization refusal", () => {
  const path = "/public-http-routing/search";
  const readPath = `/project/${ROUTING_PROJECT}/public-http-routing`;
  const demand = {
    family: "publicRouting",
    listing: "projectRoutings",
    ownerId: ROUTING_PROJECT,
  } as const;

  it.effect.each([
    { name: "project pair allowed", refusal: 0 },
    { name: "project pair refused with 401", refusal: 401 },
    { name: "project pair refused with 403", refusal: 403 },
  ])("$name stays current through the recorded disable/enable", ({ refusal }) =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const base = answers(
        () => [],
        () => [{ ...PROBE_PROJECT, id: ROUTING_PROJECT }],
      );
      let routings = [RECORDED_ROUTING];
      const fixture = fixtureWire((request) => {
        if (request.path === path) {
          const project = searched(request).some(
            (term) => term.name === "projectId" && term.value === ROUTING_PROJECT,
          );
          if (!project || refusal) return Effect.fail(classifyHttp(project ? refusal : 403));
          return Effect.succeed(
            request.body?.wsOutputType === "updateStream" ? {} : { items: routings },
          );
        }
        if (request.path === readPath)
          return Effect.succeed({ status: 200, body: { list: routings } });
        if (request.path === "/service-stack/search" && request.body?.wsOutputType === "listStream")
          return Effect.succeed({ items: [RECORDED_SERVICE] });
        return base(request);
      });
      const { fiber, link } = yield* runLink(store, fixture);
      const scope = projectRoutingsScope(ORG, ROUTING_PROJECT);
      const reads = () => fixture.requests.filter((request) => request.path === readPath).length;
      const registrations = () =>
        fixture.requests.filter(
          (request) =>
            request.path === path && searched(request).some((term) => term.name === "projectId"),
        );
      expect(reads()).toBe(0);
      const release = link.demandDetail(demand);
      yield* settle;
      expect(registrations()).toHaveLength(refusal ? 1 : 2);
      expect(reads()).toBe(refusal ? 1 : 0);
      expect(store.state().memberships.get(scope)?.members.get(RECORDED_ROUTING.id)).toBe("member");
      routings = [];
      if (!refusal)
        yield* fixture.push(fixture.subscription(path, "listStream"), {
          delete: [RECORDED_ROUTING.id],
        });
      yield* fixture.push(fixture.subscription("/service-stack/search", "updateStream"), {
        update: [{ ...RECORDED_SERVICE, subdomainAccess: false, _version: 46 }],
      });
      yield* settle;
      expect(store.state().memberships.get(scope)?.members.get(RECORDED_ROUTING.id)).toBe(
        "removed",
      );
      expect(reads()).toBe(refusal ? 2 : 0);
      routings = [RECORDED_ROUTING];
      if (!refusal)
        yield* fixture.push(fixture.subscription(path, "listStream"), {
          add: [RECORDED_ROUTING.id],
        });
      // The routing process ends before the service's on push.
      const process = {
        id: "routing-process",
        projectId: ROUTING_PROJECT,
        serviceStackId: RECORDED_SERVICE.id,
        created: "2026-10-06T00:00:00Z",
        status: "FINISHED",
        actionName: "stack.enableSubdomainAccess",
        _version: 2,
      };
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), {
        update: [process],
      });
      yield* settle;
      expect(store.state().memberships.get(scope)?.members.get(RECORDED_ROUTING.id)).toBe("member");
      const readCount = reads();
      // Duplicates, unrelated work, stale service rows and elapsed time are not invalidations.
      yield* fixture.push(fixture.subscription(PROCESS_SEARCH, "updateStream"), {
        update: [process, { ...process, id: "unrelated", actionName: "stack.build" }],
      });
      yield* fixture.push(fixture.subscription("/service-stack/search", "updateStream"), {
        update: [RECORDED_SERVICE],
      });
      yield* TestClock.adjust(120_000);
      yield* settle;
      expect(reads()).toBe(readCount);
      expect(registrations()).toHaveLength(refusal ? 1 : 2);
      release();
      yield* settle;
      yield* fixture.push(fixture.subscription("/service-stack/search", "updateStream"), {
        update: [{ ...RECORDED_SERVICE, _version: 47 }],
      });
      yield* settle;
      expect(reads()).toBe(readCount);
      link.demandDetail(demand);
      yield* settle;
      expect(registrations()).toHaveLength(refusal ? 1 : 4);
      expect(reads()).toBe(refusal ? readCount + 1 : 0);
      yield* fixture.drop({ outcome: "transient", message: "socket closed" });
      yield* settle;
      const stream = store.state().streams.get(linkKeys.zerops(ORG));
      yield* TestClock.adjust(
        stream?.next.kind === "retry" ? Math.max(0, stream.next.at - 120_000) : 0,
      );
      yield* settle;
      expect(fixture.opens()).toBe(2);
      expect(registrations()).toHaveLength(refusal ? 1 : 6);
      expect(reads()).toBe(refusal ? readCount + 2 : 0);
      yield* Fiber.interrupt(fiber);
    }),
  );
});

describe("routing fallback refresh races", () => {
  it.effect.each([403, 404])(
    "a refused project GET (%s) stays refused after owner pushes",
    (status) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const base = answers(() => []);
        const fixture = fixtureWire((request) =>
          request.path === "/public-http-routing/search"
            ? Effect.fail(classifyHttp(403))
            : request.method === "GET"
              ? Effect.succeed({ status, body: {} })
              : base(request),
        );
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail({
          family: "publicRouting",
          listing: "projectRoutings",
          ownerId: ROUTING_PROJECT,
        });
        yield* settle;
        expect(store.state().streams.get(projectRoutingsScope(ORG, ROUTING_PROJECT))?.phase).toBe(
          "refused",
        );
        yield* fixture.push(fixture.subscription("/service-stack/search", "updateStream"), {
          update: [RECORDED_SERVICE],
        });
        yield* TestClock.adjust(120_000);
        yield* settle;
        expect(fixture.requests.filter((request) => request.method === "GET")).toHaveLength(1);
        yield* Fiber.interrupt(fiber);
      }),
  );

  it.effect.each([false, true])(
    "a service push racing the fallback read is not lost (partial=%s)",
    (partial) =>
      Effect.gen(function* () {
        const store = makeAccountStore(AtomRegistry.make());
        const first = yield* Deferred.make<void>();
        const base = answers(() => []);
        let reads = 0;
        const fixture = fixtureWire((request) => {
          if (request.path === "/public-http-routing/search") return Effect.fail(classifyHttp(403));
          if (request.method === "GET") {
            reads += 1;
            return reads === 1
              ? Effect.as(Deferred.await(first), {
                  status: 200,
                  body: { list: partial ? [{ id: RECORDED_ROUTING.id }] : [] },
                })
              : Effect.succeed({ status: 200, body: { list: [RECORDED_ROUTING] } });
          }
          return base(request);
        });
        const { fiber, link } = yield* runLink(store, fixture);
        link.demandDetail({
          family: "publicRouting",
          listing: "projectRoutings",
          ownerId: ROUTING_PROJECT,
        });
        yield* settle;
        yield* fixture.push(fixture.subscription("/service-stack/search", "updateStream"), {
          update: [RECORDED_SERVICE],
        });
        yield* settle;
        expect(reads).toBe(1);
        yield* Deferred.succeed(first, undefined);
        yield* settle;
        expect(reads).toBe(2);
        expect(
          store
            .state()
            .memberships.get(projectRoutingsScope(ORG, ROUTING_PROJECT))
            ?.members.get(RECORDED_ROUTING.id),
        ).toBe("member");
        yield* Fiber.interrupt(fiber);
      }),
  );
});
