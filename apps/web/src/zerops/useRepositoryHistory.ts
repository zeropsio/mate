/** Commit content for an explicitly opened History or release row, through the shared comparison reader. */
import { compareReadKey, type CompareRead } from "@t3tools/client-runtime/zerops";
import type { CompareCommit, RepoListEntry } from "@t3tools/shared/hqChanges";
import { useMemo } from "react";

import { useReleaseComparisons } from "./useReleaseComparisons";

export type ZeropsHistoryState =
  | { readonly kind: "reading" }
  | { readonly kind: "failed"; readonly reason: string; readonly again?: (() => void) | undefined }
  | {
      readonly kind: "read";
      /** Newest first, at most `COMPARE_COMMITS_MAX`. */
      readonly commits: ReadonlyArray<CompareCommit>;
      /** How many `main` holds, counted up to `COMPARE_COUNT_MAX`. */
      readonly total: number;
    };

const READING: ZeropsHistoryState = { kind: "reading" };
/** A repository with nothing on `main`, or none at all: nothing has landed. */
const NOTHING_LANDED: ZeropsHistoryState = { kind: "read", commits: [], total: 0 };
const NO_ASKS: ReadonlyMap<string, ReadonlyArray<CompareRead>> = new Map();

export function useRepositoryHistory(input: {
  readonly appId: string;
  /** Set only by an explicit History or row expansion. */
  readonly revision?: string | undefined;
  readonly base?: string | undefined;
  /** The repository, as the recipe names it; `undefined` where the stop names none. */
  readonly repo: string | undefined;
  /** The application's repositories as HQ last listed them (`ZeropsProjectFlow.repos`). */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
}): ZeropsHistoryState {
  const { appId, repo, repos, revision, base } = input;
  const head =
    revision ??
    (repo === undefined ? undefined : repos?.find(({ name }) => name === repo)?.mainHead);
  const read = useMemo<CompareRead | undefined>(
    () =>
      repo === undefined || head === undefined || head === null
        ? undefined
        : {
            repository: repo,
            query: { head, ...(base === undefined ? {} : { base }) },
            services: [],
          },
    [head, repo, base],
  );
  const asks = useMemo(
    () => (read === undefined ? NO_ASKS : new Map([[appId, [read]]])),
    [appId, read],
  );
  const compares = useReleaseComparisons(asks);
  if (repo === undefined) return NOTHING_LANDED;
  if (repos === undefined && revision === undefined) return READING;
  if (read === undefined) return NOTHING_LANDED;
  const answered = compares.get(appId);
  const answer = answered?.answers.get(compareReadKey(read));
  if (answer !== undefined) return { kind: "read", commits: answer.commits, total: answer.total };
  const failure = answered?.failures.get(compareReadKey(read));
  return failure === undefined
    ? READING
    : { kind: "failed", reason: failure, again: () => answered?.again([read]) };
}
