import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqAppsScope, placementsScope } from "../families/hqNavigation.ts";
import type { Family } from "../model.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink } from "./hq.ts";

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
  "AD6: A navigation delivery that does not follow what is held, HQ's own delta arriving a second time, is never committed: HQ is asked for the navigation whole, with no cursor",
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
      expect(requests).toHaveLength(2);
      const [unsubscribe, subscribe] = requests;
      expect(unsubscribe).toEqual({ type: "unsubscribe", scopes: [{ kind: "navigation" }] });
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

// witness: packages/client-runtime/src/data/adapters/accessEnded.ts | case "chief_owner_required": → case "chief_owner":
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
        ["hqLifecycle", "v254"],
        ["hqLifecycle", "v259"],
        ["hqLifecycle", "v263"],
        ["hqLifecycle", "v264"],
        ["hqLifecycle", "v268"],
        ["hqLifecycle", "v269"],
      ];
      expect(rows).toHaveLength(frame.values.length);
      const reads = readsOfState(store.state());
      for (const [family, id] of rows) {
        expect.soft(reads.fact(family, id).kind, `${family} ${id}`).toBe("known");
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
