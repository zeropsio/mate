/** A review reads attachment bytes from its account projection and owns only detail demand. */
import { useAtomValue } from "@effect/atom-react";
import {
  hqPicture,
  pictureOwner,
  type AccountStore,
  type HqPictureKey,
} from "@t3tools/client-runtime/data";
import { parseAttachmentUrl } from "@t3tools/shared/hqChanges";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { useAccountHq } from "./accountHq";
import { useAccountDataOptional } from "./ZeropsAccountData";

export type ChangePictureState =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly src: string }
  | { readonly kind: "failed"; readonly reason: string };

/** The projection and demand port a review uses; fixtures supply the same store contract. */
export interface ChangePictureSource {
  readonly data: AccountStore["data"];
  readonly key: (url: string) => HqPictureKey | null;
  readonly demand: (ownerId: string) => () => void;
}

const READING = Atom.make({ kind: "reading" } as const);
const INVALID = Atom.make({
  kind: "failed",
  reason: "That picture is not a change's picture at this HQ.",
} as const);

export function useHqPictureSource(): ChangePictureSource | undefined {
  const account = useAccountDataOptional();
  const orgId = account?.orgId ?? null;
  const { hq } = useAccountHq(orgId ?? undefined);
  const address = hq.kind === "official" ? hq.address : null;
  return useMemo(
    () =>
      account === null || orgId === null || address === null
        ? undefined
        : {
            data: account.data,
            key: (url: string) => {
              const link = parseAttachmentUrl(url, address);
              return link === null ? null : { orgId, link };
            },
            demand: (ownerId: string) => account.demandDetail({ family: "hqPicture", ownerId }),
          },
    [account, address, orgId],
  );
}

export function useProjectedHqPicture(
  source: ChangePictureSource | undefined,
  url: string,
  visible = true,
): ChangePictureState {
  const key = source?.key(url) ?? null;
  const ownerId = key === null ? null : pictureOwner(key.link);
  const read = useAtomValue(
    source === undefined ? READING : key === null ? INVALID : source.data.project(hqPicture, key),
  );
  useEffect(() => {
    if (!visible || source === undefined || ownerId === null) return;
    return source.demand(ownerId);
  }, [ownerId, source, visible]);
  const blob = read.kind === "read" ? read.blob : null;
  const [objectUrl, setObjectUrl] = useState<{ readonly blob: Blob; readonly src: string } | null>(
    null,
  );
  // Allocate only for a committed view; abandoned React renders own no browser resource.
  useLayoutEffect(() => {
    if (blob === null) {
      setObjectUrl(null);
      return;
    }
    const src = URL.createObjectURL(blob);
    setObjectUrl({ blob, src });
    return () => URL.revokeObjectURL(src);
  }, [blob]);
  const src = objectUrl !== null && objectUrl.blob === blob ? objectUrl.src : null;
  return read.kind === "read" && src !== null
    ? { kind: "read", src }
    : read.kind === "failed"
      ? read
      : { kind: "reading" };
}
