/**
 * What has been said on one change, read as the person, and the way to say
 * something back.
 *
 * Read on open like the history, never on the sixty-second clock: a
 * conversation nobody has open costs nothing. What was read is kept for the
 * change, so opening it again shows what was said at once while it is read
 * again. A posted comment is put into the list straight away rather than
 * waiting for a re-read — the person just wrote it, and a comment box that
 * clears and then shows nothing for a second reads as a comment that was lost.
 *
 * A refusal answers its reason, because this is the whole of what the surface
 * shows: there is no last-good conversation to fall back on. *Try again*
 * (`retry`) asks once more.
 */
import type { GiteaIssueComment } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useState } from "react";

import { LRUCache } from "~/lib/lruCache";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

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
  /** Reads the conversation again, after it could not be read. */
  readonly retry: () => void;
}

/** Conversations kept by change, so one opened again shows what was said at once. */
const kept = new LRUCache<ReadonlyArray<GiteaIssueComment>>(24, 2 * 1024 * 1024);

function keyOf(origin: string, owner: string, repo: string, number: number): string {
  return `${origin}|${owner}/${repo}#${String(number)}`;
}

/** What was said, roughly as much as keeping it weighs. */
function weight(comments: ReadonlyArray<GiteaIssueComment>): number {
  return comments.reduce((sum, comment) => sum + comment.body.length * 2 + 128, 0);
}

/** What is known of a change's conversation before it is read (again). */
function known(key: string | null): ZeropsChangeCommentsState {
  if (key === null) return { kind: "no-gitea" };
  const comments = kept.get(key);
  return comments === null ? { kind: "reading" } : { kind: "read", comments };
}

/** Forgets every kept conversation — for tests. */
export function forgetChangeComments(): void {
  kept.clear();
}

export function useZeropsChangeComments(
  request: ZeropsChangeCommentsRequest | null,
): ZeropsChangeComments {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repo = request?.repo;
  const number = request?.number;
  const readable = useGiteaReadable(giteaOrigin);
  const key =
    giteaOrigin === undefined || owner === undefined || repo === undefined || number === undefined
      ? null
      : keyOf(giteaOrigin, owner, repo, number);
  const [saying, setSaying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);
  const [held, setHeld] = useState<{
    readonly key: string | null;
    readonly attempt: number;
    readonly state: ZeropsChangeCommentsState;
  }>(() => ({ key, attempt, state: known(key) }));
  let state = held.state;
  // Another change, or *Try again*: what was said stays while it is read again.
  if (held.key !== key || held.attempt !== attempt) {
    state = known(key);
    setHeld({ key, attempt, state });
  }

  useEffect(() => {
    if (
      key === null ||
      !readable ||
      giteaOrigin === undefined ||
      owner === undefined ||
      repo === undefined ||
      number === undefined
    ) {
      return;
    }
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    let live = true;
    const answer = (next: ZeropsChangeCommentsState) => {
      if (!live) return;
      setHeld((current) =>
        current.key === key && current.attempt === attempt ? { ...current, state: next } : current,
      );
    };
    void client.listIssueComments(owner, repo, number).then(
      (comments) => {
        kept.set(key, comments, weight(comments));
        answer({ kind: "read", comments });
      },
      (error: unknown) => {
        answer({ kind: "failed", reason: zeropsErrorMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [attempt, giteaOrigin, key, number, owner, readable, repo]);

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
        setHeld((current) => {
          const comments =
            current.state.kind === "read" ? [...current.state.comments, posted] : [posted];
          kept.set(keyOf(giteaOrigin, owner, repo, number), comments, weight(comments));
          return { ...current, state: { kind: "read", comments } };
        });
        return null;
      } catch (error: unknown) {
        return zeropsErrorMessage(error);
      } finally {
        setSaying(false);
      }
    },
    [giteaOrigin, owner, repo, number],
  );

  return { state, say, saying, retry };
}
