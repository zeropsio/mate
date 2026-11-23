/**
 * A Mate's container as the platform knows it: the coding agents a container offers, a project's
 * core package, and the run section a Mate's missing deployment is created with
 * (`buildZcpDeploymentYaml`). A Mate's container itself is imported by HQ's birth.
 */
export type RandomBytes = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

/**
 * The coding agents the platform's zcp recipe knows how to configure —
 * `SUPPORTED_AGENT_TYPES` from the GUI's `zerops-services.model.ts`, the
 * narrower of its two agent-type lists (it excludes `opencode-ai`, which the
 * GUI's own picker does not surface either).
 */
export type ZeropsAgentType = "claude-code" | "codex" | "antigravity" | "grok" | "cursor";

/**
 * Fixed render order for `ZCP_AGENTS` and `ZCP_AGENT_AUTH_TYPE_*`, independent
 * of caller order — the GUI emits its own agent keys in selection order, but
 * ours deliberately doesn't: a stable document, and for `ZCP_AGENTS` the
 * order the container's bootstrap presents agents in.
 */
export const ZEROPS_AGENT_TYPE_CANONICAL_ORDER: ReadonlyArray<ZeropsAgentType> = [
  "claude-code",
  "codex",
  "antigravity",
  "grok",
  "cursor",
];

/** Mirrors the GUI's `agentTypeToEnvSuffix`: uppercase, hyphens to underscores. */
export function agentTypeToEnvSuffix(agentType: ZeropsAgentType): string {
  return agentType.toUpperCase().replace(/-/g, "_");
}

/**
 * A Zerops project's core package: `LIGHT` (Lightweight, free) or `SERIOUS` (Serious, paid), which
 * the platform takes as the project's `mode` at birth.
 */
export type ZeropsCorePackage = "LIGHT" | "SERIOUS";

/**
 * ZEROPS_YAML stores one setup block. Preserve its run section verbatim and leave behind the
 * retired empty-artifact build section. No env values or other service settings are regenerated.
 */
export function buildZcpDeploymentYaml(serviceName: string, savedSetup: string): string {
  const lines = savedSetup.trimEnd().split(/\r?\n/);
  const start = lines.findIndex((line) => /^run:\s*$/.test(line));
  if (start < 0) throw new Error("The Mate's saved run configuration is unavailable.");
  const after = lines.findIndex((line, index) => index > start && /^[^\s#]/.test(line));
  const run = lines
    .slice(start, after < 0 ? undefined : after)
    .join("\n")
    .trimEnd();
  if (!run.includes("\n")) throw new Error("The Mate's saved run configuration is unavailable.");
  return `zerops:\n  - setup: ${serviceName}\n${run
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")}`;
}
