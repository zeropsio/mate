export const DISCONNECTED_COMPOSER_PLACEHOLDER =
  "Ask for changes, send follow-ups, or attach images";

export const DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER =
  "Ask anything, @tag files/folders, $use skills, or / for commands";

export const ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER = "Describe what you want to build or change…";

/**
 * What the composer says while it waits, before and after its link is made. A Mate's
 * conversation says one thing — the stand-in's words, before its link is made and after — where it
 * said upstream's "Ask for changes…" until it connected and the plain task words only once the
 * project was read (pass 30). Before the directory says who lives there it says nothing: no
 * upstream words to flip from, nothing guessed.
 */
export function resolveComposerPlaceholders(input: {
  /** Who lives where this conversation runs, as the directory has read it. */
  readonly whoLivesHere: "mate" | "nobody" | "unknown";
  readonly zeropsAvailable: boolean;
}): { readonly connected: string; readonly idle: string } {
  if (input.whoLivesHere === "mate" || input.zeropsAvailable) {
    return {
      connected: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
      idle: ZEROPS_CONNECTED_COMPOSER_PLACEHOLDER,
    };
  }
  if (input.whoLivesHere === "unknown") return { connected: "", idle: "" };
  return {
    connected: DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
    idle: DISCONNECTED_COMPOSER_PLACEHOLDER,
  };
}
