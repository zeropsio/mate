/**
 * usageLimitsSupport — the owned, typed "shared usage-limits helpers"
 * capability. `apps/server/src/usage/cliproxyApi.ts` reads a CLIProxyAPI
 * hub's accounts and turns each one into the same `ServerProviderUsageLimits`
 * shape a driver's own snapshot uses: the hub relays the providers' own usage
 * responses, so it needs the drivers' normalisers (Codex rate limits and
 * reset credits, Claude's `get_usage` response), Codex's plan-label mapping,
 * and the unavailable-limits shape for an account the hub cannot read. All of
 * them live in the ported zone (`provider/Layers/{CodexProvider,
 * codexUsageLimits,claudeUsageLimits}.ts`, `provider/providerUsageLimits.ts`).
 *
 * This module is the ONE place `usage/**` may reach into `provider/**` for
 * these — `scripts/mate-zone-architecture.test.ts`'s "textGeneration/ and
 * usage/ reach provider internals only through spi/" rule enforces it.
 * `usageLimitsSupport.test.ts` pins the behaviour of every re-export, so a
 * port that renames or reshapes one fails here, not at the hub call site.
 *
 * @module usageLimitsSupport
 */
import { claudeUsageResponseToLimits } from "../provider/Layers/claudeUsageLimits.ts";
import { codexPlanLabel } from "../provider/Layers/CodexProvider.ts";
import { codexRateLimitsToLimits } from "../provider/Layers/codexUsageLimits.ts";
import { makeUnavailableUsageLimits } from "../provider/providerUsageLimits.ts";

export {
  claudeUsageResponseToLimits,
  codexPlanLabel,
  codexRateLimitsToLimits,
  makeUnavailableUsageLimits,
};
