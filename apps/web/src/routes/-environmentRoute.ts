/**
 * The environment a `/{environmentId}/{threadId}` pathname targets, or null
 * for every other two-segment route. The root's route gate judges the
 * environment this names, so a non-environment prefix must never be mistaken
 * for one — `/draft/<id>` is a conversation that has no environment yet, not
 * a missing environment called "draft".
 */
const NON_ENVIRONMENT_PREFIXES = new Set(["draft", "settings", "zerops", "projects"]);

export function environmentIdFromPathname(pathname: string): string | null {
  const match = /^\/([^/]+)\/[^/]+\/?$/.exec(pathname);
  const prefix = match?.[1];
  if (prefix === undefined || NON_ENVIRONMENT_PREFIXES.has(prefix)) return null;
  return prefix;
}

/** The draft a `/draft/{draftId}` pathname opens, or null for every other route. */
export function draftIdFromPathname(pathname: string): string | null {
  return /^\/draft\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
}
