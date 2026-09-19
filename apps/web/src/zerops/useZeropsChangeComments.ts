/**
 * What has been said on one change, read as the person, and the way to say
 * something back.
 *
 * Read on open like the history, never on the sixty-second clock: a
 * conversation nobody has open costs nothing. A posted comment is put into the
 * list straight away rather than waiting for a re-read — the person just wrote
 * it, and a comment box that clears and then shows nothing for a second reads
 * as a comment that was lost.
 *
 * A refusal answers its reason, because this is the whole of what the surface
 * shows: there is no last-good conversation to fall back on.
 */
import type { GiteaIssueComment } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

export type ZeropsChangeCommentsState =
  | { readonly kind: "no-gitea" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly comments: ReadonlyArray<GiteaIssueComment> }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsChangeCommentsRequest {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repo: string | undefined;
  readonly number: number | undefined;
}

export interface ZeropsChangeComments {
  readonly state: ZeropsChangeCommentsState;
  /** Says it, and answers the refusal rather than throwing at the surface. */
  readonly say: (body: string) => Promise<string | null>;
  /** True while one is in flight; the box takes no second press. */
  readonly saying: boolean;
}

export function useZeropsChangeComments(
  request: ZeropsChangeCommentsRequest | null,
): ZeropsChangeComments {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const number = request?.number;
  const [state, setState] = useState<ZeropsChangeCommentsState>({ kind: "reading" });
  const [saying, setSaying] = useState(false);

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      owner === undefined ||
      repo === undefined ||
      number === undefined
    ) {
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
      .listIssueComments(owner, repo, number)
      .then((comments) => {
        if (live) setState({ kind: "read", comments });
      })
      .catch((error: unknown) => {
        if (live) setState({ kind: "failed", reason: zeropsErrorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [giteaOrigin, owner, repo, number]);

  const say = useCallback(
    async (body: string): Promise<string | null> => {
      if (
        giteaOrigin === undefined ||
        owner === undefined ||
        repo === undefined ||
        number === undefined
      ) {
        return "This change is not on a repository we can reach.";
      }
      const client = giteaClientFor(giteaOrigin);
      if (client === null) return "Sign in to Gitea to say something here.";
      setSaying(true);
      try {
        const posted = await client.createIssueComment(owner, repo, number, body);
        setState((current) =>
          current.kind === "read"
            ? { kind: "read", comments: [...current.comments, posted] }
            : { kind: "read", comments: [posted] },
        );
        return null;
      } catch (error: unknown) {
        return zeropsErrorMessage(error);
      } finally {
        setSaying(false);
      }
    },
    [giteaOrigin, owner, repo, number],
  );

  return { state, say, saying };
}
