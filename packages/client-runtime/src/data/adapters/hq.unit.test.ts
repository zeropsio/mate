import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { recorded } from "../__fixtures__/recorded.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { hqNavigationLink } from "./hq.ts";

// witness: packages/client-runtime/src/data/adapters/hq.ts | message.type === "scope-reset" || → message.type === "scope-values" ||
it.effect(
  "AD1: Every record of HQ's first navigation delivery, as HQ sends it, is held when it arrives: the organization, HQ's status, each application, each placed project, the update policy and the persona templates; none is dropped",
  () =>
    Effect.gen(function* () {
      const frame = recorded("scope-reset", "mate-hq/navigation.scope-reset");
      const store = makeAccountStore(AtomRegistry.make());
      const fixture = hqFixtureWire();
      const link = hqNavigationLink({ orgId: "v17", wire: fixture.wire, store });
      const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
      const fiber = yield* Effect.forkChild(supervisor.run);
      yield* settle;
      yield* fixture.send(frame);
      yield* settle;

      const rows = [
        ["hqOrganization", "v17"],
        ["hqStatus", "v17"],
        ["hqApp", "v2"],
        ["hqApp", "v6"],
        ["hqApp", "v8"],
        ["hqApp", "v10"],
        ["placement", "v15"],
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
      expect(reads.fact("placement", "v15")).toMatchObject({
        value: { projectId: "v15", appId: null },
      });
      expect(reads.fact("hqOrganization", "v17")).toMatchObject({ value: { build: "v1" } });

      link.stop();
      yield* Fiber.interrupt(fiber);
    }),
);
