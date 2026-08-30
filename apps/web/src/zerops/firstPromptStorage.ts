/**
 * Keeps first-prompt storage synchronous at the web boundary. The shared
 * `ZeropsStorageAdapter` is async, so using it here would make
 * `composeZeropsFirstPrompt` and its route caller async as well.
 */
import {
  ZEROPS_ENVIRONMENTS_STORAGE_KEY,
  ZEROPS_FIRST_PROMPT_STORAGE_KEY,
  parseFirstPromptMarkers,
  withFirstPromptComposed,
  type ZeropsConnectionOrigin,
} from "@t3tools/client-runtime/zerops/firstPrompt";

export function readFirstPromptMarkers(): ReadonlyArray<string> {
  return readStringList(ZEROPS_FIRST_PROMPT_STORAGE_KEY);
}

export function rememberFirstPromptComposed(environmentId: string): void {
  // Worst case the record is lost and the prompt is composed again, which is a
  // filled-in composer, not a sent message.
  appendStringList(ZEROPS_FIRST_PROMPT_STORAGE_KEY, environmentId);
}

function readStringList(key: string): ReadonlyArray<string> {
  try {
    return parseFirstPromptMarkers(window.localStorage.getItem(key));
  } catch {
    return [];
  }
}

function appendStringList(key: string, value: string): void {
  try {
    const next = withFirstPromptComposed(readStringList(key), value);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // See above: losing the record only costs a second composed prompt.
  }
}

/** Records that this environment came from the Zerops door, not from pairing. */
export function rememberZeropsEnvironment(environmentId: string): void {
  appendStringList(ZEROPS_ENVIRONMENTS_STORAGE_KEY, environmentId);
}

export function connectionOriginFor(environmentId: string): ZeropsConnectionOrigin {
  return readStringList(ZEROPS_ENVIRONMENTS_STORAGE_KEY).includes(environmentId)
    ? "zerops-identity"
    : "pairing";
}
