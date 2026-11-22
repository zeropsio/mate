import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/reactivity";
import { gitEnvironment, gitRemote, hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import type { Family } from "../model.ts";
import { hqNavigation } from "../projections/hqNavigation.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { STREAM_POLICY } from "../streamMachine.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyHqClose, hqNavigationLink } from "./hq.ts";

const opened = (orgId: string) =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const link = hqNavigationLink({ orgId, wire: fixture.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    return { store, fixture, link, fiber };
  });

// witness: packages/client-runtime/src/data/adapters/hq.ts | message.type === "scope-reset" || → message.type === "scope-values" ||
it.effect(
  "AD1: Every record of HQ's first navigation delivery, as HQ sends it, is held when it arrives: the organization, HQ's status, each application, each placed project, the update policy and the persona templates; none is dropped",
  () =>
    Effect.gen(function* () {
      const frame = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      const { store, fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(frame);
      yield* settle;

      const rows = [
        ["hqOrganization", "v17"],
        ["hqStatus", "v17"],
        ["hqApp", "v2"],
        ["hqApp", "v4"],
        ["hqApp", "v8"],
        ["hqApp", "v10"],
        ["placement", "v12"],
        ["hqAutoUpdatePolicy", "v17"],
        ["hqPersonaTemplates", "v17"],
      ] as const;
      expect(rows).toHaveLength(frame.values.length);
      const reads = readsOfState(store.state());
      for (const [family, id] of rows) {
        const fact = reads.fact(family, id);
        expect(fact.kind, `${family} ${id}`).toBe("known");
        if (family === "hqApp") expect(fact).toMatchObject({ value: { id } });
      }
      expect(reads.fact("placement", "v12")).toMatchObject({
        value: { projectId: "v12", appId: null },
      });
      expect(reads.fact("hqOrganization", "v17")).toMatchObject({ value: { build: "v1" } });

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | if (message.scope.kind === "navigation") { → if (message.scope.kind === "attention") {
it.effect(
  "AD4: HQ's ready frame after its first navigation delivery, as HQ sends it, makes the navigation live and its Core declaration held as HQ declared it: the protocol, the build and both capabilities",
  () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset"));
      yield* settle;
      expect(streamOf(store.state(), hqAppsScope("v17")).phase).toBe("baselining");
      expect(fixture.sent[0]?.request).toEqual({
        type: "subscribe",
        scopes: [{ scope: { kind: "navigation" }, knownKeys: [] }],
      });

      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      expect(streamOf(store.state(), hqAppsScope("v17")).phase).toBe("live");
      expect(streamOf(store.state(), placementsScope("v17")).phase).toBe("live");
      expect(readsOfState(store.state()).fact("hqProtocol", "v17")).toMatchObject({
        kind: "known",
        value: { protocol: 1, build: "v1", autoUpdatePolicy: 1, agentUsage: 2 },
      });

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | message.revision === cursor.revision + 1 → message.revision === cursor.revision + 2
it.effect(
  "AD5: A navigation delivery that follows what is held (the same incarnation, the next revision), as HQ sends it after an application is renamed, is committed: its application is held and every record of the first delivery stays",
  () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset"));
      yield* settle;
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      yield* fixture.send(recorded("scope-values", "mate-hq/navigation.scope-values"));
      yield* settle;

      const reads = readsOfState(store.state());
      expect(reads.fact("hqApp", "v1")).toMatchObject({ kind: "known", value: { id: "v1" } });
      for (const id of ["v2", "v4", "v8", "v10"]) {
        expect(reads.fact("hqApp", id).kind, id).toBe("known");
      }
      expect(reads.fact("placement", "v12").kind).toBe("known");
      for (const family of [
        "hqOrganization",
        "hqStatus",
        "hqAutoUpdatePolicy",
        "hqPersonaTemplates",
      ] as const) {
        expect(reads.fact(family, "v17").kind, family).toBe("known");
      }

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | message.revision === cursor.revision + 1 → message.revision >= cursor.revision
it.effect(
  "AD6: A navigation delivery that does not follow what is held, HQ's own delta arriving a second time, is never committed: HQ is asked for the navigation whole by one subscribe, with no cursor and no unsubscribe before it",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset"));
      yield* settle;
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      const delta = recorded("scope-values", "mate-hq/navigation.scope-values");
      yield* fixture.send(delta);
      yield* settle;

      const before = fixture.sent.length;
      yield* fixture.send(delta);
      yield* settle;
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      expect(requests).toHaveLength(1);
      const [subscribe] = requests;
      assert(subscribe?.type === "subscribe");
      expect(subscribe.scopes).toHaveLength(1);
      const entry = subscribe.scopes[0]!;
      expect(entry.scope).toEqual({ kind: "navigation" });
      expect("cursor" in entry).toBe(false);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | asked.has(scopeKey) ? [scope] : [], → [],
it.effect(
  "AD7: HQ saying the navigation changed, as HQ sends it, is answered on the open socket by one retry naming the navigation; no value is assumed",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset"));
      yield* settle;
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;

      const before = fixture.sent.length;
      yield* fixture.send(recorded("scope-changed", "mate-hq/navigation.scope-changed"));
      yield* settle;
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      expect(requests).toHaveLength(1);
      expect(requests).toEqual([{ type: "retry", scopes: [{ kind: "navigation" }] }]);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | if (answering.size > 0) return; → if (answering.size < 0) return;
it.effect(
  "AD80: Changes HQ reports while a retry is unanswered are asked again in one retry after its answer, never one retry each; breaks: a busy organisation's changes cost a read of the person each",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v256");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset.placed"));
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      const changedNavigation = recorded("scope-changed", "mate-hq/navigation.scope-changed");
      const attention = { kind: "attention", projectId: "v31", health: "apart" } as const;
      const retries = (from: number) =>
        fixture.sent
          .slice(from)
          .flatMap(({ request }) => (request.type === "retry" ? [request] : []));

      const before = fixture.sent.length;
      yield* fixture.send(changedNavigation);
      yield* settle;
      expect(retries(before)).toEqual([{ type: "retry", scopes: [{ kind: "navigation" }] }]);

      // While HQ reads it, a Mate's attention and the navigation change again.
      const unanswered = fixture.sent.length;
      yield* fixture.send({ type: "scope-changed", scope: attention });
      yield* settle;
      yield* fixture.send(changedNavigation);
      yield* settle;
      expect(retries(unanswered)).toEqual([]);

      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      expect(retries(unanswered)).toEqual([
        { type: "retry", scopes: [attention, { kind: "navigation" }] },
      ]);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | refresh.add(registered.families[0]!.scope); → askAgain(registered, now);
it.effect(
  "AD73: A move of the person's access asks the navigation and the moved projects' held scopes again by one subscribe, never by retry, so HQ reads the person afresh; HQ's own change is still answered by retry",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v256");
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset.placed"));
      yield* settle;
      const moved = [
        { kind: "navigation" },
        { kind: "attention", projectId: "v31", health: "apart" },
      ];

      const before = fixture.sent.length;
      link.accessChanged(["v31"]);
      yield* settle;
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      expect(requests.map(({ type }) => type)).toEqual(["subscribe"]);
      const [subscribe] = requests;
      assert(subscribe?.type === "subscribe");
      expect(subscribe.scopes.map(({ scope }) => scope)).toEqual(moved);
      expect(subscribe.scopes.filter((entry) => "cursor" in entry)).toEqual([]);

      const changed = fixture.sent.length;
      yield* fixture.send(recorded("scope-changed", "mate-hq/navigation.scope-changed"));
      yield* settle;
      expect(fixture.sent.slice(changed).map(({ request }) => request)).toEqual([
        { type: "retry", scopes: [{ kind: "navigation" }] },
      ]);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | cursors.delete(hqScopeKey(scope)); → cursors.get(hqScopeKey(scope));
it.effect(
  "AD75: A move of the person's access asks each scope again whole, without its cursor, so records HQ withheld while the access was gone come back when it returns",
  () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber } = yield* opened("v17");
      const reset = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      yield* fixture.send(reset);
      yield* settle;
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      const placed = () => readsOfState(store.state()).fact("placement", "v12").kind;
      expect(placed()).toBe("known");

      // The access goes: HQ's baseline removes the project.
      yield* fixture.send({
        ...reset,
        revision: 2,
        values: reset.values.filter(({ key }) => key !== "project:v12"),
        removals: [{ key: "project:v12", reason: "no-access" }],
      });
      yield* settle;
      expect(placed()).toBe("withheld");

      // It returns: the navigation is asked whole, and HQ's baseline naming the project restores it.
      const before = fixture.sent.length;
      link.accessChanged([]);
      yield* settle;
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      const subscribe = requests.find(({ type }) => type === "subscribe");
      assert(subscribe?.type === "subscribe");
      expect(subscribe.scopes.map(({ scope }) => scope)).toEqual([{ kind: "navigation" }]);
      expect("cursor" in subscribe.scopes[0]!).toBe(false);
      yield* fixture.send({ ...reset, revision: 3 });
      yield* settle;
      expect(placed()).toBe("known");

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | ...(cursor === undefined ? {} : { cursor }), → ...(cursor !== undefined ? {} : { cursor }),
it.effect(
  "AD8: When HQ ends a socket as planned, the next one resumes the navigation from the cursor of the last delivery HQ sent and names every record held, so an unchanged navigation is not sent again",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v17");
      const reset = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      yield* fixture.send(reset);
      yield* settle;
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;

      yield* fixture.endSegment;
      yield* settle;
      const [first] = fixture.sent.filter(({ segment }) => segment === 2);
      assert(first?.request.type === "subscribe");
      const entry = first.request.scopes.find(({ scope }) => scope.kind === "navigation");
      expect(entry?.cursor).toEqual({ incarnation: reset.incarnation, revision: reset.revision });
      expect(entry?.knownKeys?.toSorted()).toEqual(
        [
          "org",
          "status",
          "app:v2",
          "app:v4",
          "app:v8",
          "app:v10",
          "project:v12",
          "auto-update-policy",
          "persona-templates",
        ].toSorted(),
      );

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | const accessDenied = accessEnded(message) !== null; → const accessDenied = accessEnded(message) === null;
it.effect(
  "AD9: HQ's refusal of a Mate's attention to a person who may not see its project, as HQ sends it, ends that read as denied: the scope is let go on the socket and no longer demanded",
  () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber } = yield* opened("org");
      const release = link.demandDetail({ family: "hqMate", ownerId: "v1" });
      yield* settle;
      const before = fixture.sent.length;
      yield* fixture.send(recorded("scope-error", "mate-hq/attention.scope-error.forbidden"));
      yield* settle;
      expect(streamOf(store.state(), hqMateScope("org", "v1"))).toMatchObject({
        phase: "refused",
        demanded: false,
        fault: { outcome: "authoritative-denial", code: "forbidden" },
      });
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      expect(requests).toHaveLength(1);
      expect(requests).toEqual([
        { type: "unsubscribe", scopes: [{ kind: "attention", projectId: "v1" }] },
      ]);

      release();
      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/zerops/hq/accessEnded.ts | case "chief_owner_required": → case "chief_owner":
it.effect(
  "AD10: HQ's refusal of another person's Chief, as HQ sends it, ends that read as denied and keeps whose Chief it is: the owner's id HQ named stays on the refusal",
  () =>
    Effect.gen(function* () {
      const { store, fixture, link, fiber } = yield* opened("org");
      const release = link.demandDetail({ family: "hqMate", ownerId: "v1" });
      yield* settle;
      yield* fixture.send(
        recorded("scope-error", "mate-hq/attention.scope-error.chief-owner-required"),
      );
      yield* settle;
      expect(streamOf(store.state(), hqMateScope("org", "v1"))).toMatchObject({
        phase: "refused",
        fault: { outcome: "authoritative-denial", code: "chief_owner_required", message: "v2" },
      });

      release();
      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | yield* open.send({ type: "pong" }); → yield* open.send({ type: "retry" });
it.effect(
  "AD11: HQ's ping, as HQ sends it, is answered with a pong on the same socket, so HQ does not close the stream for silence",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("org");
      const before = fixture.sent.length;
      yield* fixture.send(recorded("ping", "mate-hq/stream.ping"));
      yield* settle;
      const requests = fixture.sent.slice(before).map(({ request }) => request);
      expect(requests).toHaveLength(1);
      expect(requests).toEqual([{ type: "pong" }]);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | (fact.content.value as PlacementValue).mate != null → (fact.content.value as PlacementValue).mate == null
it.effect(
  "AD13: Each application, project and press of HQ's first navigation delivery to a person who sees placed Mates, as HQ sends it, is held with its place: an application names its projects, a project its application, and HQ is asked for the attention of each Mate and of no other project",
  () =>
    Effect.gen(function* () {
      const frame = recorded("scope-reset", "mate-hq/navigation.scope-reset.placed");
      const { store, fixture, link, fiber } = yield* opened("v256");
      yield* fixture.send(frame);
      yield* settle;

      const rows: [Family, string][] = [
        ["hqOrganization", "v256"],
        ["hqStatus", "v256"],
        ["hqAutoUpdatePolicy", "v256"],
        ["hqPersonaTemplates", "v256"],
        ["hqApp", "v2"],
        ["hqApp", "v29"],
        ["hqApp", "v42"],
        ["hqApp", "v178"],
        ["hqApp", "v212"],
        ["placement", "v31"],
        ["placement", "v172"],
        ["placement", "v43"],
        ["placement", "v122"],
        ["placement", "v4"],
        ["placement", "v180"],
        ["placement", "v181"],
        ["placement", "v182"],
        ["placement", "v183"],
        ["placement", "v184"],
        ["placement", "v214"],
        ["hqPress", "v182"],
      ];
      // HQ's other values are lifecycle requests of kinds this client no longer makes: none is held.
      const unmade = ["v254", "v259", "v263", "v264", "v268", "v269"];
      expect(rows.length + unmade.length).toBe(frame.values.length);
      const reads = readsOfState(store.state());
      for (const [family, id] of rows) {
        expect.soft(reads.fact(family, id).kind, `${family} ${id}`).toBe("known");
      }
      for (const id of unmade) {
        expect.soft(reads.fact("hqLifecycle", id).kind, `hqLifecycle ${id}`).not.toBe("known");
      }
      expect(reads.fact("hqApp", "v42")).toMatchObject({
        value: { projectIds: ["v172", "v43", "v122"] },
      });
      expect(reads.fact("placement", "v43")).toMatchObject({ value: { appId: "v42" } });
      expect(reads.fact("placement", "v31")).toMatchObject({ value: { appId: "v29" } });

      const scopes = fixture.sent.flatMap(({ request }) =>
        request.type === "subscribe" ? request.scopes.map(({ scope }) => scope) : [],
      );
      expect(scopes.filter((scope) => scope.kind !== "attention")).toEqual([
        { kind: "navigation" },
      ]);
      const attention = scopes
        .filter((scope) => scope.kind === "attention")
        .sort((a, b) => a.projectId.localeCompare(b.projectId));
      expect(attention).toEqual(
        ["v172", "v180", "v181", "v182", "v183", "v184", "v214", "v31", "v4"].map((projectId) => ({
          kind: "attention",
          projectId,
          health: "apart",
        })),
      );

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | if (message.disposition !== "refused") wakeAttempt?.(); → if (message.disposition === "refused") wakeAttempt?.();
it.effect(
  "AD60: A navigation whose first answer HQ fails transiently on an open socket is asked again on that socket once its retry is due, and not before",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v17");
      const subscribes = () =>
        fixture.sent.flatMap(({ segment, request }) =>
          request.type === "subscribe" ? [{ segment, request }] : [],
        );
      expect(subscribes()).toHaveLength(1);
      const [first] = subscribes();

      yield* fixture.send({
        type: "scope-error",
        scope: { kind: "navigation" },
        code: "unavailable",
        reason: "v1",
        disposition: "transient",
      });
      yield* settle;
      expect(subscribes()).toHaveLength(1);

      // The first retry falls between half and the whole of the backoff's base, by its jitter.
      const shortest = STREAM_POLICY.backoffBaseMs / 2;
      yield* TestClock.adjust(shortest - 1);
      yield* settle;
      expect(subscribes()).toHaveLength(1);

      yield* TestClock.adjust(STREAM_POLICY.backoffBaseMs - shortest + 1);
      yield* settle;
      const asked = subscribes();
      expect(asked).toHaveLength(2);
      const again = asked[1]!;
      expect(again.segment).toBe(first!.segment);
      assert(again.request.type === "subscribe");
      expect(again.request.scopes.map(({ scope }) => scope)).toContainEqual({
        kind: "navigation",
      });

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | store.dispatch({ kind: "forget", scopes: [...owned] }); → store.dispatch({ kind: "forget", scopes: [] });
it.effect(
  "AD62: Ending an account's HQ lifetime forgets its protected Git facts and drops every answer and hold arriving after",
  () =>
    Effect.gen(function* () {
      const reset = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      const { store, fixture, link, fiber } = yield* opened("v17");
      yield* fixture.send(reset);
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      const shop = reset.values.find(({ key }) => key === "app:v2")!.value as object;
      const delivered = (revision: number) =>
        fixture.send({
          type: "scope-values",
          scope: { kind: "navigation" },
          incarnation: reset.incarnation,
          revision,
          values: [{ key: "app:v2", value: { ...shop, environments: [gitEnvironment] } }],
          removals: [],
        });
      const environments = () =>
        hqNavigation.derive(readsOfState(store.state()), "v17").deliveryEnvironments;
      const holdsGit = () =>
        [...store.state().facts.values()].some(
          (fact) =>
            fact.content.kind === "value" &&
            JSON.stringify(fact.content.value).includes(gitRemote.url),
        );
      yield* delivered(reset.revision + 1);
      yield* settle;
      expect(environments()["v2"]).toMatchObject([{ id: gitEnvironment.id }]);

      link.stop();
      expect(environments()).toEqual({});
      expect(holdsGit()).toBe(false);

      const release = link.demandDetail({ family: "hqAppDetail", ownerId: "v2" });
      yield* delivered(reset.revision + 2);
      yield* settle;
      expect(environments()).toEqual({});
      expect(holdsGit()).toBe(false);
      expect(link.details!()).toEqual([]);
      expect(streamOf(store.state(), hqAppDetailScope("v17", "v2")).demanded).toBe(false);

      release();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | switch (failure.disposition) { → switch (failure.disposition === "refused" ? "session-ended" : failure.disposition) {
it.effect(
  "AD63: HQ refusing the whole socket (4403) is asked again only on the person's retry, never by time",
  () =>
    Effect.gen(function* () {
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const link = hqNavigationLink({ orgId: "v17", wire: fixture.wire, store });
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* settle;
      yield* fixture.send(recorded("scope-reset", "mate-hq/navigation.scope-reset"));
      yield* fixture.send(recorded("scope-ready", "mate-hq/navigation.scope-ready"));
      yield* settle;
      expect(fixture.opens()).toBe(1);

      yield* fixture.drop(classifyHqClose(4403));
      yield* settle;
      for (let waited = 0; waited < 10; waited++) {
        yield* TestClock.adjust(STREAM_POLICY.backoffCapMs);
        yield* settle;
      }
      expect(fixture.opens()).toBe(1);

      yield* supervisor.signal("manual-retry");
      yield* settle;
      expect(fixture.opens()).toBe(2);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);

// witness: packages/client-runtime/src/data/adapters/hq.ts | yield* open.send({ type: "unsubscribe", scopes: [entry.registered.wire] }); → yield* Effect.void;
it.effect(
  "AD81: A demotion and a give-back each ask HQ for the navigation alone by one subscribe; a Mate's attention is let go on the socket with its placement and asked again by one subscribe once HQ's answer places it again; breaks: a Mate HQ withheld stays asked, so HQ keeps reading the person for it, or one placed again never has its attention read",
  () =>
    Effect.gen(function* () {
      const { fixture, link, fiber } = yield* opened("v17");
      const reset = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      const ready = recorded("scope-ready", "mate-hq/navigation.scope-ready");
      yield* fixture.send(reset);
      yield* fixture.send(ready);
      yield* settle;
      const navigation = { kind: "navigation" };
      const attention = { kind: "attention", projectId: "v12", health: "apart" };
      const asked = (from: number) =>
        fixture.sent
          .slice(from)
          .map(({ request }) =>
            request.type === "subscribe"
              ? { type: request.type, scopes: request.scopes.map(({ scope }) => scope) }
              : request,
          );

      // Demoted: Zerops says the person's membership moved; HQ's answer withholds the project.
      const demoted = fixture.sent.length;
      link.accessChanged([]);
      yield* settle;
      expect(asked(demoted)).toEqual([{ type: "subscribe", scopes: [navigation] }]);
      yield* fixture.send({
        ...reset,
        revision: 2,
        values: reset.values.filter(({ key }) => key !== "project:v12"),
        removals: [{ key: "project:v12", reason: "no-access" }],
      });
      yield* fixture.send({ ...ready, revision: 2 });
      yield* settle;
      expect(asked(demoted)).toEqual([
        { type: "subscribe", scopes: [navigation] },
        { type: "unsubscribe", scopes: [attention] },
      ]);

      // Given back: the navigation alone is asked; HQ's answer placing the Mate asks its attention.
      const given = fixture.sent.length;
      link.accessChanged([]);
      yield* settle;
      expect(asked(given)).toEqual([{ type: "subscribe", scopes: [navigation] }]);
      yield* fixture.send({ ...reset, revision: 3 });
      yield* fixture.send({ ...ready, revision: 3 });
      yield* settle;
      expect(asked(given)).toEqual([
        { type: "subscribe", scopes: [navigation] },
        { type: "subscribe", scopes: [attention] },
      ]);

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);
