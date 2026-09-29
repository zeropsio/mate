/**
 * What a review reads of one change beyond what the flow carries (pass 16, R4 · R8): the
 * files it changes with their +/−, its whole diff, how many commits it squashes, and — for a
 * change `main` moved under — what `main` did since the branch was cut.
 *
 * Read when the review opens, never polled, and kept per head sha: a change whose head did not
 * move reads the same, so opening it again paints at once with nothing to wait for, and a head
 * that moved is a new question. Each part answers on its own — the file list is small and
 * quick, a diff of fifty files is not — and a part that failed is asked again next time.
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
}

export interface ZeropsChangeReadout {
  readonly files: ReadoutPart<ReadonlyArray<GiteaChangedFile>>;
  readonly diff: ReadoutPart<ReadonlyMap<string, ChangeDiffFile>>;
  /** How many commits it squashes. */
  readonly commits: ReadoutPart<number>;
  /** `main`'s commits since the branch was cut, each with the files it touched; `none` when it did not move. */
  readonly mainSince: ReadoutPart<ReadonlyArray<GiteaCommit>>;
}

const NONE = { kind: "none" } as const;
const READING = { kind: "reading" } as const;

/** Reads kept per key, newest last; the oldest go once there are more than this. */
const KEPT = 24;
const settled = new Map<string, ReadoutPart<unknown>>();
const inflight = new Map<string, Promise<ReadoutPart<unknown>>>();

function keep(key: string, part: ReadoutPart<unknown>): void {
  settled.delete(key);
  settled.set(key, part);
  while (settled.size > KEPT) {
    const oldest = settled.keys().next().value;
    if (oldest === undefined) break;
    settled.delete(oldest);
  }
}

/** One read per key at a time; a read that answered is kept, one that failed is not. */
function readOnce<T>(key: string, read: () => Promise<T>): Promise<ReadoutPart<T>> {
  const running = inflight.get(key);
  if (running !== undefined) return running as Promise<ReadoutPart<T>>;
  const next = read().then(
    (value): ReadoutPart<T> => {
      const part = { kind: "read", value } as const;
      keep(key, part);
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

type Reader<T> = (client: GiteaClient) => Promise<T>;

function usePart<T>(
  key: string | null,
  read: Reader<T>,
  giteaOrigin: string | undefined,
): ReadoutPart<T> {
  const readable = useGiteaReadable(giteaOrigin);
  const initial = (): ReadoutPart<T> =>
    key === null ? NONE : ((settled.get(key) as ReadoutPart<T> | undefined) ?? READING);
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
    if (key === null || giteaOrigin === undefined || !readable || settled.has(key)) return;
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
    (client) =>
      client.pullRequestFiles(owner ?? "", request?.repository ?? "", request?.number ?? 0),
    origin,
  );
  const diff = usePart(
    at === null ? null : `diff|${at}`,
    async (client) =>
      parseChangeDiff(
        await client.pullRequestDiff(owner ?? "", request?.repository ?? "", request?.number ?? 0),
      ),
    origin,
  );
  const commits = usePart(
    at === null ? null : `commits|${at}|${request?.baseSha ?? request?.baseBranch ?? ""}`,
    async (client) =>
      (
        await client.compareCommits(
          owner ?? "",
          request?.repository ?? "",
          request?.baseBranch ?? "main",
          head ?? "",
        )
      ).length,
    origin,
  );
  const mainSince = usePart(
    at === null || !moved
      ? null
      : `since|${at}|${request.mergeBase ?? ""}...${request.baseSha ?? ""}`,
    (client) =>
      client.compareCommits(
        owner ?? "",
        request?.repository ?? "",
        request?.mergeBase ?? "",
        request?.baseSha ?? "",
      ),
    origin,
  );
  return { files, diff, commits, mainSince };
}
