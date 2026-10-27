import type { GitCredentialAction } from "../../zerops/hq/gitCredentialStore.ts";
import {
  gitCredentialsId,
  gitCredentialsScope,
  type GitCredentialsKey,
} from "../families/hqGitCredentials.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { selectGitCredentials } from "../../zerops/hq/gitCredentialStore.ts";
export type GitCredentialsRead = Omit<ReturnType<typeof selectGitCredentials>, "action"> & {
  readonly action: GitCredentialAction | { readonly kind: "unresolved"; readonly words: string };
};
export const gitCredentials: Projection<GitCredentialsKey, GitCredentialsRead> = {
  name: "gitCredentials",
  keyOf: gitCredentialsId,
  derive: (read, key) => {
    const id = gitCredentialsId(key);
    const fact = read.fact("hqGitCredentials", id);
    const stream = read.stream(gitCredentialsScope(key));
    const request = read.fact("hqGitCredentialRequest", id);
    const record = request.kind === "known" ? read.operation(request.value.requestId) : undefined;
    let action: GitCredentialsRead["action"] = { kind: "idle" };
    if (record !== undefined) {
      if (record.receipt?.acceptance.kind === "refused")
        action = { kind: "failed", words: record.receipt.acceptance.reason };
      else if (
        record.submission === "uncertain" ||
        record.submission === "uncertain-unasked" ||
        record.unresolved !== null
      )
        action = {
          kind: "unresolved",
          words:
            "The action's outcome is unresolved. Read the password list before creating another password.",
        };
      else if (record.receipt === null)
        action = {
          kind: "working",
          verb: record.intent.kind === "issue-git-credential" ? "issue" : "revoke",
        };
      else if (request.kind === "known" && request.value.credential !== null)
        action = { kind: "issued", credential: request.value.credential };
    }
    return {
      action,
      credentials:
        fact.kind === "known"
          ? {
              state: "known",
              records: fact.value,
              partial: read.coverage(gitCredentialsScope(key)) === "partial",
              stale: stream.fault !== null,
            }
          : fact.kind === "withheld"
            ? { state: "withheld" }
            : stream.fault !== null
              ? { state: "failed", words: stream.fault.message }
              : {
                  state:
                    stream.phase === "baselining" || stream.phase === "connecting"
                      ? "reading"
                      : "unread",
                },
    };
  },
  equals: sameValue,
};
