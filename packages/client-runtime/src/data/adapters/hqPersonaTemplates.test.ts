import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { orgPersonaTemplates } from "../projections/hqPersonaTemplates.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { classifyHqClose, hqNavigationLink } from "./hq.ts";

const TEMPLATE = {
  id: "t-1",
  name: "Reviewer",
  description: "Reads every change twice.",
  instructions: "Review before you merge.",
  revision: 1,
};

const observe = (options: Parameters<typeof hqFixtureWire>[0] = {}) =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire(options);
    const link = hqNavigationLink({ orgId: "org", wire: fixture.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    const navigation = (
      type: "scope-reset" | "scope-values",
      revision: number,
      values: ReadonlyArray<{ key: string; value: unknown }>,
    ) =>
      Effect.andThen(
        fixture.send({
          type,
          scope: { kind: "navigation" },
          incarnation: "hq",
          revision,
          values,
          removals: [],
        }),
        type === "scope-reset"
          ? fixture.send({
              type: "scope-ready",
              core: { protocol: 1 },
              scope: { kind: "navigation" },
              incarnation: "hq",
              revision,
            })
          : Effect.void,
      );
    const current = () => orgPersonaTemplates.derive(readsOfState(store.state()), "org");
    return { navigation, current, fixture, stop: Fiber.interrupt(fiber) };
  });

it.effect("an organization's persona templates show as HQ's navigation sends them, kept live", () =>
  Effect.gen(function* () {
    const { navigation, current, stop } = yield* observe();
    yield* navigation("scope-reset", 1, [
      { key: "persona-templates", value: { orgId: "org", templates: [TEMPLATE] } },
    ]);
    yield* settle;
    expect(current()).toEqual({ state: "ready", templates: [TEMPLATE], failure: null });
    const edited = { ...TEMPLATE, instructions: "Review twice.", revision: 2 };
    yield* navigation("scope-values", 2, [
      { key: "persona-templates", value: { orgId: "org", templates: [edited] } },
    ]);
    yield* settle;
    expect(current()).toEqual({ state: "ready", templates: [edited], failure: null });
    yield* stop;
  }),
);

it.effect(
  "an HQ whose complete navigation carries no persona templates reads as unavailable, never as loading",
  () =>
    Effect.gen(function* () {
      const { navigation, current, stop } = yield* observe();
      expect(current()).toEqual({ state: "loading" });
      yield* navigation("scope-reset", 1, [
        { key: "auto-update-policy", value: { orgId: "org", enabled: true, revision: 1 } },
      ]);
      yield* settle;
      expect(current()).toEqual({ state: "unavailable" });
      yield* stop;
    }),
);

it.effect(
  "an HQ that refuses the organization's link reads as a failure with its cause, never as loading",
  () =>
    Effect.gen(function* () {
      const { current, stop } = yield* observe({ open: () => Effect.fail(classifyHqClose(4403)) });
      yield* settle;
      expect(current()).toEqual({
        state: "failed",
        failure: "Zerops refused HQ's access. Check HQ's access in Zerops, then try again.",
      });
      yield* stop;
    }),
);

it.effect(
  "an HQ without persona templates stays unavailable through a dropped link, and a known list says it may be out of date once HQ refuses",
  () =>
    Effect.gen(function* () {
      const { navigation, current, fixture, stop } = yield* observe();
      yield* navigation("scope-reset", 1, []);
      yield* settle;
      yield* fixture.drop({ outcome: "transient", message: "HQ's stream broke." });
      yield* settle;
      expect(current()).toEqual({ state: "unavailable" });

      const known = yield* observe();
      yield* known.navigation("scope-reset", 1, [
        { key: "persona-templates", value: { orgId: "org", templates: [TEMPLATE] } },
      ]);
      yield* settle;
      yield* known.fixture.drop(classifyHqClose(4403));
      yield* settle;
      expect(known.current()).toEqual({
        state: "ready",
        templates: [TEMPLATE],
        failure: "Zerops refused HQ's access. Check HQ's access in Zerops, then try again.",
      });
      yield* known.stop;
      yield* stop;
    }),
);

it.effect.each([
  {
    title:
      'a templates record this version cannot read is a failure, never "doesn\'t offer templates yet"',
    value: { orgId: "org", templates: "every one" },
    reads: {
      state: "failed",
      failure: "HQ sent persona templates in a form this version of Mate doesn't read.",
    },
  },
  {
    title: "a template this version cannot read is left out and said, and the others still show",
    value: { orgId: "org", templates: [TEMPLATE, { id: "t-2", name: 7 }] },
    reads: {
      state: "ready",
      templates: [TEMPLATE],
      failure: "HQ sent a persona template in a form this version of Mate doesn't read.",
    },
  },
])("$title", ({ value, reads }) =>
  Effect.gen(function* () {
    const { navigation, current, stop } = yield* observe();
    yield* navigation("scope-reset", 1, [{ key: "persona-templates", value }]);
    yield* settle;
    expect(current()).toEqual(reads);
    yield* stop;
  }),
);
