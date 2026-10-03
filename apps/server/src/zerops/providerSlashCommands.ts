/**
 * The slash commands a Mate's menu offers: every one an agent lists, less
 * those that cannot work in a Mate.
 *
 * An agent's own list is written for its terminal. Claude Code's SDK lists
 * its interactive commands too, and a Mate runs each headless: the CLI
 * answers with text the conversation shows, or hands the command to the
 * model. A few answer and still do nothing a Mate can see, or act behind a
 * control Mate owns; those go. Every list a client receives — the global one
 * and each workspace's, which replaces it — goes through this, so web and
 * mobile offer the same commands.
 *
 * Pure: no network, no clock.
 *
 * @module providerSlashCommands
 */
import type { ServerProvider, ServerProviderSlashCommand } from "@t3tools/contracts";

/**
 * Claude Code commands a Mate cannot use. Each was run headless the way the
 * SDK runs it (Claude Code 2.1.278, stream-json, 2026-10-03); every other
 * built-in answered with text or ran the model.
 */
const CLAUDE_UNWORKABLE: ReadonlySet<string> = new Set([
  // The model picker owns these: the CLI switching by itself leaves the picker
  // naming a model or effort the agent no longer runs. Mate's own /model stays.
  "model",
  "effort",
  "fast",
  // Empties the agent's context without a word while the conversation still
  // shows it; a new conversation is Mate's way to start over.
  "clear",
  // A session name and a prompt-bar colour exist only in the CLI's terminal.
  "rename",
  "color",
  // Writes a heap dump into the container, where no one can open it.
  "heapdump",
  // Removed upstream: it prints only that it is gone.
  "agents",
  // The old name of /usage-credits, which stays.
  "extra-usage",
  // Plumbing for server-launched sessions; anywhere else it prints an error.
  "__remote-workflow",
  "workflow-launch-exec",
  "auto-mode-setup",
]);

const UNWORKABLE: Readonly<Record<string, ReadonlySet<string>>> = {
  claudeAgent: CLAUDE_UNWORKABLE,
};

export function withoutUnworkableSlashCommands(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  return providers.map((provider) => {
    const unworkable = UNWORKABLE[provider.driver];
    if (unworkable === undefined) return provider;
    const workable = (commands: ReadonlyArray<ServerProviderSlashCommand>) =>
      commands.filter((command) => !unworkable.has(command.name));
    return {
      ...provider,
      slashCommands: workable(provider.slashCommands),
      ...(provider.workspaceSnapshots
        ? {
            workspaceSnapshots: provider.workspaceSnapshots.map((snapshot) => ({
              ...snapshot,
              slashCommands: workable(snapshot.slashCommands),
            })),
          }
        : {}),
    };
  });
}
