/**
 * What has been said on one change, read from HQ as the person, and the way to say something back
 * (SPEC §3.2a: HQ keeps a change's comments, and `comment_change` decides who may write one).
 *
 * Read on open, never on a clock: a conversation nobody has open costs nothing. What was read is
 * kept for the change, so opening it again shows what was said at once while it is read again. A
 * posted comment is put into the list straight away rather than waiting for a re-read — the
 * person just wrote it, and a comment box that clears and then shows nothing for a second reads
 * as a comment that was lost.
 *
 * A refusal answers its reason, because this is the whole of what the surface shows: there is no
 * last-good conversation to fall back on. *Try again* (`retry`) asks once more. Until the
 * organization's official HQ is known, it is still being read.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { ChangeLink, HqChangeComment } from "@t3tools/shared/hqChanges";
import { useCallback, useEffect, useState } from "react";

import { LRUCache } from "~/lib/lruCache";

import { useOfficialHq } from "./accountHq";

export type ZeropsChangeCommentsState =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly comments: ReadonlyArray<HqChangeComment> }
  | { readonly kind: "failed"; readonly reason: string };

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
const kept = new LRUCache<ReadonlyArray<HqChangeComment>>(24, 2 * 1024 * 1024);

/** What was said, roughly as much as keeping it weighs. */
function weight(comments: ReadonlyArray<HqChangeComment>): number {
  return comments.reduce((sum, comment) => sum + comment.body.length * 2 + 128, 0);
}

/** What is known of a change's conversation before it is read (again). */
function known(key: string | null): ZeropsChangeCommentsState {
  const comments = key === null ? null : kept.get(key);
  return comments === null ? { kind: "reading" } : { kind: "read", comments };
}

/** Forgets every kept conversation — for tests. */
export function forgetChangeComments(): void {
  kept.clear();
}

/** HQ is not known here: nothing can be said through it. */
const NO_HQ = "This organization's HQ is not open here.";

export function useZeropsChangeComments(link: ChangeLink | null): ZeropsChangeComments {
  const hq = useOfficialHq();
  const appId = link?.appId;
  const repo = link?.repo;
  const number = link?.number;
  const key =
    hq === null || appId === undefined || repo === undefined || number === undefined
      ? null
      : `${hq.address}|${appId}/${repo}#${String(number)}`;
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
    if (key === null || hq === null) return;
    if (appId === undefined || repo === undefined || number === undefined) return;
    let live = true;
    const answer = (next: ZeropsChangeCommentsState) => {
      if (!live) return;
      setHeld((current) =>
        current.key === key && current.attempt === attempt ? { ...current, state: next } : current,
      );
    };
    void hq.api.changeComments({ appId, repo, number }).then(
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
  }, [appId, attempt, hq, key, number, repo]);

  const say = useCallback(
    async (body: string): Promise<string | null> => {
      if (key === null || hq === null) return NO_HQ;
      if (appId === undefined || repo === undefined || number === undefined) return NO_HQ;
      setSaying(true);
      try {
        const posted = await hq.api.commentOnChange({ appId, repo, number }, body);
        setHeld((current) => {
          const comments =
            current.state.kind === "read" ? [...current.state.comments, posted] : [posted];
          kept.set(key, comments, weight(comments));
          return { ...current, state: { kind: "read", comments } };
        });
        return null;
      } catch (error: unknown) {
        return zeropsErrorMessage(error);
      } finally {
        setSaying(false);
      }
    },
    [appId, hq, key, number, repo],
  );

  return { state, say, saying, retry };
}
