/** Account-owned metadata and the visible outcome of one credential command. Passwords stay in memory. */
import type { GitCredential, GitCredentialRecord } from "@t3tools/shared/hqGit";
import type { Shown } from "../knowledge/known.ts";

export type GitCredentialAction =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly verb: "issue" | "revoke" }
  | { readonly kind: "issued"; readonly credential: GitCredential }
  | { readonly kind: "failed"; readonly words: string };
export interface GitCredentialSnapshot {
  readonly credentials: Shown<ReadonlyArray<GitCredentialRecord>>;
  readonly action: GitCredentialAction;
}
/** The password list's render model; unread and failed lists never become empty records. */
export function selectGitCredentials(snapshot: GitCredentialSnapshot) {
  const shown = snapshot.credentials;
  const credentials =
    shown.state === "known"
      ? {
          state: shown.state,
          records: shown.value,
          partial: shown.coverage === "partial",
          stale: shown.freshness.kind === "stale",
        }
      : shown.state === "failed"
        ? {
            state: shown.state,
            words:
              shown.failure.kind === "refused"
                ? shown.failure.words
                : "HQ could not read the password list.",
          }
        : { state: shown.state };
  return { action: snapshot.action, credentials };
}
