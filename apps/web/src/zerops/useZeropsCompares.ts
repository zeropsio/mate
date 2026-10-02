/**
 * The comparisons a release asks HQ for (`GET /api/apps/:appId/repos/:repo/compare`), read as the
 * person through the organization's official HQ: what each application's planned reads
 * (`releaseReads`) put live.
 *
 * Two commits compare the same for ever, so an answer is asked once and held for as long as HQ is
 * the same one; a comparison HQ did not answer says why (`movedCommits` reads it as such), and is
 * asked again a minute later.
 */
import { compareReadKey, type CompareRead } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import type { CompareResponse } from "@t3tools/shared/hqChanges";
import { useEffect, useMemo, useRef, useState } from "react";

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

/** What HQ answered, for one HQ, by application and read (`appKey`). */
interface Held {
  readonly address: string;
  readonly answers: ReadonlyMap<string, CompareResponse>;
  readonly failures: ReadonlyMap<string, string>;
}

/** A read of one application, as it is held. */
const appKey = (appId: string, read: CompareRead): string =>
  JSON.stringify([appId, compareReadKey(read)]);

export function useZeropsCompares(
  /** Each application's comparisons to ask, by its id. */
  asks: ReadonlyMap<string, ReadonlyArray<CompareRead>>,
): ZeropsCompares {
  const hq = useOfficialHq();
  const [held, setHeld] = useState<Held | null>(null);
  // One string for every read wanted, whatever the identity of the plan it came from.
  const wanted = JSON.stringify(
    [...asks].flatMap(([appId, reads]) => reads.map((read) => [appId, read] as const)),
  );
  /** The reads asked at one HQ: answered, failed, or on their way. */
  const asked = useRef<{ readonly address: string; readonly keys: Set<string> }>(null);
  /** The comparisons HQ did not answer, each waiting to be asked again. */
  const retries = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const waiting = retries.current;
    return () => {
      for (const timer of waiting) clearTimeout(timer);
      waiting.clear();
    };
  }, []);

  useEffect(() => {
    if (hq === null) return;
    if (asked.current?.address !== hq.address) {
      asked.current = { address: hq.address, keys: new Set() };
    }
    const at = asked.current;
    /** Asks one comparison, and again a minute after HQ did not answer it. */
    const ask = (appId: string, read: CompareRead, key: string) => {
      void hq.api.compare(appId, read.repository, read.query).then(
        (answer) => {
          if (asked.current !== at) return;
          setHeld((last) => {
            const kept = last?.address === hq.address ? last : undefined;
            const failures = new Map(kept?.failures);
            failures.delete(key);
            return {
              address: hq.address,
              answers: new Map(kept?.answers).set(key, answer),
              failures,
            };
          });
        },
        (cause: unknown) => {
          if (asked.current !== at) return;
          const timer = setTimeout(() => {
            retries.current.delete(timer);
            // Another HQ since asks its own, from nothing held.
            if (asked.current === at) ask(appId, read, key);
          }, COMPARES_RETRY_MS);
          retries.current.add(timer);
          setHeld((last) => {
            const kept = last?.address === hq.address ? last : undefined;
            return {
              address: hq.address,
              answers: new Map(kept?.answers),
              failures: new Map(kept?.failures).set(key, zeropsErrorMessage(cause)),
            };
          });
        },
      );
    };
    for (const [appId, read] of JSON.parse(wanted) as Array<[string, CompareRead]>) {
      const key = appKey(appId, read);
      if (at.keys.has(key)) continue;
      at.keys.add(key);
      ask(appId, read, key);
    }
  }, [hq, wanted]);

  return useMemo(() => {
    const current = hq !== null && held?.address === hq.address ? held : null;
    return new Map(
      [...asks].map(([appId, reads]) => {
        const answers = new Map<string, CompareResponse>();
        const failures = new Map<string, string>();
        for (const read of reads) {
          const key = appKey(appId, read);
          const answer = current?.answers.get(key);
          const failure = current?.failures.get(key);
          if (answer !== undefined) answers.set(compareReadKey(read), answer);
          if (failure !== undefined) failures.set(compareReadKey(read), failure);
        }
        return [appId, { answers, failures }];
      }),
    );
  }, [asks, held, hq]);
}
