import { PROVIDER_DISPLAY_NAMES, type ProviderDriverKind } from "@t3tools/contracts";

/** The agent as the person knows it: the product it runs, not its driver's id. */
const AGENT_NAMES: Partial<Record<string, string>> = { claudeAgent: "Claude Code" };

/**
 * What the conversation says when an agent's process died in the middle of
 * its turn, whatever the driver: that it stopped, and what to do next. Its
 * exit code, signal and stderr are the log's, never the person's.
 */
export function agentStoppedUnexpectedly(provider: ProviderDriverKind | string): string {
  const name =
    AGENT_NAMES[provider] ?? PROVIDER_DISPLAY_NAMES[provider as ProviderDriverKind] ?? "The agent";
  return `${name} stopped unexpectedly. Send a message to pick up where it left off.`;
}
