import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/reactivity";
import { hqFixtureWire } from "../__fixtures__/hqWire.ts";
import { settle } from "../__fixtures__/zeropsWire.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { superviseLink } from "../supervisor.ts";
import { autoUpdatePolicySettings } from "../projections/hqAutoUpdatePolicy.ts";
import { hqNavigationLink } from "./hq.ts";

it.effect("settings observes another admin's changes and a fresh Core's lower revision", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const link = hqNavigationLink({ orgId: "org", wire: fixture.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    const show = (
      incarnation: string,
      revision: number,
      enabled: boolean,
      type: "scope-reset" | "scope-values",
    ) =>
      fixture.send({
        type,
        scope: { kind: "navigation" },
        incarnation,
        revision,
        values: [{ key: "auto-update-policy", value: { orgId: "org", enabled, revision } }],
        removals: [],
      });
    const current = () =>
      autoUpdatePolicySettings.derive(readsOfState(store.state()), { orgId: "org", admin: true });
    yield* show("old-hq", 8, false, "scope-reset");
    yield* fixture.send({
      type: "scope-ready",
      core: { protocol: 1, autoUpdatePolicy: 1 },
      scope: { kind: "navigation" },
      incarnation: "old-hq",
      revision: 8,
    });
    yield* settle;
    expect(current()).toMatchObject({ enabled: false, editable: true, words: "Off" });
    yield* show("old-hq", 9, true, "scope-values");
    yield* settle;
    expect(current()).toMatchObject({ enabled: true, words: "On" });
    yield* show("old-hq", 10, false, "scope-values");
    yield* show("fresh-hq", 0, true, "scope-reset");
    yield* fixture.send({
      type: "scope-ready",
      core: { protocol: 1, autoUpdatePolicy: 1 },
      scope: { kind: "navigation" },
      incarnation: "fresh-hq",
      revision: 0,
    });
    yield* settle;
    expect(current()).toMatchObject({ enabled: true, editable: true, words: "On" });
    yield* Fiber.interrupt(fiber);
  }),
);

it.effect("an existing HQ without policy streaming gives an actionable upgrade state", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const fixture = hqFixtureWire();
    const link = hqNavigationLink({ orgId: "org", wire: fixture.wire, store });
    const supervisor = yield* superviseLink({ ...link, store, repairSession: Effect.void });
    const fiber = yield* Effect.forkChild(supervisor.run);
    yield* settle;
    yield* fixture.send({
      type: "scope-reset",
      scope: { kind: "navigation" },
      incarnation: "old",
      revision: 1,
      values: [],
      removals: [],
    });
    yield* fixture.send({
      type: "scope-ready",
      scope: { kind: "navigation" },
      incarnation: "old",
      revision: 1,
      core: { protocol: 1 },
    });
    yield* settle;
    expect(
      autoUpdatePolicySettings.derive(readsOfState(store.state()), { orgId: "org", admin: true }),
    ).toMatchObject({
      editable: false,
      enabled: null,
      words: "Update HQ Core to manage automatic Mate updates.",
    });
    yield* Fiber.interrupt(fiber);
  }),
);
