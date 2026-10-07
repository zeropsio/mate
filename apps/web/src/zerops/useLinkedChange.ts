import { Atom } from "effect/unstable/reactivity";
/**
 * A change the flow does not carry, read from HQ on its own.
 *
 * Every surface reads changes from `projectFlow`, which holds what HQ's stream carries of each
 * application: its open changes and its newest landed and closed ones. A change somebody links to
 * is usually among them; one older than that, or in an application the registry does not name
 * yet, would leave its page answering "This change is not open any more" — a worse destination
 * than the link itself (the owner, 2026-09-19).
 *
 * So the one change asked for is read from HQ, and only that one: no listing, no poll — one read
 * on open, with each answer published at once. Only Read again asks another time. A change the
 * flow already has never gets here. Nothing is read until the organization's official HQ is known.
 */
import { flowChange, type FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { changeReadOwner, hqChangeRead } from "@t3tools/client-runtime/data";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useMemo } from "react";
import { useOfficialHq } from "./accountHq";
import { useAccountDataOptional, useProjection, useDetailDemand } from "./ZeropsAccountData";

export type LinkedChangeState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly pull: FlowPullRequest }
  | { readonly kind: "gone" }
  | { readonly kind: "refused" | "unavailable"; readonly reason: string };

const READING = { kind: "reading" } as const;
const UNREAD = Atom.make<import("@t3tools/client-runtime/data").HqChangeRead>(READING);
export function useLinkedChange(
  link: ChangeLink | null,
): LinkedChangeState & { readonly readAgain?: () => void } {
  const account = useAccountDataOptional();
  const hq = useOfficialHq();
  const owner = link === null ? null : changeReadOwner({ link });
  const address = hq?.address ?? null;
  useDetailDemand("hqChangeRead", undefined, owner);
  useDetailDemand("hqAppDetail", undefined, link?.appId ?? null);
  const read = useProjection(
    hqChangeRead,
    owner === null || account?.orgId == null ? null : { orgId: account.orgId, owner },
    UNREAD,
  );
  const pull = useMemo(
    () =>
      read.kind === "read" && address !== null ? flowChange(read.detail.change, address) : null,
    [read, address],
  );
  const readAgain = useCallback(() => {
    if (owner !== null) account?.retryDetail({ family: "hqChangeRead", ownerId: owner });
  }, [account, owner]);
  if (owner === null || hq === null) return { kind: "idle" };
  if (read.kind === "read")
    return read.detail.change.state === "open" && read.detail.change.head === null
      ? { kind: "gone", readAgain }
      : { kind: "read", pull: pull! };
  return { ...read, ...(read.kind === "gone" || read.kind === "unavailable" ? { readAgain } : {}) };
}
