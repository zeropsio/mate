/**
 * A repository's recent commits, read as the person, only while something is
 * looking at them.
 *
 * Unlike the forge and the deploys, this is not on the sixty-second clock: a
 * history is opened, read and closed, and polling one nobody has open would
 * cost a request per group per minute for a surface that is usually shut.
 *
 * A read that fails answers its reason rather than nothing, because this is
 * the whole of what the surface shows — there is no last-good list to keep.
 */
import type { GiteaCommit } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** How far back a history goes before it stops being one. */
export const HISTORY_COMMITS = 30;

export type ZeropsCommitsState =
  | { readonly kind: "no-gitea" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly commits: ReadonlyArray<GiteaCommit> }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsCommitsRequest {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repo: string | undefined;
}

export function useZeropsRepositoryCommits(
  request: ZeropsCommitsRequest | null,
): ZeropsCommitsState {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const [state, setState] = useState<ZeropsCommitsState>({ kind: "reading" });

  useEffect(() => {
    if (giteaOrigin === undefined || owner === undefined || repo === undefined) {
      setState({ kind: "no-gitea" });
      return;
    }
    const client = giteaClientFor(giteaOrigin);
    if (client === null) {
      setState({ kind: "no-gitea" });
      return;
    }
    let live = true;
    setState({ kind: "reading" });
    void client
      .listCommits(owner, repo, { limit: HISTORY_COMMITS })
      .then((commits) => {
        if (live) setState({ kind: "read", commits });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "failed", reason: zeropsErrorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [giteaOrigin, owner, repo]);

  return state;
}
