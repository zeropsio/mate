/**
 * A test-only `ProviderRegistry` fake, owned by the SPI seam.
 *
 * `ProviderRegistry` (configured-provider snapshots — a different concern
 * from `ProviderRuntimeEventBus`'s runtime events) is a real dependency of
 * some owned-product code (`GitManager`, via `TextGeneration`). A test that
 * exercises that code but never actually reads provider snapshots still has
 * to satisfy the tag. Reaching for the real `provider/Services/ProviderRegistry.ts`
 * from a file under `apps/server/src/zerops/**` would import driver
 * internals from outside the SPI — `spi/**` is the only owned place allowed
 * to do that — so this file is the one place that import happens, and
 * `zerops/**` tests import the fake from here instead.
 *
 * @module ProviderRegistryTest
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

export const ProviderRegistryTest = {
  /**
   * No configured providers. `getProviders` is the only member most callers
   * touch; everything else dies loudly if exercised (the same default
   * `Layer.mock` gives an omitted member), so an unexpected new dependency
   * on this fake fails fast instead of silently returning empty/success.
   */
  empty: (): Layer.Layer<ProviderRegistry> =>
    Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) }),
};

/**
 * A test-only `ProviderInstanceRegistry` with no live instance, for the same
 * reason: `ProviderInstances` reads an instance's adapter through it.
 */
export const ProviderInstanceRegistryTest = {
  empty: (): Layer.Layer<ProviderInstanceRegistry> =>
    Layer.mock(ProviderInstanceRegistry)({ getInstance: () => Effect.undefined }),
};
