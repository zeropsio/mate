/**
 * What a review reads of one change beyond what the flow carries (pass 16, R4 · R8): the
 * files it changes with their +/−, its diff, how many commits it squashes, and — for a change
 * `main` moved under — what `main` did since the branch was cut.
 *
 * Read when the review opens, never polled, and kept per head sha: a change whose head did not
 * move reads the same, so opening it again paints at once with nothing to wait for, and a head
 * that moved is a new question. Each part answers on its own — the file list is small and
 * quick, a diff of fifty files is not — and a part that failed is asked again next time.
 *
 * The diff is read only once a file is opened, and no further than {@link DIFF_READ_BYTES}: a
 * change that regenerates a lockfile can run to hundreds of megabytes. What is kept is bounded
 * by count and by size.
 */
import {
  parseChangeDiff,
  type ChangeDiffFile,
  type GiteaChangedFile,
  type GiteaClient,
  type GiteaCommit,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useRef, useState } from "react";

import { LRUCache } from "~/lib/lruCache";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

export type ReadoutPart<T> =
  | { readonly kind: "none" }
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly value: T }
  | { readonly kind: "failed"; readonly reason: string };

export interface ZeropsChangeReadoutRequest {
  readonly giteaOrigin: string | undefined;
  readonly owner: string | undefined;
  readonly repository: string;
  readonly number: number;
  /** The head the person is shown; nothing is read without one. */
  readonly headSha: string | undefined;
  readonly baseBranch: string;
  /** The commit the branch last shared with the base, as Gitea tested it. */
  readonly mergeBase: string | undefined;
  /** The base's head as read: past {@link mergeBase}, `main` moved on. */
  readonly baseSha: string | undefined;
  /** Whether its diff is wanted yet — once a file is opened. */
  readonly diff: boolean;
}

/** A diff as far as it was read: `cut` where it was too long to read whole. */
export interface ChangeDiffRead {
  readonly files: ReadonlyMap<string, ChangeDiffFile>;
  readonly cut: boolean;
}

export interface ZeropsChangeReadout {
  /** The head every part was read for: the one Merge takes, never a newer one read since. */
  readonly head: string | undefined;
  readonly files: ReadoutPart<ReadonlyArray<GiteaChangedFile>>;
  /** `none` until a file is opened. */
  readonly diff: ReadoutPart<ChangeDiffRead>;
  /** How many commits it squashes. */
  readonly commits: ReadoutPart<number>;
  /** `main`'s commits since the branch was cut, each with the files it touched; `none` when it did not move. */
  readonly mainSince: ReadoutPart<ReadonlyArray<GiteaCommit>>;
}

const NONE = { kind: "none" } as const;
const READING = { kind: "reading" } as const;

/** How much of a diff is read: past it, the review says so and links the rest on Gitea. */
export const DIFF_READ_BYTES = 2 * 1024 * 1024;
/** Reads kept, the least recently used going first past either bound. */
const KEPT = 24;
const KEPT_BYTES = 16 * 1024 * 1024;
/** What a read that is not a diff is taken to weigh. */
const LIGHT = 1024;

const settled = new LRUCache<ReadoutPart<unknown>>(KEPT, KEPT_BYTES);
const inflight = new Map<string, Promise<ReadoutPart<unknown>>>();

/** A read's answer, and roughly what keeping it weighs. */
interface Weighed<T> {
  readonly value: T;
  readonly bytes: number;
}

const light = <T>(value: T): Weighed<T> => ({ value, bytes: LIGHT });

/** One read per key at a time; a read that answered is kept, one that failed is not. */
function readOnce<T>(key: string, read: () => Promise<Weighed<T>>): Promise<ReadoutPart<T>> {
  const running = inflight.get(key);
  if (running !== undefined) return running as Promise<ReadoutPart<T>>;
  const next = read().then(
    ({ value, bytes }): ReadoutPart<T> => {
      const part = { kind: "read", value } as const;
      settled.set(key, part, bytes);
      return part;
    },
    (cause: unknown): ReadoutPart<T> => ({ kind: "failed", reason: zeropsErrorMessage(cause) }),
  );
  inflight.set(key, next);
  void next.finally(() => inflight.delete(key));
  return next;
}

/** Forgets every kept read — for tests. */
export function forgetChangeReadouts(): void {
  settled.clear();
  inflight.clear();
}

type Reader<T> = (client: GiteaClient) => Promise<Weighed<T>>;

function usePart<T>(
  key: string | null,
  read: Reader<T>,
  giteaOrigin: string | undefined,
): ReadoutPart<T> {
  const readable = useGiteaReadable(giteaOrigin);
  const initial = (): ReadoutPart<T> =>
    key === null ? NONE : ((settled.get(key) as ReadoutPart<T> | null) ?? READING);
  const [held, setHeld] = useState<{ readonly key: string | null; readonly part: ReadoutPart<T> }>(
    () => ({ key, part: initial() }),
  );
  let part = held.part;
  if (held.key !== key) {
    part = initial();
    setHeld({ key, part });
  }
  const latestRead = useRef(read);
  useEffect(() => {
    latestRead.current = read;
  });
  useEffect(() => {
    if (key === null || giteaOrigin === undefined || !readable || settled.get(key) !== null) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    let live = true;
    void readOnce(key, () => latestRead.current(client)).then((answer) => {
      if (live) setHeld({ key, part: answer });
    });
    return () => {
      live = false;
    };
  }, [giteaOrigin, key, readable]);
  return part;
}

export function useZeropsChangeReadout(
  request: ZeropsChangeReadoutRequest | null,
): ZeropsChangeReadout {
  const origin = request?.giteaOrigin;
  const owner = request?.owner;
  const head = request?.headSha;
  const at =
    request === null || origin === undefined || owner === undefined || head === undefined
      ? null
      : `${origin}|${owner}/${request.repository}#${String(request.number)}@${head}`;
  const moved =
    request?.mergeBase !== undefined &&
    request.baseSha !== undefined &&
    request.mergeBase !== request.baseSha;
  const files = usePart(
    at === null ? null : `files|${at}`,
    async (client) =>
      light(
        await client.pullRequestFiles(owner ?? "", request?.repository ?? "", request?.number ?? 0),
      ),
    origin,
  );
  const diff = usePart<ChangeDiffRead>(
    at === null || request?.diff !== true ? null : `diff|${at}`,
    async (client) => {
      const { text, cut } = await client.pullRequestDiff(
        owner ?? "",
        request?.repository ?? "",
        request?.number ?? 0,
        DIFF_READ_BYTES,
      );
      // Held as lines, a diff weighs about three times its text.
      return { value: { files: parseChangeDiff(text, { cut }), cut }, bytes: text.length * 3 };
    },
    origin,
  );
  const commits = usePart(
    at === null ? null : `commits|${at}|${request?.baseSha ?? request?.baseBranch ?? ""}`,
    async (client) =>
      light(
        (
          await client.compareCommits(
            owner ?? "",
            request?.repository ?? "",
            request?.baseBranch ?? "main",
            head ?? "",
          )
        ).length,
      ),
    origin,
  );
  const mainSince = usePart(
    at === null || !moved
      ? null
      : `since|${at}|${request.mergeBase ?? ""}...${request.baseSha ?? ""}`,
    async (client) =>
      light(
        await client.compareCommits(
          owner ?? "",
          request?.repository ?? "",
          request?.mergeBase ?? "",
          request?.baseSha ?? "",
        ),
      ),
    origin,
  );
  return { head: at === null ? undefined : head, files, diff, commits, mainSince };
}
