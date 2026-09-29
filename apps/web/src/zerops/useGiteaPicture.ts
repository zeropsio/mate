/**
 * A picture on the account's Gitea, read as the person and shown from its bytes.
 *
 * A change's description carries its screenshots as attachments of a private repository, which
 * answer nobody without a token — and a page's own `<img>` carries none. So the bytes are read
 * through the person's Gitea session (`GiteaClient.picture`, which reads nothing off its own
 * Gitea) and shown through a blob URL. Where they are read from is handed in
 * ({@link GiteaPictureSource}), so a harness shows a slow picture and a failed one without a
 * Gitea behind it — and so a route of the broker's that reads them for the person can take the
 * Gitea's place: from a browser the Gitea's own read fails today, at its preflight (a 303, no CORS
 * headers), quickly and with no status. A picture that cannot be read says so where it stands.
 *
 * What was read is kept by address for the tab, so a review opened again shows its pictures at
 * once, and one read in flight is shared by every picture asking for it. The oldest go first past
 * {@link KEPT_PICTURES}, their blob URLs revoked. A picture that could not be read is not kept: the
 * next look asks again.
 */
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useMemo, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

export type GiteaPictureState =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly src: string }
  | { readonly kind: "failed"; readonly reason: string };

/** Where a review reads its description's pictures from. */
export interface GiteaPictureSource {
  /** A request can go out now: the session holds a token. */
  readonly ready: boolean;
  /** One picture's bytes, read as the person. */
  readonly read: (url: string) => Promise<Blob>;
}

/** Pictures kept, the least recently read going first. */
const KEPT_PICTURES = 48;

const kept = new Map<string, string>();
const inflight = new Map<string, Promise<GiteaPictureState>>();

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

function readPicture(source: GiteaPictureSource, url: string): Promise<GiteaPictureState> {
  const running = inflight.get(url);
  if (running !== undefined) return running;
  const next = source.read(url).then(
    (blob): GiteaPictureState => {
      const src = URL.createObjectURL(blob);
      keep(url, src);
      return { kind: "read", src };
    },
    (cause: unknown): GiteaPictureState => ({ kind: "failed", reason: zeropsErrorMessage(cause) }),
  );
  inflight.set(url, next);
  void next.finally(() => inflight.delete(url));
  return next;
}

function known(url: string): GiteaPictureState {
  const src = kept.get(url);
  return src === undefined ? { kind: "reading" } : { kind: "read", src };
}

/** The account's Gitea as a picture source: its session's token, its client. */
export function useGiteaPictureSource(
  giteaOrigin: string | undefined,
): GiteaPictureSource | undefined {
  const ready = useGiteaReadable(giteaOrigin);
  return useMemo(
    () =>
      giteaOrigin === undefined
        ? undefined
        : {
            ready,
            read: (url: string) => {
              const client = giteaClientFor(giteaOrigin);
              return client === null
                ? Promise.reject(new Error("You are not signed in to Gitea."))
                : client.picture(url);
            },
          },
    [giteaOrigin, ready],
  );
}

const NO_SOURCE: GiteaPictureState = {
  kind: "failed",
  reason: "There is no Gitea to read it from.",
};

export function useGiteaPicture(
  source: GiteaPictureSource | undefined,
  url: string,
): GiteaPictureState {
  const [held, setHeld] = useState<{ readonly url: string; readonly state: GiteaPictureState }>(
    () => ({ url, state: known(url) }),
  );
  let state = held.state;
  if (held.url !== url) {
    state = known(url);
    setHeld({ url, state });
  }
  const reading = state.kind === "reading";
  useEffect(() => {
    if (source === undefined || !source.ready || !reading) return;
    let live = true;
    void readPicture(source, url).then((answer) => {
      if (live) setHeld((current) => (current.url === url ? { url, state: answer } : current));
    });
    return () => {
      live = false;
    };
  }, [reading, source, url]);
  return source === undefined ? NO_SOURCE : state;
}
