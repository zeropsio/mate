/**
 * A test-only alias for the driver-internal `ProviderInstance` shape,
 * owned by the SPI seam.
 *
 * Production code under `textGeneration/**` never needs the full
 * `ProviderInstance` type — `TextGeneration.ts`'s `resolveInstance` only
 * ever reaches for the `textGeneration` field, whose type is `TextGeneration["Service"]`
 * itself (a self-reference, not a driver import; see `TextGeneration.ts`).
 * But `TextGeneration.test.ts` builds a full fake `ProviderInstance` to
 * satisfy `ProviderInstanceRegistry["Service"]["getInstance"]`'s return
 * type — reaching for `provider/ProviderDriver.ts` directly from a file
 * under `apps/server/src/textGeneration/**` would import driver internals
 * from outside the SPI, so this file is the one place that import happens
 * (mirrors `ProviderRegistryTest.ts`'s rationale for the same directory).
 *
 * @module ProviderInstanceTest
 */
export type { ProviderInstance } from "../provider/ProviderDriver.ts";
