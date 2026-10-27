/**
 * Which service types are infrastructure an app uses rather than an app's own runtime or data.
 *
 * The platform reports a pool (`swarm@1`, `swarm-vm@1`) with category `USER` — the same as an app
 * runtime such as `ubuntu/python@3.12` — and a Box (`ubuntu/zbox@1`) with category `STANDARD`, the
 * same as a managed database. The category cannot tell them apart; the type-version string can, so
 * every site that must keep a pool or a Box out of the runtime, data, pair and checkout readings
 * asks here.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module infrastructureType
 */

/**
 * A type-version can carry an OS prefix — the platform reports runtimes as `ubuntu/nodejs@22`, not
 * `nodejs@22`. Managed types use a different separator (`valkey:single@7.2`), so only a leading
 * `<os>/` segment is stripped.
 */
export const withoutOsPrefix = (type: string): string => {
  const separator = type.indexOf("/");
  return separator < 0 ? type : type.slice(separator + 1);
};

/** The type's name before its `@version`, lower-cased and without an OS prefix. */
const typeName = (type: string): string => {
  const bare = withoutOsPrefix(type.toLowerCase());
  const at = bare.indexOf("@");
  return at < 0 ? bare : bare.slice(0, at);
};

/** A pool: `Swarm` (`swarm@1`) or `Swarm VM` (`swarm-vm@1`), any case, with or without an OS prefix. */
export function isPoolServiceType(type: string): boolean {
  const name = typeName(type);
  return name === "swarm" || name === "swarm-vm";
}

/** A Box: `Box Workspace` (`ubuntu/zbox@1`, `zbox@1`). */
export function isSandboxServiceType(type: string): boolean {
  return typeName(type) === "zbox";
}

/** A pool or a Box: infrastructure an app uses, never an app's dev or stage runtime, nor its data. */
export function isPoolOrSandboxServiceType(type: string): boolean {
  return isPoolServiceType(type) || isSandboxServiceType(type);
}
