import { Atom } from "effect/reactivity";
/** Review bodies and commits are demanded HQ facts keyed by the displayed head and main. */
import {
  changeReadoutJudged,
  changeReadoutOfCompare,
  changeReadoutOfRecord,
  type ChangeReadout,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import {
  changeReadOwner,
  hqChangeMetadata,
  hqChangeVerdict,
  type HqChangeMetadata,
  type HqChangeVerdict,
} from "@t3tools/client-runtime/data";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useMemo, useState } from "react";
import { useAccountDataOptional, useProjection, useDetailDemand } from "./ZeropsAccountData";
import { useGitBrowseReads } from "./useGitBrowse";

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
  /**
   * Whether it merges, as the live change last told it. HQ records the review as it judges the
   * change, so a record read while HQ still checked is read again once it has judged.
   */
  readonly mergeability?: FlowPullRequest["mergeability"] | undefined;
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
}

const READING = { kind: "reading" } as const;
const UNRECORDED = Atom.make<HqChangeMetadata>(READING);
const UNJUDGED = Atom.make<HqChangeVerdict>(READING);

/**
 * A change's review: what HQ recorded when the change last moved (`/metadata`: files, sizes, merge
 * base, verdict) — no repository is read to draw it. A record with no verdict yet also reads HQ's
 * judgement of the shown head and main (`GET …/:n`). A person who asks for the files of a change
 * that has none recorded reads them from its repository: `main` compared with its head.
 */
export function useZeropsChangeDetail(
  request: ZeropsChangeDetailRequest | null,
): ZeropsChangeDetail {
  const account = useAccountDataOptional();
  const at =
    request === null || request.head === undefined
      ? null
      : {
          link: request.link,
          snapshot: {
            expectedHead: request.head,
            ...(request.main === undefined ? {} : { expectedMain: request.main }),
          },
        };
  // The head and main the person is shown; the read also names HQ's judgement of them.
  const shownAt = at === null ? null : changeReadOwner(at);
  const owner =
    at === null || request?.mergeability === undefined
      ? shownAt
      : changeReadOwner({ ...at, judged: request.mergeability });
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
  // A record with no verdict yet is checked by HQ's judgement of the shown head and main, read
  // while it says so: HQ may never judge the record again. Unread or failed, it stays checked.
  const judgedAt =
    recorded.kind === "read" && recorded.detail.change.mergeability === "unknown" ? shownAt : null;
  useDetailDemand("hqChangeVerdict", undefined, judgedAt);
  const judgement = useProjection(
    hqChangeVerdict,
    judgedAt === null || orgId === null ? null : { orgId, owner: judgedAt },
    UNJUDGED,
  );
  const judged = judgement.kind === "read" ? judgement.detail.mergeability : undefined;
  const filesAsked = owner !== null && shownFor === owner;
  const compareWanted = review?.files === null && filesAsked;
  // HQ's `main` is the base when the flow has not told one yet: the compare answers the commit it named.
  const compared = useGitBrowseReads(
    compareWanted && request !== null && request.head !== undefined
      ? [
          {
            appId: request.link.appId,
            repo: request.link.repo,
            read: "compare" as const,
            params: { base: request.main ?? "main", head: request.head },
          },
        ]
      : [],
    true,
  );
  const comparison = compareWanted ? compared.views[0] : undefined;
  const readout = useMemo<ReadoutPart<ChangeReadout>>(() => {
    if (owner === null) return { kind: "none" };
    if (recorded.kind === "reading") return READING;
    if (recorded.kind !== "read")
      return {
        kind: "failed",
        reason:
          recorded.kind === "gone"
            ? "This change is not there."
            : recorded.kind === "refused" || recorded.kind === "unavailable"
              ? recorded.reason
              : "",
      };
    const record = changeReadoutJudged(
      changeReadoutOfRecord(recorded.detail.change, recorded.detail.review),
      judged,
    );
    if (!compareWanted) return { kind: "read", value: record };
    if (comparison?.state === "known")
      return { kind: "read", value: changeReadoutOfCompare(record, comparison.answer) };
    if (comparison?.state === "failed" || comparison?.state === "refused")
      return { kind: "failed", reason: comparison.words };
    return READING;
  }, [owner, recorded, judged, compareWanted, comparison]);
  // Read again only because HQ judged it: the record of the same head and main stays on screen
  // until the newer one is read.
  const [held, setHeld] = useState<{
    readonly at: string;
    readonly readout: ReadoutPart<ChangeReadout>;
  } | null>(null);
  if (readout.kind === "read" && shownAt !== null && held?.readout !== readout)
    setHeld({ at: shownAt, readout });
  const shown =
    readout === READING && held !== null && held.at === shownAt ? held.readout : readout;
  const retry = useCallback(() => {
    if (owner === null || readout.kind !== "failed") return;
    if (compareWanted) compared.again();
    else account?.retryDetail({ family: "hqChangeMetadata", ownerId: owner });
  }, [account, owner, readout.kind, compareWanted, compared]);
  const showFiles = useCallback(() => {
    setShownFor(owner);
  }, [owner]);
  return {
    readout: shown,
    retry,
    showFiles: review !== undefined && review.files === null && !filesAsked ? showFiles : undefined,
  };
}

/** The main commit of this repository, independent of merges in the application's other repos. */
export function mergedMain(
  repository: string,
  merged: ReadonlyArray<Pick<FlowPullRequest, "repository" | "mergeCommitSha">> | undefined,
): string | undefined {
  return merged?.find((change) => change.repository === repository)?.mergeCommitSha;
}
