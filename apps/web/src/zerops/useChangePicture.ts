/**
 * A change's picture, read from the organization's official HQ as the person and shown from its
 * bytes.
 *
 * A change's description carries its screenshots as pictures HQ keeps with the change (SPEC
 * §3.2a), which answer nobody without a session — and a page's own `<img>` carries none. So the
 * bytes are read through HQ's API (`changeAttachment`, which reads nothing but a change's picture
 * at that HQ) and shown through a blob URL. Where the bytes are read from is handed in
 * ({@link ChangePictureSource}), so a harness shows a slow picture and a failed one without an HQ
 * behind it. A picture that cannot be read says so where it stands; one is read only once its
 * source is known.
 *
 * What was read is kept by address for the tab, so a review opened again shows its pictures at
 * once, and one read in flight is shared by every picture asking for it. The oldest go first past
 * {@link KEPT_PICTURES}, their blob URLs revoked. A picture that could not be read is not kept: the
 * next look asks again.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { parseAttachmentUrl } from "@t3tools/shared/hqChanges";
import { useEffect, useMemo, useState } from "react";

import { useOfficialHq } from "./accountHq";

export type ChangePictureState =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly src: string }
  | { readonly kind: "failed"; readonly reason: string };

/** Where a review reads its description's pictures from. */
export interface ChangePictureSource {
  /** One picture's bytes, read as the person. */
  readonly read: (url: string) => Promise<Blob>;
}

/** Pictures kept, the least recently read going first. */
const KEPT_PICTURES = 48;

const kept = new Map<string, string>();
const inflight = new Map<string, Promise<ChangePictureState>>();

function keep(url: string, src: string): void {
  kept.delete(url);
  kept.set(url, src);
  while (kept.size > KEPT_PICTURES) {
    const oldest = kept.keys().next();
    if (oldest.done === true) break;
    const stale = kept.get(oldest.value);
    kept.delete(oldest.value);
    if (stale !== undefined) URL.revokeObjectURL(stale);
  }
}

function readPicture(source: ChangePictureSource, url: string): Promise<ChangePictureState> {
  const running = inflight.get(url);
  if (running !== undefined) return running;
  const next = source.read(url).then(
    (blob): ChangePictureState => {
      const src = URL.createObjectURL(blob);
      keep(url, src);
      return { kind: "read", src };
    },
    (cause: unknown): ChangePictureState => ({ kind: "failed", reason: zeropsErrorMessage(cause) }),
  );
  inflight.set(url, next);
  void next.finally(() => inflight.delete(url));
  return next;
}

function known(url: string): ChangePictureState {
  const src = kept.get(url);
  return src === undefined ? { kind: "reading" } : { kind: "read", src };
}

/** An HQ as a picture source: a change's pictures at its address, read through its API. */
export function hqPictureSource(hq: {
  readonly address: string;
  readonly api: Pick<HqApi, "changeAttachment">;
}): ChangePictureSource {
  return {
    read: (url) => {
      const link = parseAttachmentUrl(url, hq.address);
      return link === null
        ? Promise.reject(new Error("That picture is not a change's picture at this HQ."))
        : hq.api.changeAttachment(link);
    },
  };
}

/** The organization's official HQ as a picture source; `undefined` until it is known. */
export function useHqPictureSource(): ChangePictureSource | undefined {
  const hq = useOfficialHq();
  return useMemo(() => (hq === null ? undefined : hqPictureSource(hq)), [hq]);
}

export function useChangePicture(
  source: ChangePictureSource | undefined,
  url: string,
  visible = true,
): ChangePictureState {
  const [held, setHeld] = useState<{ readonly url: string; readonly state: ChangePictureState }>(
    () => ({ url, state: known(url) }),
  );
  let state = held.state;
  if (held.url !== url) {
    state = known(url);
    setHeld({ url, state });
  }
  const reading = state.kind === "reading";
  useEffect(() => {
    if (!visible || source === undefined || !reading) return;
    let live = true;
    void readPicture(source, url).then((answer) => {
      if (live) setHeld((current) => (current.url === url ? { url, state: answer } : current));
    });
    return () => {
      live = false;
    };
  }, [reading, source, url, visible]);
  return state;
}
