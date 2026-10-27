import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, UsageDay } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import type { NetworkStatus } from "../connection/model.ts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import { createServerEnvironmentAtoms } from "./server.ts";

describe("mobile usage later", () => {
  it.effect(
    "the deferred native usage path is unavailable immediately without calling a removed provider reader",
    () =>
      Effect.gen(function* () {
        const entries = yield* SubscriptionRef.make<
          ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>
        >(new Map());
        const networkStatus = yield* SubscriptionRef.make<NetworkStatus>("unknown");
        const atoms = createServerEnvironmentAtoms(
          Atom.runtime(
            Layer.merge(
              Layer.mock(EnvironmentRegistry, {
                entries,
                networkStatus,
              }),
              Layer.mock(EnvironmentCacheStore, {}),
            ),
          ),
          {
            initialConfigValueAtom: () => Atom.make(null),
          },
        );
        const registry = yield* Effect.acquireRelease(Effect.sync(AtomRegistry.make), (registry) =>
          Effect.sync(() => registry.dispose()),
        );
        const result = registry.get(
          atoms.usageSummary({
            environmentId: EnvironmentId.make("mate"),
            input: {
              sinceDay: UsageDay.make("2026-10-01"),
              untilDay: UsageDay.make("2026-10-07"),
              timeZone: "UTC",
            },
          }),
        );
        expect(result).toMatchObject({ _tag: "Failure", waiting: false });
        expect(Option.isNone(AsyncResult.value(result))).toBe(true);
      }),
  );
});
