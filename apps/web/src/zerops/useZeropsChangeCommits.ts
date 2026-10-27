import { Atom } from "effect/reactivity";
/** Explicitly opened commit history, keyed by the displayed head and main. */
import { type ChangeReadoutCommit } from "@t3tools/client-runtime/zerops";
import { changeReadOwner, hqChangeCommits } from "@t3tools/client-runtime/data";
import type { ReadoutPart, ZeropsChangeDetailRequest } from "./useZeropsChangeDetail";
import { useCallback, useMemo } from "react";
import { useAccountDataOptional, useProjection, useDetailDemand } from "./ZeropsAccountData";

export interface ZeropsChangeCommits {
  readonly readout: ReadoutPart<{ readonly commits: ReadonlyArray<ChangeReadoutCommit> }>;
  /** Reads a read that failed again. */
  readonly retry: () => void;
}

const READING = { kind: "reading" } as const;
const UNREAD = Atom.make<import("@t3tools/client-runtime/data").HqChangeCommits>(READING);
export function useZeropsChangeCommits(
  request: ZeropsChangeDetailRequest | null,
): ZeropsChangeCommits {
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
  useDetailDemand("hqChangeCommits", undefined, owner);
  useDetailDemand("hqAppDetail", undefined, request?.link.appId ?? null);
  const read = useProjection(
    hqChangeCommits,
    owner === null || account?.orgId == null ? null : { orgId: account.orgId, owner },
    UNREAD,
  );
  const readout = useMemo<ReadoutPart<{ readonly commits: ReadonlyArray<ChangeReadoutCommit> }>>(
    () =>
      owner === null
        ? { kind: "none" }
        : read.kind === "read"
          ? { kind: "read", value: { commits: read.detail.commits } }
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
      account?.retryDetail({ family: "hqChangeCommits", ownerId: owner });
  }, [account, owner, readout.kind]);
  return { readout, retry };
}
