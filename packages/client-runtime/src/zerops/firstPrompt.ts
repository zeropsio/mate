/**
 * The first thing said in a newly connected Zerops environment.
 *
 * zcp only introduces itself once a conversation exists, so a freshly
 * connected project would otherwise open on an empty thread with no sign that
 * anything is there. This composes one opening message — exactly once per
 * environment, and only for environments reached through the Zerops door: a
 * manually paired backend is somebody else's setup and must not be written
 * into.
 */

export const ZEROPS_FIRST_PROMPT_STORAGE_KEY = "zerops-code.first-prompt.v1";

/** Which registered environments were reached through the Zerops door. */
export const ZEROPS_ENVIRONMENTS_STORAGE_KEY = "zerops-code.zerops-environments.v1";

export const ZEROPS_ONBOARDING_PROMPT =
  "I just opened Zerops Code on this project. Introduce yourself, tell me what is running here, and what we could do next.";

/** How the environment came to be registered. */
export type ZeropsConnectionOrigin = "zerops-identity" | "pairing";

export function shouldComposeFirstPrompt(input: {
  readonly environmentId: string;
  readonly alreadyComposed: ReadonlyArray<string>;
  readonly connectedVia: ZeropsConnectionOrigin;
}): boolean {
  // A manually paired environment is not ours to open a conversation in.
  if (input.connectedVia !== "zerops-identity") return false;
  if (!input.environmentId) return false;
  return !input.alreadyComposed.includes(input.environmentId);
}

export function withFirstPromptComposed(
  alreadyComposed: ReadonlyArray<string>,
  environmentId: string,
): ReadonlyArray<string> {
  return alreadyComposed.includes(environmentId)
    ? alreadyComposed
    : [...alreadyComposed, environmentId];
}

/** Parses the marker list, treating anything unexpected as "nothing composed yet". */
export function parseFirstPromptMarkers(raw: string | null): ReadonlyArray<string> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
  } catch {
    return [];
  }
}
