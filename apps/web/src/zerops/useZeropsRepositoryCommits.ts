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
 * With no Gitea token to read with — none held, or a 401 that no token
 * recovered — it says so, and reads once one is back. A
 * history already answered keeps its answer while the token is gone and while
 * it is read again (DESIGN §4.6: a 401 never blanks what was read).
 */
import {
  GROUP_REPOSITORY,
  releaseTagsByCommit,
  type GiteaCommit,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

/** How far back a history goes before it stops being one. */
export const HISTORY_COMMITS = 30;

export type ZeropsCommitsState =
  | { readonly kind: "no-gitea" }
  | { readonly kind: "reading" }
  | {
      readonly kind: "read";
      readonly commits: ReadonlyArray<GiteaCommit>;
      /** `full sha → the release that shipped it`, across the whole group. */
      readonly releases: ReadonlyMap<string, string>;
    }
  | { readonly kind: "failed"; readonly reason: string };

/** An answer and the request it answers; `key` is `null` for a request with nothing to read. */
interface HeldCommits {
  readonly key: string | null;
  readonly state: ZeropsCommitsState;
}

/** The held answer, kept when it already answers `key`, otherwise `waiting`. */
function holdFor(key: string, waiting: ZeropsCommitsState) {
  return (held: HeldCommits): HeldCommits =>
    held.key === key && (held.state.kind === "read" || held.state.kind === "failed")
      ? held
      : { key, state: waiting };
}

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
  const readable = useGiteaReadable(giteaOrigin);
  const [held, setHeld] = useState<HeldCommits>({ key: null, state: { kind: "reading" } });

  useEffect(() => {
    if (giteaOrigin === undefined || owner === undefined || repo === undefined) {
      setHeld({ key: null, state: { kind: "no-gitea" } });
      return;
    }
    const key = JSON.stringify([giteaOrigin, owner, repo]);
    let unauthorized = false;
    const client = readable
      ? giteaClientFor(giteaOrigin, () => {
          unauthorized = true;
        })
      : null;
    if (client === null) {
      setHeld(holdFor(key, { kind: "no-gitea" }));
      return;
    }
    let live = true;
    setHeld(holdFor(key, { kind: "reading" }));
    // The releases come from the group repository, not this one: a tag lists
    // every service's commit in its message. A failure there is not a failure
    // of the history — the commits still answer, with no release names on them.
    void Promise.all([
      client.listCommits(owner, repo, { limit: HISTORY_COMMITS }),
      client.listTags(owner, GROUP_REPOSITORY).catch(() => []),
    ])
      .then(([commits, tags]) => {
        if (!live) return;
        if (unauthorized) {
          setHeld(holdFor(key, { kind: "no-gitea" }));
          return;
        }
        setHeld({ key, state: { kind: "read", commits, releases: releaseTagsByCommit(tags) } });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setHeld(
          unauthorized
            ? holdFor(key, { kind: "no-gitea" })
            : { key, state: { kind: "failed", reason: zeropsErrorMessage(error) } },
        );
      });
    return () => {
      live = false;
    };
  }, [giteaOrigin, owner, readable, repo]);

  return held.state;
}

/**
 * The commits one change carries: what its branch has that the branch it
 * targets does not.
 *
 * `compareCommits` is the right read here and the wrong one for a history —
 * it takes two refs and reports the difference, which is exactly what a pull
 * request is. Releases are not folded on: nothing in an unmerged change has
 * shipped.
 */
export function useZeropsChangeCommits(
  request: {
    readonly giteaOrigin: string | undefined;
    readonly owner: string | undefined;
    readonly repo: string | undefined;
    readonly base: string | undefined;
    readonly head: string | undefined;
  } | null,
): ZeropsCommitsState {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const base = request?.base;
  const head = request?.head;
  const readable = useGiteaReadable(giteaOrigin);
  const [held, setHeld] = useState<HeldCommits>({ key: null, state: { kind: "reading" } });

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      owner === undefined ||
      repo === undefined ||
      base === undefined ||
      head === undefined
    ) {
      setHeld({ key: null, state: { kind: "no-gitea" } });
      return;
    }
    const key = JSON.stringify([giteaOrigin, owner, repo, base, head]);
    let unauthorized = false;
    const client = readable
      ? giteaClientFor(giteaOrigin, () => {
          unauthorized = true;
        })
      : null;
    if (client === null) {
      setHeld(holdFor(key, { kind: "no-gitea" }));
      return;
    }
    let live = true;
    setHeld(holdFor(key, { kind: "reading" }));
    void client
      .compareCommits(owner, repo, base, head)
      .then((commits) => {
        // Newest first, as a history reads.
        if (live) {
          setHeld({
            key,
            state: { kind: "read", commits: [...commits].reverse(), releases: new Map() },
          });
        }
      })
      .catch((error: unknown) => {
        if (!live) return;
        setHeld(
          unauthorized
            ? holdFor(key, { kind: "no-gitea" })
            : { key, state: { kind: "failed", reason: zeropsErrorMessage(error) } },
        );
      });
    return () => {
      live = false;
    };
  }, [giteaOrigin, owner, readable, repo, base, head]);

  return held.state;
}
