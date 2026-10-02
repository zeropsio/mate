export const DISCONNECTED_COMPOSER_PLACEHOLDER =
  "Ask for changes, send follow-ups, or attach images";

export const DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";

export const ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER = "Describe what you want to build or change…";

/**
 * What the composer says while it waits, before and after its link is made. A Mate's
 * conversation says one thing from its first frame — the stand-in's words, before its link is
 * made and after — where it said upstream's "Ask for changes…" until it connected and the plain
 * task words only once the project was read (pass 30).
 */
export function resolveComposerPlaceholders(input: {
  /** A Mate lives where this conversation runs, read or remembered. */
  readonly mateHere: boolean;
  readonly zeropsAvailable: boolean;
}): { readonly connected: string; readonly idle: string } {
  if (input.mateHere || input.zeropsAvailable) {
    return {
      connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
    };
  }
  return {
    connected: DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
    idle: DISCONNECTED_COMPOSER_PLACEHOLDER,
  };
}
