import { Atom } from "effect/reactivity";
/** Review bodies and commits are demanded HQ facts keyed by the displayed head and main. */
import {
  changeReadout,
  changeReadoutOfRecord,
  type ChangeReadout,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import {
  changeReadOwner,
  hqChangeMetadata,
  hqChangeRead,
  type HqChangeMetadata,
  type HqChangeRead,
} from "@t3tools/client-runtime/data";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useMemo, useState } from "react";
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
  /**
   * For a change whose files HQ never recorded: reads them from its repository once, on the
   * person's press. Absent where there is nothing to show.
   */
  readonly showFiles: (() => void) | undefined;
  /**
   * For a change HQ recorded with no merge base (it shares no history with `main`): its files'
   * diffs are read with HQ's detail of it once, when the person unfolds a file. Absent elsewhere.
   */
  readonly readDiffs: (() => void) | undefined;
}

const READING = { kind: "reading" } as const;
const UNREAD = Atom.make<HqChangeRead>(READING);
const UNRECORDED = Atom.make<HqChangeMetadata>(READING);

/**
 * A change's review: what HQ recorded when the change last moved (`/metadata`: files, sizes, merge
 * base, verdict) — no repository is read to draw it. An HQ that records no review, a person who
 * asks for the files of a change that has none recorded, or one who unfolds a file of a change
 * recorded with no merge base to read its diff from, reads HQ's detail of it instead.
 */
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
  const [shownFor, setShownFor] = useState<string | null>(null);
  useDetailDemand("hqChangeMetadata", undefined, owner);
  useDetailDemand("hqAppDetail", undefined, request?.link.appId ?? null);
  const orgId = account?.orgId ?? null;
  const recorded = useProjection(
    hqChangeMetadata,
    owner === null || orgId === null ? null : { orgId, owner },
    UNRECORDED,
  );
  const review = recorded.kind === "read" ? recorded.detail.review : undefined;
  const filesAsked = owner !== null && shownFor === owner;
  // Recorded with no merge base, a file's diff has no base to be read from: HQ's detail holds it.
  const unrelated = review !== undefined && review.files !== null && review.mergeBase === null;
  const fullWanted =
    recorded.kind === "read" &&
    (review === undefined || ((review.files === null || unrelated) && filesAsked));
  const fullOwner = fullWanted ? owner : null;
  useDetailDemand("hqChangeRead", undefined, fullOwner);
  const full = useProjection(
    hqChangeRead,
    fullOwner === null || orgId === null ? null : { orgId, owner: fullOwner },
    UNREAD,
  );
  const readout = useMemo<ReadoutPart<ChangeReadout>>(() => {
    if (owner === null) return { kind: "none" };
    const failed = (read: HqChangeRead | HqChangeMetadata): ReadoutPart<ChangeReadout> => ({
      kind: "failed",
      reason:
        read.kind === "gone"
          ? "This change is not there."
          : read.kind === "refused" || read.kind === "unavailable"
            ? read.reason
            : "",
    });
    if (fullWanted) {
      return full.kind === "read"
        ? { kind: "read", value: changeReadout(full.detail) }
        : full.kind === "reading"
          ? READING
          : failed(full);
    }
    if (recorded.kind === "read" && review !== undefined)
      return { kind: "read", value: changeReadoutOfRecord(recorded.detail.change, review) };
    return recorded.kind === "reading" ? READING : failed(recorded);
  }, [owner, fullWanted, full, recorded, review]);
  const retry = useCallback(() => {
    if (owner === null || readout.kind !== "failed") return;
    account?.retryDetail({
      family: fullWanted ? "hqChangeRead" : "hqChangeMetadata",
      ownerId: owner,
    });
  }, [account, owner, readout.kind, fullWanted]);
  const showFiles = useCallback(() => {
    setShownFor(owner);
  }, [owner]);
  return {
    readout,
    retry,
    showFiles: review !== undefined && review.files === null && !filesAsked ? showFiles : undefined,
    readDiffs: unrelated && !filesAsked ? showFiles : undefined,
  };
}

/** The main commit of this repository, independent of merges in the application's other repos. */
export function mergedMain(
  repository: string,
  merged: ReadonlyArray<Pick<FlowPullRequest, "repository" | "mergeCommitSha">> | undefined,
): string | undefined {
  return merged?.find((change) => change.repository === repository)?.mergeCommitSha;
}
