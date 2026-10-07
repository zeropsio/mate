/** One account's source facts. Reads never retry themselves; Again starts one new attempt. */
import type { RepositoryQuery, RepositorySource } from "@t3tools/shared/hqGit";
import type { Shown } from "../knowledge/known.ts";

export interface RepositoryTarget {
  readonly appId: string;
  readonly repo: string;
  readonly query: RepositoryQuery;
}
export const repositoryKey = ({ appId, repo, query }: RepositoryTarget) =>
  JSON.stringify([appId, repo, query.rev ?? null, query.path, query.kind]);

/** Repository content and read affordances for clients, with access withheld before rendering. */
export function selectRepositorySource(shown: Shown<RepositorySource>) {
  if (shown.state === "known") {
    return {
      state: shown.state,
      source: shown.value,
      busy: shown.freshness.kind === "revalidating",
      failed:
        shown.freshness.kind === "stale" && shown.freshness.reason.kind === "revalidation-failed",
    };
  }
  return {
    state: shown.state,
    words:
      shown.state === "withheld"
        ? "You no longer have access to this repository."
        : shown.state === "failed" && shown.failure.kind === "refused"
          ? shown.failure.words
          : shown.state === "reading"
            ? "Reading…"
            : "Waiting for HQ…",
    alert: shown.state === "failed" || shown.state === "withheld",
    busy: shown.state === "reading",
  };
}
