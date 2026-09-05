/**
 * usageLimitsSupport — the owned, typed "shared usage-limits helpers"
 * capability. `apps/server/src/usage/cliproxyUsageLimits.ts` normalises a
 * CLIProxyAPI hub's reported quota into the same `ServerProviderUsageLimits`
 * shape a driver's own snapshot uses, and needs Codex's plan-label mapping to
 * describe a pooled account the way a direct Codex login would be described.
 * Both live in the ported zone (`provider/providerUsageLimits.ts`,
 * `provider/Layers/CodexProvider.ts`).
 *
 * This module is the ONE place `usage/**` may reach into `provider/**` for
 * these two things — `scripts/mate-zone-architecture.test.ts`'s
 * "textGeneration/ and usage/ reach provider internals only through spi/"
 * rule enforces it. A port that renames or reshapes either function fails
 * here, not at the cliproxy call site.
 *
 * @module usageLimitsSupport
 */
import { codexPlanLabel } from "../provider/Layers/CodexProvider.ts";
import { clampPercent, makeUsageLimits } from "../provider/providerUsageLimits.ts";

export { clampPercent, codexPlanLabel, makeUsageLimits };
