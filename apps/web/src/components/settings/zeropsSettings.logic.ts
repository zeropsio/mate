/** Where the person's own sign-in tokens' cleanup stands, as Settings → Zerops says it. */
export type SignInTokensCleanup = "idle" | "running" | "done" | "failed";

/**
 * The cleanup's button in words: what a press does now, or how the last one went. The tokens are
 * the short-lived Zerops tokens Mate makes to open HQ and deletes once used; a cleanup takes any
 * left over, the person's expired ones too.
 */
export function signInTokensWords(state: SignInTokensCleanup): string {
  switch (state) {
    case "idle":
      return "Clean up";
    case "running":
      return "Cleaning up…";
    case "done":
      return "Cleaned up";
    case "failed":
      return "Failed. Try again";
  }
}
