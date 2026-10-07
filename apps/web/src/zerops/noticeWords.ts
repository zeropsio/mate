import { signedOutAgent } from "@t3tools/client-runtime/zerops";

/** Expected provider pauses use the same words in the menu and conversation. */
export function usageLimitProvider(error: string | null | undefined): string | null {
  if (!error) return null;
  const matched =
    /^(Claude(?: AI)?|Codex|Grok|OpenCode|Cursor|Antigravity) usage limit reached\b/i.exec(
      error.trim(),
    );
  if (matched) return matched[1]!.replace(/ AI$/i, "");
  return /^you[’']ve hit your [\w\s-]*?limit\b/i.test(error.trim()) ? "coding agent" : null;
}

export function usageLimitWords(provider: string, reset?: string, mateName = "The Mate"): string {
  const name = provider === "coding agent" ? "coding agent's" : provider;
  return reset === undefined
    ? `${mateName} hit the ${name} limit.`
    : `${mateName} hit the ${name} limit — can continue at ${reset}.`;
}

/** Expected refusals have one voice across the web menu, conversation and jump box. */
export function mateFailureWords(
  error: string,
  driver?: string | null,
  mateName = "The Mate",
): string {
  const limit = usageLimitProvider(error);
  if (limit !== null) return usageLimitWords(limit, undefined, mateName);
  const agent = signedOutAgent(error, driver);
  return agent === null ? error : `${mateName} needs a ${agent} sign-in to continue.`;
}
