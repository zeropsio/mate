/**
 * driverHomes — the owned, typed "where is this provider's config home"
 * capability. `textGeneration/**` (Claude's launch environment) and
 * `usage/**` (transcript scanning) both need to know where the Claude /
 * Codex CLIs keep their config, but that resolution is filesystem/home-dir
 * knowledge that belongs to the ported drivers
 * (`provider/Drivers/ClaudeHome.ts`, `provider/Drivers/CodexHomeLayout.ts`).
 *
 * This module is the ONE place that imports those driver files. A port that
 * renames/removes a field this module reads (or changes what
 * `makeClaudeEnvironment` does to the environment) fails `driverHomes.test.ts`,
 * not a random call site in `textGeneration/` or `usage/`.
 *
 * `CodexHomeLayout` below is an OWNED structural mirror of the identically-named
 * interface in `provider/Drivers/CodexHomeLayout.ts` — not a re-export. If the
 * driver's shape drifts (a field renamed, narrowed, or dropped), the
 * assignment inside `codexHomeLayout` stops type-checking right here.
 *
 * @module driverHomes
 */
import type { ClaudeSettings, CodexSettings, ProviderInstanceConfig } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import type * as Path from "effect/Path";

import { makeClaudeEnvironment, resolveClaudeHomePath } from "../provider/Drivers/ClaudeHome.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { mergeProviderInstanceEnvironment } from "../provider/ProviderInstanceEnvironment.ts";

/**
 * The resolved location of a Codex "home" (config/session/auth directory)
 * pair. `sharedHomePath` is the directory Codex's own CLI reads/writes;
 * `effectiveHomePath` is only set in "authOverlay" mode, where a private
 * shadow directory holds `auth.json` separately from the shared directory
 * (see `provider/Drivers/CodexHomeLayout.ts` for why).
 */
export interface CodexHomeLayout {
  readonly mode: "direct" | "authOverlay";
  readonly sharedHomePath: string;
  readonly effectiveHomePath: string | undefined;
  readonly continuationKey: string;
}

/** Resolves the directory the Claude CLI reads its config from. */
export function claudeHomePath(
  config: Pick<ClaudeSettings, "homePath">,
): Effect.Effect<string, never, Path.Path> {
  return resolveClaudeHomePath(config);
}

/**
 * Builds the environment to spawn the Claude CLI with: unchanged unless a
 * custom home is configured, in which case `CLAUDE_CONFIG_DIR` is set to
 * the resolved home and `HOME` is left alone (overriding `HOME` breaks the
 * macOS keychain lookup the CLI needs for its stored OAuth credentials —
 * see the doc comment on `makeClaudeEnvironment` in the driver).
 */
export function claudeEnvironment(
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return makeClaudeEnvironment(config, baseEnv);
}

/** Resolves where the Codex CLI's config/session directory pair lives. */
export function codexHomeLayout(
  config: CodexSettings,
): Effect.Effect<CodexHomeLayout, never, Path.Path> {
  return resolveCodexHomeLayout(config);
}

/**
 * The environment a provider instance's CLI runs with: the host environment
 * with the instance's own variables (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, ...)
 * laid over it, last value winning.
 */
export function providerInstanceEnvironment(
  environment: ProviderInstanceConfig["environment"],
  baseEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return mergeProviderInstanceEnvironment(environment, baseEnv);
}
