/**
 * claudeProviderTest — owned test-only fixtures for the `claudeProvider.ts`
 * capability. Mirrors the `ProviderRegistryTest.ts`/`ProviderInstanceTest.ts`
 * pattern (spi.md §6): a synthetic catalog — every model, alias, capability
 * and runtime mapping made up, none real — lets a test outside `spi/**`
 * (`textGeneration/ClaudeTextGeneration.test.ts`) exercise
 * `ClaudeTextGeneration.ts` without importing ported-zone internals directly
 * or depending on the bundled/remote model manifest.
 *
 * @module claudeProviderTest
 */
export {
  SYNTHETIC_CLAUDE_CAPABLE_MODEL,
  SYNTHETIC_CLAUDE_COLLIDING_ALIAS,
  SYNTHETIC_CLAUDE_MODEL_CATALOG,
  SYNTHETIC_CLAUDE_STANDARD_MODEL,
  SYNTHETIC_CLAUDE_THINKING_MODEL,
} from "../provider/ClaudeModelCatalog.testFixtures.ts";
