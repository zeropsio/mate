/**
 * A project's core package and the run section a Mate's missing deployment is created with
 * (`buildZcpDeploymentYaml`). A Mate's container itself is imported by HQ's birth.
 */
export type RandomBytes = (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

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
