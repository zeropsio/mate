/**
 * What a review reads of one change beyond what the flow carries (pass 16, R4 · R8; SPEC §3.2a):
 * HQ's detail of it — the files it changes with their diffs, the commits it squashes, how it
 * merges into `main` and whether `main` moved on under it — in one read (`changeReadout.ts`).
 *
 * Read when the review opens, never polled, and kept per head and per `main`: a push moves the
 * head, and `main` moves only by HQ's own merge, which comes down HQ's stream as a landed change
 * (`main`, the newest landed one's commit). Either is a new question; the same ones read the same,
 * so opening it again paints at once with nothing to wait for. A read that failed is asked again on
 * *Try again* (`retry`), or the next time it opens. What is kept is bounded by count and by size.
 */
import { changeReadout, type ChangeReadout } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { useCallback, useEffect, useState } from "react";

import { LRUCache } from "~/lib/lruCache";

import { useOfficialHq } from "./accountHq";

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

const NONE = { kind: "none" } as const;
const READING = { kind: "reading" } as const;

/** Reads kept, the least recently used going first past either bound. */
const KEPT = 24;
const KEPT_BYTES = 16 * 1024 * 1024;

const settled = new LRUCache<ReadoutPart<ChangeReadout>>(KEPT, KEPT_BYTES);
const inflight = new Map<string, Promise<ReadoutPart<ChangeReadout>>>();

/** One read per key at a time; a read that answered is kept, one that failed is not. */
function readOnce(
  key: string,
  api: Pick<HqApi, "change">,
  link: ChangeLink,
): Promise<ReadoutPart<ChangeReadout>> {
  const running = inflight.get(key);
  if (running !== undefined) return running;
  const next = api.change(link).then(
    (detail): ReadoutPart<ChangeReadout> => {
      const part = { kind: "read", value: changeReadout(detail) } as const;
      // Held as lines, a diff weighs about three times its text.
      const bytes = detail.files.reduce((sum, file) => sum + file.hunks.length * 3, 1024);
      settled.set(key, part, bytes);
      return part;
    },
    (cause: unknown): ReadoutPart<ChangeReadout> => ({
      kind: "failed",
      reason: zeropsErrorMessage(cause),
    }),
  );
  inflight.set(key, next);
  void next.finally(() => inflight.delete(key));
  return next;
}

/** Forgets every kept read — for tests. */
export function forgetChangeDetails(): void {
  settled.clear();
  inflight.clear();
}

export function useZeropsChangeDetail(
  request: ZeropsChangeDetailRequest | null,
): ZeropsChangeDetail {
  const hq = useOfficialHq();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);
  const link = request?.link;
  const key =
    request === null || hq === null || request.head === undefined || link === undefined
      ? null
      : `${hq.address}|${link.appId}/${link.repo}#${String(link.number)}@${request.head}|${request.main ?? ""}`;
  const initial = (): ReadoutPart<ChangeReadout> =>
    key === null ? NONE : (settled.get(key) ?? READING);
  const [held, setHeld] = useState<{
    readonly key: string | null;
    readonly attempt: number;
    readonly part: ReadoutPart<ChangeReadout>;
  }>(() => ({ key, attempt, part: initial() }));
  let part = held.part;
  // Another question, or *Try again* after a failure: it is read again where it stood.
  if (held.key !== key || (held.attempt !== attempt && held.part.kind === "failed")) {
    part = initial();
    setHeld({ key, attempt, part });
  }
  const reading = part.kind === "reading";
  const appId = link?.appId;
  const repo = link?.repo;
  const number = link?.number;
  useEffect(() => {
    if (!reading || key === null || hq === null) return;
    if (appId === undefined || repo === undefined || number === undefined) return;
    let live = true;
    void readOnce(key, hq.api, { appId, repo, number }).then((answer) => {
      if (!live) return;
      setHeld((current) =>
        current.key === key && current.attempt === attempt ? { ...current, part: answer } : current,
      );
    });
    return () => {
      live = false;
    };
  }, [appId, attempt, hq, key, number, reading, repo]);
  return { readout: part, retry };
}
