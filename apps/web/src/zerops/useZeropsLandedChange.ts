/**
 * A change the flow no longer carries, read from the forge on its own.
 *
 * Every surface reads changes from `projectFlow`, which holds the **open**
 * ones. That is right for a list of what needs a person — and wrong for a
 * page: a change somebody links to has usually just landed, and its page
 * answered "This change is not open on appdev any more", which is a worse
 * destination than the forge it replaced (the owner, 2026-09-19).
 *
 * So the page falls back to the forge for the one change it was asked for,
 * and only for that one: no listing, no poll — one read on open, asked again
 * a few times while it does not find the change. A change the flow already has
 * never gets here.
 */
import {
  flowPullRequest,
  type FlowPullRequest,
  type GiteaCommitStatus,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { mergeabilityAfter, mergeReadOf } from "@t3tools/client-runtime/zerops/forge";
import { useEffect, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

export type ZeropsLandedChangeState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly pull: FlowPullRequest }
  | { readonly kind: "gone" }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsLandedChangeRequest {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repository: string;
  readonly number: number;
}

/** How long after each read that did not find the change it is read again. */
export const LANDED_CHANGE_RETRY_MS: ReadonlyArray<number> = [2_000, 5_000, 10_000];

/**
 * One read of the change as the person, or `null` with no client to read with. A 401 no token
 * recovered is a failure like any other: the tab is signing in again, and the next read has it.
 */
async function readChange(
  giteaOrigin: string,
  owner: string,
  repository: string,
  number: number,
): Promise<Exclude<ZeropsLandedChangeState, { kind: "idle" | "reading" }> | null> {
  const client = giteaClientFor(giteaOrigin);
  if (client === null) return null;
  try {
    const readAt = Date.now();
    const pull = await client.getPullRequest(owner, repository, number);
    if (pull === undefined) return { kind: "gone" };
    // The checks are read where the flow reads them — on the head — so a
    // landed change's verdict is the verdict its row always carried.
    const sha = pull.head?.sha;
    let checks: ReadonlyArray<GiteaCommitStatus> = [];
    if (sha !== undefined) {
      try {
        checks = await client.listCommitStatuses(owner, repository, sha);
      } catch {
        // A head the forge has since garbage-collected still has a change
        // worth reading; it simply has no checks to show.
        checks = [];
      }
    }
    // One read, so a "no" is Gitea still checking, never a conflict: the
    // flow, which reads again, is what carries an open change's verdict.
    const { mergeability } = mergeabilityAfter(null, mergeReadOf(pull, readAt));
    return {
      kind: "read",
      pull: flowPullRequest({ repository, pull, checks, mergeability: mergeability.kind }),
    };
  } catch (cause) {
    return { kind: "failed", reason: zeropsErrorMessage(cause) };
  }
}

export function useZeropsLandedChange(
  request: ZeropsLandedChangeRequest | null,
): ZeropsLandedChangeState {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repository = request?.repository;
  const number = request?.number;
  // Keyed on it, so a link drawn before the tab holds a token is read once it does.
  const readable = useGiteaReadable(giteaOrigin);
  const [state, setState] = useState<ZeropsLandedChangeState>({ kind: "idle" });

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      !readable ||
      owner === undefined ||
      repository === undefined ||
      number === undefined
    ) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: () => void = () => undefined;
    setState({ kind: "reading" });
    void (async () => {
      let answer = await readChange(giteaOrigin, owner, repository, number);
      // A change is linked the moment it is opened, so a first "not there" or a read that
      // failed is asked again a few times before it stands: a message is frozen once
      // written, and nothing else would ever read its link again.
      for (const delayMs of LANDED_CHANGE_RETRY_MS) {
        if (cancelled || answer === null || answer.kind === "read") break;
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, delayMs);
        });
        if (cancelled) return;
        answer = await readChange(giteaOrigin, owner, repository, number);
      }
      if (!cancelled) setState(answer ?? { kind: "idle" });
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      wake();
    };
  }, [giteaOrigin, number, owner, readable, repository]);

  return state;
}
