/**
 * agentSignInChecks — how the drivers read their agents' own sign-in commands,
 * for Mate's sign-in check (`zerops/ZeropsAgentAuthVerify.ts`): Antigravity's
 * `agy models` and Grok's `grok models` are each read in one place, and
 * Antigravity's check runs without the variables its driver never passes on.
 *
 * This module is the one place `zerops/**` reaches those readings.
 *
 * @module agentSignInChecks
 */
export { GOOGLE_BILLING_VARIABLES } from "../provider/acp/AntigravityAcpSupport.ts";
export { parseAgyModelsAuth } from "../provider/Layers/AntigravityProvider.ts";
export { parseGrokModelsCliOutput } from "../provider/Layers/GrokProvider.ts";
