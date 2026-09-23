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
 * and only for that one: no listing, no clock, one read on open. A change the
 * flow already has never gets here.
 */
import {
  flowPullRequest,
  type FlowPullRequest,
  type GiteaCommitStatus,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./accountGiteaSessions";

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

export function useZeropsLandedChange(
  request: ZeropsLandedChangeRequest | null,
): ZeropsLandedChangeState {
  const giteaOrigin = request?.giteaOrigin;
  const owner = request?.owner;
  const repository = request?.repository;
  const number = request?.number;
  const [state, setState] = useState<ZeropsLandedChangeState>({ kind: "idle" });

  useEffect(() => {
    if (
      giteaOrigin === undefined ||
      owner === undefined ||
      repository === undefined ||
      number === undefined
    ) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "reading" });
    void (async () => {
      try {
        const client = giteaClientFor(giteaOrigin);
        if (client === null) {
          setState({ kind: "idle" });
          return;
        }
        const pull = await client.getPullRequest(owner, repository, number);
        if (cancelled) return;
        if (pull === undefined) {
          setState({ kind: "gone" });
          return;
        }
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
        if (cancelled) return;
        setState({ kind: "read", pull: flowPullRequest({ repository, pull, checks }) });
      } catch (cause) {
        if (!cancelled) setState({ kind: "failed", reason: zeropsErrorMessage(cause) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [giteaOrigin, number, owner, repository]);

  return state;
}
