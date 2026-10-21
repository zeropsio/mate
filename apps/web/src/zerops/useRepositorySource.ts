import {
  makeRepositorySourceReads,
  repositorySource,
  type AccountStore,
} from "@t3tools/client-runtime/data";
import type { HqApi, RepositoryTarget } from "@t3tools/client-runtime/zerops/hq";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect, useMemo } from "react";
import { useOfficialHq } from "./accountHq";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";

const UNREAD = Atom.make({
  state: "unread",
  words: "Waiting for HQ…",
  alert: false,
  busy: false,
} as const);
const readers = new WeakMap<
  AccountStore,
  WeakMap<HqApi, ReturnType<typeof makeRepositorySourceReads>>
>();
function readerFor(store: AccountStore, api: HqApi) {
  let byApi = readers.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    readers.set(store, byApi);
  }
  let reader = byApi.get(api);
  if (reader === undefined) {
    reader = makeRepositorySourceReads(store, api);
    byApi.set(api, reader);
    onAccountLifetimeClose(reader.close);
  }
  return reader;
}
/** One source read of a repository, or none where the page reads no source yet. */
export function useRepositorySource(input: RepositoryTarget | null, allowed: boolean | undefined) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const appId = input?.appId;
  const repo = input?.repo;
  const rev = input?.query.rev;
  const path = input?.query.path;
  const kind = input?.query.kind;
  const orgId = useAccountOrgId();
  const target = useMemo(
    () =>
      appId === undefined || repo === undefined || path === undefined || kind === undefined
        ? null
        : { appId, repo, query: { ...(rev === undefined ? {} : { rev }), path, kind } },
    [appId, repo, rev, path, kind],
  );
  const key = useMemo(
    () => (orgId === null || target === null ? null : { orgId, target }),
    [orgId, target],
  );
  const reader = store === null || hq === null ? null : readerFor(store, hq.api);
  const source = useAtomValue(
    store === null || key === null
      ? UNREAD
      : store.data.project(repositorySource, { ...key, allowed }),
  );
  useEffect(() => {
    if (reader === null || key === null || allowed !== true) return;
    return reader.demand(key);
  }, [reader, key, allowed]);
  return {
    source,
    again: () => {
      if (reader !== null && key !== null && allowed === true) reader.again(key);
    },
  };
}
