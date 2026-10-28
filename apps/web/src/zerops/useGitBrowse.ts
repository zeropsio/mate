import {
  gitBrowse,
  makeGitBrowseReads,
  type AccountStore,
  type GitBrowseKey,
  type GitBrowseView,
} from "@t3tools/client-runtime/data";
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import type {
  GitBrowseParams,
  GitBrowseRead,
  GitBrowseValue,
} from "@t3tools/client-runtime/zerops/gitBrowse/reads";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo, useRef } from "react";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

/** One Git browser read of a repository: which read, and what it is asked. */
export interface GitBrowseRequest<R extends GitBrowseRead> {
  readonly appId: string;
  readonly repo: string;
  readonly read: R;
  readonly params: GitBrowseParams<R>;
}

const readers = new WeakMap<AccountStore, WeakMap<HqApi, ReturnType<typeof makeGitBrowseReads>>>();
function readerFor(store: AccountStore, api: HqApi) {
  let byApi = readers.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    readers.set(store, byApi);
  }
  let reader = byApi.get(api);
  if (reader === undefined) {
    reader = makeGitBrowseReads(store, api);
    byApi.set(api, reader);
    onAccountLifetimeClose(reader.close);
  }
  return reader;
}
const UNREAD = Atom.make<ReadonlyArray<GitBrowseView>>([]);

/**
 * Several reads of one kind held at once, each as its page draws it, in the order asked: the
 * pages of a list one "Show more" at a time. Read only while access is verified.
 */
export function useGitBrowseReads<R extends GitBrowseRead>(
  requests: ReadonlyArray<GitBrowseRequest<R>>,
  allowed: boolean | undefined,
) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const identity = JSON.stringify(requests.map((r) => [r.appId, r.repo, r.read, r.params]));
  // Keyed by the requests' value, not their identity: a render's fresh literal is the same read.
  const keys = useMemo(
    () =>
      orgId === null
        ? null
        : (JSON.parse(identity) as Array<[string, string, R, GitBrowseParams<R>]>).map(
            ([appId, repo, read, params]): GitBrowseKey<R> => ({
              orgId,
              appId,
              repo,
              read,
              params,
            }),
          ),
    [orgId, identity],
  );
  const reader = store === null || hq === null ? null : readerFor(store, hq.api);
  const views = useAtomValue(
    useMemo(
      () =>
        store === null || keys === null
          ? UNREAD
          : Atom.make((get) =>
              keys.map((key) => get(store.data.project(gitBrowse, { ...key, allowed }))),
            ),
      [store, keys, allowed],
    ),
  ) as ReadonlyArray<GitBrowseView<GitBrowseValue<R>>>;
  const held = useRef<Array<() => void>>([]);
  useEffect(() => {
    // Acquire the next set before releasing the previous one: a shared read must never lose
    // its last holder merely because this view opens another folder or page.
    const releases =
      reader !== null && keys !== null && allowed === true
        ? keys.map((key) => reader.demand(key))
        : [];
    held.current.forEach((release) => release());
    held.current = releases;
  }, [reader, keys, allowed]);
  useEffect(
    () => () => {
      held.current.forEach((release) => release());
      held.current = [];
    },
    [],
  );
  return {
    views,
    /** Reads every held read again: the newest of what moves, or what failed. */
    again: () => {
      if (reader !== null && keys !== null && allowed === true) keys.forEach(reader.again);
    },
  };
}

/** One read as its page draws it. */
export function useGitBrowse<R extends GitBrowseRead>(
  request: GitBrowseRequest<R>,
  allowed: boolean | undefined,
) {
  const { views, again } = useGitBrowseReads([request], allowed);
  const view: GitBrowseView<GitBrowseValue<R>> = views[0] ?? { state: "unread", busy: false };
  return { view, again };
}
