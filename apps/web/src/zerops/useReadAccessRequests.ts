/**
 * The organization's open read access requests (`makeReadAccessRequests`), read while `shown`. A
 * person asks for read access to an environment Zerops does not show them; an Admin grants it — one
 * access change HQ runs (`start-access-changes`, `readAccess`), which gives `READ_ONLY` on that one
 * project unless the person reaches it already and then deletes the request — or declines it.
 */
import {
  makeReadAccessRequests,
  orgReadAccessRequests,
  type AccountStore,
  type ReadAccessRead,
} from "@t3tools/client-runtime/data";
import type { HqApi, ReadAccessRequest } from "@t3tools/client-runtime/zerops/hq";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useOfficialHq } from "./accountHq";
import { captureAccountLifetime, onAccountLifetimeClose } from "./accountLifetime";
import { useAccountOperationsOptional, type AccountOperations } from "./accountOperations";
import { useAccountOrgId, useAccountStoreForAdapters } from "./ZeropsAccountData";
import { randomUUID } from "~/lib/utils";
import { writeTrouble } from "./zeropsWrite";

type Intent = Parameters<AccountOperations["submit"]>[0];

const UNREAD = Atom.make<ReadAccessRead>({ state: "unread" });

const hosts = new WeakMap<
  AccountStore,
  WeakMap<HqApi, ReturnType<typeof makeReadAccessRequests>>
>();
function hostFor(store: AccountStore, api: HqApi) {
  let byApi = hosts.get(store);
  if (byApi === undefined) {
    byApi = new WeakMap();
    hosts.set(store, byApi);
  }
  let host = byApi.get(api);
  if (host === undefined) {
    host = makeReadAccessRequests({ store, api });
    byApi.set(api, host);
    onAccountLifetimeClose(host.close);
  }
  return host;
}

export function useReadAccessRequests(shown: boolean) {
  const hq = useOfficialHq();
  const store = useAccountStoreForAdapters();
  const orgId = useAccountOrgId();
  const operations = useAccountOperationsOptional();
  const key = useMemo(() => (orgId === null ? null : { orgId }), [orgId]);
  const host = hq === null || store === null ? null : hostFor(store, hq.api);
  const read = useAtomValue(
    store === null || key === null ? UNREAD : store.data.project(orgReadAccessRequests, key),
  );
  useEffect(() => {
    if (shown && host !== null && key !== null) return host.demand(key);
  }, [host, key, shown]);

  /** Projects and requests being written now, and what a refusal said, by the same key. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [troubles, setTroubles] = useState<Readonly<Record<string, string>>>({});

  /**
   * One write; the list is read again after, and `at` stays busy until that read lands, so nothing
   * asks, grants or declines twice.
   */
  const run = useCallback(
    (at: string, intent: Intent) => {
      if (operations === null || host === null || key === null) return;
      const isCurrent = captureAccountLifetime();
      const said = (trouble: string | null) =>
        setTroubles(({ [at]: _was, ...rest }) =>
          trouble === null ? rest : { ...rest, [at]: trouble },
        );
      setBusy((held) => new Set(held).add(at));
      said(null);
      void operations
        .submit(intent)
        .then(({ progress, evidence }) => writeTrouble(progress, evidence))
        .then(
          (trouble) => {
            if (isCurrent()) said(trouble);
          },
          (cause: unknown) => {
            if (isCurrent()) said(zeropsErrorMessage(cause));
          },
        )
        .then(() => host.again(key))
        .finally(() => {
          if (!isCurrent()) return;
          setBusy((held) => {
            const left = new Set(held);
            left.delete(at);
            return left;
          });
        });
    },
    [host, key, operations],
  );

  const available = operations !== null && host !== null && key !== null;
  /** Reads the list again: a grant HQ ended took its request away. */
  const again = useCallback(() => {
    if (host !== null && key !== null) void host.again(key);
  }, [host, key]);
  return {
    read,
    busy,
    troubles,
    available,
    again,
    ask: (projectId: string) => {
      if (key !== null) run(projectId, { kind: "ask-read-access", orgId: key.orgId, projectId });
    },
    /**
     * The request granted at HQ: the person's `READ_ONLY` on its project, or nothing at Zerops
     * where they reach it already, and the request ends with it.
     */
    grant: (request: ReadAccessRequest) => {
      if (key !== null)
        run(request.id, {
          kind: "start-access-changes",
          orgId: key.orgId,
          changes: [{ id: randomUUID(), change: { kind: "readAccess", requestId: request.id } }],
        });
    },
    decline: (request: ReadAccessRequest) => {
      if (key !== null)
        run(request.id, {
          kind: "close-read-access",
          orgId: key.orgId,
          id: request.id,
          outcome: "declined",
        });
    },
  };
}
