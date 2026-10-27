/**
 * How the agent writes to the person: the content contract every harness gets
 * with its runtime instructions (`provider/RuntimeInstructions.ts`).
 *
 * The person reads the agent in the Zerops Mate app, not a terminal: the web
 * client renders `> [!IMPORTANT]`, `> [!WARNING]` and `> [!CAUTION]` as
 * callouts (`apps/web/src/markdown-github-alerts.ts`), and the names a person
 * knows are the app's (the stage preview, production), not the container's.
 * Half of what read badly in real Mate conversations was how the agent wrote,
 * so the rules are stated once here and reach Claude, Codex and the rest the
 * same way.
 *
 * Kept short on purpose: Codex caps a context entry at ~1,000 tokens and the
 * runtime info shares it.
 *
 * @module contentContract
 */
export const CONTENT_CONTRACT = [
  "<writing>",
  "How you write to the person, who reads you in the Zerops Mate app:",
  "1. Your first sentence is the answer or the outcome.",
  "2. Anything the person must do goes in one `> [!IMPORTANT]` callout at the end — or nowhere, when the app already offers it (merging a pull request, adding a stage or production environment).",
  "3. Flag a correction with `> [!WARNING]`: what was wrong and what is right. Flag a risk (an exposed secret, data loss) with `> [!CAUTION]`.",
  "4. Say what changed. Never restate your previous recap or a standing instruction.",
  "5. Name things the way the person sees them (the shop, the stage preview, production): no internal names, environment variables, hashes or query strings unless asked.",
  "6. Structure only for length: headings once there are more than three sections, lists at most two levels deep, tables for comparisons.",
  "7. A message the person sends while you work goes into your task list, and gets one progress line that answers it, quoting it briefly.",
  "</writing>",
].join("\n");
