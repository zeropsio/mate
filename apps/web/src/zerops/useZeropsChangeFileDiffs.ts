/** A file's diff of a change review, read from its box only once the person unfolds the file. */
import { changeFileDiffState, type ChangeFileDiffState } from "@t3tools/client-runtime/zerops";
import { useCallback, useState } from "react";

import { useGitBrowseReads } from "./useGitBrowse";

export interface ZeropsChangeFileDiffs {
  /** A file's diff as it stands; reading until it is asked for and answered. */
  readonly diffOf: (path: string) => ChangeFileDiffState;
  /** Asks for a file's diff: what unfolding it does. */
  readonly ask: (path: string) => void;
}

export function useZeropsChangeFileDiffs(at: {
  readonly appId: string;
  readonly repo: string;
  /** The change's recorded merge base and its head; none, nothing can be asked. */
  readonly base: string | null;
  readonly head: string | undefined;
}): ZeropsChangeFileDiffs {
  const [asked, setAsked] = useState<ReadonlyArray<string>>([]);
  const { appId, repo, base, head } = at;
  const reads = useGitBrowseReads(
    base === null || head === undefined
      ? []
      : asked.map((path) => ({
          appId,
          repo,
          read: "compare-file" as const,
          params: { base, head, path },
        })),
    true,
  );
  const diffOf = useCallback(
    (path: string) => changeFileDiffState(reads.views[asked.indexOf(path)], path),
    [reads.views, asked],
  );
  const ask = useCallback((path: string) => {
    setAsked((current) => (current.includes(path) ? current : [...current, path]));
  }, []);
  return { diffOf, ask };
}
