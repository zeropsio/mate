import { Atom } from "effect/reactivity";
/** Review bodies and commits are demanded HQ facts keyed by the displayed head and main. */
import {
  changeReadout,
  type ChangeReadout,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { changeReadOwner, hqChangeRead } from "@t3tools/client-runtime/data";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useMemo } from "react";
import { useAccountDataOptional, useProjection, useDetailDemand } from "./ZeropsAccountData";

export type ReadoutPart<T> =
  | { readonly kind: "none" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsChangeDetailRequest {
  readonly link: ChangeLink;
  /** The head the person is shown; a change no push reached has nothing to read. */
  readonly head: string | undefined;
  /** What `main` was as the flow last told it: the newest landed change's commit. */
  readonly main: string | undefined;
}

export interface ZeropsChangeDetail {
  readonly readout: ReadoutPart<ChangeReadout>;
  /** Reads a read that failed again. */
  readonly retry: () => void;
}

const READING = { kind: "reading" } as const;
const UNREAD = Atom.make<import("@t3tools/client-runtime/data").HqChangeRead>(READING);
export function useZeropsChangeDetail(
  request: ZeropsChangeDetailRequest | null,
): ZeropsChangeDetail {
  const account = useAccountDataOptional();
  const owner =
    request === null || request.head === undefined
      ? null
      : changeReadOwner({
          link: request.link,
          snapshot: {
            expectedHead: request.head,
            ...(request.main === undefined ? {} : { expectedMain: request.main }),
          },
        });
  useDetailDemand("hqChangeRead", undefined, owner);
  useDetailDemand("hqAppDetail", undefined, request?.link.appId ?? null);
  const read = useProjection(
    hqChangeRead,
    owner === null || account?.orgId == null ? null : { orgId: account.orgId, owner },
    UNREAD,
  );
  const readout = useMemo<ReadoutPart<ChangeReadout>>(
    () =>
      owner === null
        ? { kind: "none" }
        : read.kind === "read"
          ? { kind: "read", value: changeReadout(read.detail) }
          : read.kind === "reading"
            ? READING
            : {
                kind: "failed",
                reason: read.kind === "gone" ? "This change is not there." : read.reason,
              },
    [owner, read],
  );
  const retry = useCallback(() => {
    if (owner !== null && readout.kind === "failed")
      account?.retryDetail({ family: "hqChangeRead", ownerId: owner });
  }, [account, owner, readout.kind]);
  return { readout, retry };
}

/** The main commit of this repository, independent of merges in the application's other repos. */
export function mergedMain(
  repository: string,
  merged: ReadonlyArray<Pick<FlowPullRequest, "repository" | "mergeCommitSha">> | undefined,
): string | undefined {
  return merged?.find((change) => change.repository === repository)?.mergeCommitSha;
}
