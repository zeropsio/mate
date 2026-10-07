import type { GitCredentialRecord } from "@t3tools/shared/hqGit";
import type { GitCredentialsKey } from "../families/hqGitCredentials.ts";
import type { OperationKind } from "./kind.ts";
declare module "../model.ts" {
  interface OperationIntents {
    readonly "issue-git-credential": GitCredentialsKey;
    readonly "revoke-git-credential": GitCredentialsKey & { readonly id: string };
  }
  interface OperationResults {
    readonly "issue-git-credential": GitCredentialRecord;
  }
}
export const issueGitCredential: OperationKind<"issue-git-credential"> = {
  kind: "issue-git-credential",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
export const revokeGitCredential: OperationKind<"revoke-git-credential"> = {
  kind: "revoke-git-credential",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
