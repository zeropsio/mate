/**
 * The organization's open read access requests (`makeReadAccessRequests`), read while `shown`. A
 * person asks for read access to an environment Zerops does not show them; an Admin gives it at
 * Zerops from this browser — `READ_ONLY` on that one project, on the person's own list
 * (`set-project-access`) — and then closes the request, or declines it. HQ grants nothing.
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

  /** Each step in turn, stopping at the first one refused; the list is read again after. */
  const run = useCallback(
    (at: string, steps: ReadonlyArray<Intent>) => {
      if (operations === null || host === null || key === null) return;
      const isCurrent = captureAccountLifetime();
      const said = (trouble: string | null) =>
        setTroubles(({ [at]: _was, ...rest }) =>
          trouble === null ? rest : { ...rest, [at]: trouble },
        );
      setBusy((held) => new Set(held).add(at));
      said(null);
      void (async () => {
        for (const step of steps) {
          const { progress, evidence } = await operations.submit(step);
          const trouble = writeTrouble(progress, evidence);
          if (trouble !== null) return trouble;
        }
        return null;
      })()
        .then(
          (trouble) => {
            if (isCurrent()) said(trouble);
          },
          (cause: unknown) => {
            if (isCurrent()) said(zeropsErrorMessage(cause));
          },
        )
        .finally(() => {
          if (!isCurrent()) return;
          host.again(key);
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
  return {
    read,
    busy,
    troubles,
    available,
    ask: (projectId: string) => {
      if (key !== null) run(projectId, [{ kind: "ask-read-access", orgId: key.orgId, projectId }]);
    },
    /** `give`: the person's `READ_ONLY` on the request's project, written at Zerops first. */
    grant: (request: ReadAccessRequest, give: Intent) => {
      if (key !== null)
        run(request.id, [
          give,
          { kind: "close-read-access", orgId: key.orgId, id: request.id, outcome: "granted" },
        ]);
    },
    decline: (request: ReadAccessRequest) => {
      if (key !== null)
        run(request.id, [
          { kind: "close-read-access", orgId: key.orgId, id: request.id, outcome: "declined" },
        ]);
    },
  };
}
