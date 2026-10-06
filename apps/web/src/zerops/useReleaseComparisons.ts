/**
 * The comparisons a surface shows — what a release puts live (`releaseReads`), what a release
 * carried (`carriedReads`), a repository's history — asked of the organization's HQ on its socket
 * while the surface is drawn, and only then: nothing compares a release nobody is looking at. What
 * HQ answered is held with the surface, in memory, and asked again only for a comparison that
 * failed, when the person presses Compare again.
 */
import {
  compareReadKey,
  type CompareRead,
  type MovedCommits,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { CompareResponse } from "@t3tools/shared/hqChanges";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAccountDataOptional, type AccountData } from "./ZeropsAccountData";

/** One application's comparisons as HQ answered them, held under `compareReadKey`. */
export interface AppCompares {
  readonly answers: ReadonlyMap<string, CompareResponse>;
  /** Why a comparison was not answered, while it is not. */
  readonly failures: ReadonlyMap<string, string>;
  /** Asks the selected failed comparisons once more. */
  readonly again: (reads: ReadonlyArray<CompareRead>) => void;
}

/** What the surface was answered, by application and read (`appKey`). */
interface Held {
  readonly answers: ReadonlyMap<string, CompareResponse>;
  readonly failures: ReadonlyMap<string, string>;
  /** Asked: on its way, answered, or failed. */
  readonly asked: ReadonlySet<string>;
}

interface AccountHeld extends Held {
  readonly compare: AccountData["compare"] | undefined;
  readonly orgId: string | null | undefined;
}

const NOTHING_HELD: Held = { answers: new Map(), failures: new Map(), asked: new Set() };

const appKey = (appId: string, read: CompareRead): string =>
  JSON.stringify([appId, compareReadKey(read)]);

export function useReleaseComparisons(
  /** Each application's comparisons to ask, by its id. */
  asks: ReadonlyMap<string, ReadonlyArray<CompareRead>>,
): ReadonlyMap<string, AppCompares> {
  const account = useAccountDataOptional();
  const compare = account?.compare;
  const orgId = account?.orgId;
  const [stored, setHeld] = useState<AccountHeld>({ ...NOTHING_HELD, compare, orgId });
  const held = stored.compare === compare && stored.orgId === orgId ? stored : NOTHING_HELD;
  // An answer that comes after the surface went is nobody's.
  const drawn = useRef(true);
  useEffect(() => {
    drawn.current = true;
    return () => {
      drawn.current = false;
    };
  }, []);
  // The reads wanted and not asked yet, one string whatever the identity of the plans they are in.
  const due = JSON.stringify(
    [...asks].flatMap(([appId, reads]) =>
      reads.filter((read) => !held.asked.has(appKey(appId, read))).map((read) => [appId, read]),
    ),
  );

  useEffect(() => {
    if (compare === undefined) return;
    const wanted = JSON.parse(due) as Array<[string, CompareRead]>;
    if (wanted.length === 0) return;
    setHeld((current) => {
      const previous =
        current.compare === compare && current.orgId === orgId ? current : NOTHING_HELD;
      return {
        ...previous,
        compare,
        orgId,
        asked: new Set([...previous.asked, ...wanted.map(([appId, read]) => appKey(appId, read))]),
      };
    });
    for (const [appId, read] of wanted) {
      const key = appKey(appId, read);
      void compare({ appId, repo: read.repository, ...read.query }).then(
        (answer) => {
          if (!drawn.current) return;
          setHeld((current) => {
            if (current.compare !== compare || current.orgId !== orgId) return current;
            const failures = new Map(current.failures);
            failures.delete(key);
            return { ...current, answers: new Map(current.answers).set(key, answer), failures };
          });
        },
        (cause: unknown) => {
          if (!drawn.current) return;
          setHeld((current) =>
            current.compare !== compare || current.orgId !== orgId
              ? current
              : {
                  ...current,
                  failures: new Map(current.failures).set(key, zeropsErrorMessage(cause)),
                },
          );
        },
      );
    }
  }, [compare, due, orgId]);

  const again = useCallback((appId: string, selected: ReadonlyArray<CompareRead>) => {
    setHeld((current) => {
      const asked = new Set(current.asked);
      const failures = new Map(current.failures);
      for (const read of selected) {
        const key = appKey(appId, read);
        if (!failures.has(key)) continue;
        asked.delete(key);
        failures.delete(key);
      }
      return { ...current, asked, failures };
    });
  }, []);

  return useMemo(
    () =>
      new Map(
        [...asks].map(([appId, reads]) => {
          const answers = new Map<string, CompareResponse>();
          const failures = new Map<string, string>();
          for (const read of reads) {
            const key = appKey(appId, read);
            const answer = held.answers.get(key);
            const failure = held.failures.get(key);
            if (answer !== undefined) answers.set(compareReadKey(read), answer);
            if (failure !== undefined) failures.set(compareReadKey(read), failure);
          }
          return [appId, { answers, failures, again: (selected) => again(appId, selected) }];
        }),
      ),
    [again, asks, held],
  );
}

/** The selected comparison's failure action, carried only by the web presentation. */
export type ComparedCommits = MovedCommits & { readonly again?: (() => void) | undefined };
