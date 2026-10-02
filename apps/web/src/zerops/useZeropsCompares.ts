/**
 * The comparisons HQ is asked for (`GET /api/apps/:appId/repos/:repo/compare`), read as the person
 * through the organization's official HQ: what a release puts live (`releaseReads`), what a
 * release carried (`carriedReads`), and a repository's history.
 *
 * Two commits compare the same for ever, so each comparison is asked once and held for as long as
 * HQ is the same one, whichever surface asked for it first — one store per HQ for the whole tab.
 * A comparison HQ did not answer says why (`movedCommits` reads it as such), and is asked again a
 * minute later by whoever still wants it.
 */
import { compareReadKey, type CompareRead } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { CompareResponse } from "@t3tools/shared/hqChanges";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { useOfficialHq } from "./accountHq";

/** How long a comparison HQ did not answer waits before it is asked again. */
export const COMPARES_RETRY_MS = 60_000;

/** One application's comparisons as HQ answered them, held under `compareReadKey`. */
export interface AppCompares {
  readonly answers: ReadonlyMap<string, CompareResponse>;
  /** Why a comparison was not answered, while it is not. */
  readonly failures: ReadonlyMap<string, string>;
}

/** Each asking application's comparisons, by its id. */
export type ZeropsCompares = ReadonlyMap<string, AppCompares>;

/** What one HQ answered, by application and read (`appKey`), as one immutable snapshot. */
interface Snapshot {
  readonly answers: ReadonlyMap<string, CompareResponse>;
  readonly failures: ReadonlyMap<string, string>;
  /** Asked and not due again: on its way, answered, or failed less than a minute ago. */
  readonly asked: ReadonlySet<string>;
}

interface Store {
  snapshot: Snapshot;
  readonly listeners: Set<() => void>;
}

/** One store per HQ address, for the whole tab. */
const stores = new Map<string, Store>();

function storeAt(address: string): Store {
  let store = stores.get(address);
  if (store === undefined) {
    store = {
      snapshot: { answers: new Map(), failures: new Map(), asked: new Set() },
      listeners: new Set(),
    };
    stores.set(address, store);
  }
  return store;
}

function update(store: Store, next: (snapshot: Snapshot) => Snapshot): void {
  store.snapshot = next(store.snapshot);
  for (const listener of store.listeners) listener();
}

const NOTHING_HELD: Snapshot = { answers: new Map(), failures: new Map(), asked: new Set() };

/** A read of one application, as it is held. */
const appKey = (appId: string, read: CompareRead): string =>
  JSON.stringify([appId, compareReadKey(read)]);

export function useZeropsCompares(
  /** Each application's comparisons to ask, by its id. */
  asks: ReadonlyMap<string, ReadonlyArray<CompareRead>>,
): ZeropsCompares {
  const hq = useOfficialHq();
  const store = hq === null ? null : storeAt(hq.address);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (store === null) return () => undefined;
      store.listeners.add(listener);
      return () => {
        store.listeners.delete(listener);
      };
    },
    [store],
  );
  const snapshot = useSyncExternalStore(subscribe, () => store?.snapshot ?? NOTHING_HELD);
  // The reads wanted and not asked yet, one string whatever the identity of the plans they are in.
  const due = JSON.stringify(
    [...asks].flatMap(([appId, reads]) =>
      reads.filter((read) => !snapshot.asked.has(appKey(appId, read))).map((read) => [appId, read]),
    ),
  );

  useEffect(() => {
    if (hq === null || store === null) return;
    for (const [appId, read] of JSON.parse(due) as Array<[string, CompareRead]>) {
      const key = appKey(appId, read);
      if (store.snapshot.asked.has(key)) continue;
      update(store, (held) => ({ ...held, asked: new Set(held.asked).add(key) }));
      void hq.api.compare(appId, read.repository, read.query).then(
        (answer) => {
          update(store, (held) => {
            const failures = new Map(held.failures);
            failures.delete(key);
            return { ...held, answers: new Map(held.answers).set(key, answer), failures };
          });
        },
        (cause: unknown) => {
          update(store, (held) => ({
            ...held,
            failures: new Map(held.failures).set(key, zeropsErrorMessage(cause)),
          }));
          // A minute later it is due again, for whoever still wants it.
          setTimeout(() => {
            update(store, (held) => {
              const asked = new Set(held.asked);
              asked.delete(key);
              return { ...held, asked };
            });
          }, COMPARES_RETRY_MS);
        },
      );
    }
  }, [due, hq, store]);

  return useMemo(
    () =>
      new Map(
        [...asks].map(([appId, reads]) => {
          const answers = new Map<string, CompareResponse>();
          const failures = new Map<string, string>();
          for (const read of reads) {
            const key = appKey(appId, read);
            const answer = snapshot.answers.get(key);
            const failure = snapshot.failures.get(key);
            if (answer !== undefined) answers.set(compareReadKey(read), answer);
            if (failure !== undefined) failures.set(compareReadKey(read), failure);
          }
          return [appId, { answers, failures }];
        }),
      ),
    [asks, snapshot],
  );
}
