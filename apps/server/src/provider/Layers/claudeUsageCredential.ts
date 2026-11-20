import type { AccountInfo } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSettings } from "@t3tools/contracts";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";

import { readClaudeSettingsAuthEnv } from "../Drivers/ClaudeSkills.ts";

export function customClaudeEndpoint(baseUrl: string | undefined): boolean {
  const endpoint = URL.parse(baseUrl?.trim() ?? "");
  return (
    endpoint !== null &&
    (endpoint.protocol === "http:" || endpoint.protocol === "https:") &&
    endpoint.hostname !== "" &&
    endpoint.hostname !== "api.anthropic.com"
  );
}

/** Identify the login seen by SDK initialization. A subscription keeps its identity across OAuth refreshes. */
export const claudeCredentialFingerprint = Effect.fnUntraced(function* (
  account: AccountInfo,
  settings: Pick<ClaudeSettings, "homePath">,
  environment: NodeJS.ProcessEnv,
  cwd: string | undefined,
) {
  if (account.apiProvider !== undefined && account.apiProvider !== "firstParty") return undefined;
  const configured = yield* readClaudeSettingsAuthEnv(settings, cwd, environment, "workspace");
  if (customClaudeEndpoint(configured.ANTHROPIC_BASE_URL ?? environment.ANTHROPIC_BASE_URL))
    return undefined;

  let source = account.tokenSource;
  if (!source || source === "none") source = account.apiKeySource;

  let identity: string | undefined;
  if (source === "claude.ai") {
    identity = account.email?.trim().toLowerCase();
  } else if (
    source === "CLAUDE_CODE_OAUTH_TOKEN" ||
    source === "ANTHROPIC_AUTH_TOKEN" ||
    source === "ANTHROPIC_API_KEY"
  ) {
    identity = configured[source] ?? environment[source];
  }
  if (!identity) return undefined;

  const bytes = new TextEncoder().encode(`${source}\0${identity}`);
  return yield* Digest.Digest.use((digest) => digest.digestHex(Digest.sha256, bytes)).pipe(
    Effect.provide(Digest.layerWebCrypto),
  );
});
