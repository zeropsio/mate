/**
 * The environment a `/{environmentId}/{threadId}` pathname targets, or null
 * for every other two-segment route. The root guard shows "not reachable" for
 * a targeted environment that is not available, so a non-environment prefix
 * must never be mistaken for one — `/draft/<id>` is a conversation that has
 * no environment yet, not a missing environment called "draft".
 */
const NON_ENVIRONMENT_PREFIXES = new Set(["draft", "settings", "zerops", "projects"]);

export function environmentIdFromPathname(pathname: string): string | null {
  const match = /^\/([^/]+)\/[^/]+\/?$/.exec(pathname);
  const prefix = match?.[1];
  if (prefix === undefined || NON_ENVIRONMENT_PREFIXES.has(prefix)) return null;
  return prefix;
}
