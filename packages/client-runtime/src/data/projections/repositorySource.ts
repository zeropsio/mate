/** Access gates content immediately; transport failure retains the last owner answer. */
import {
  repositorySourceId,
  repositorySourceScope,
  type RepositorySourceKey,
} from "../families/hqRepositorySource.ts";
import type { Projection } from "../store.ts";
import type { selectRepositorySource } from "../../zerops/hq/repositoryStore.ts";
import { sameValue } from "./equal.ts";

export const repositorySource: Projection<
  RepositorySourceKey & { readonly allowed: boolean | undefined },
  ReturnType<typeof selectRepositorySource>
> = {
  name: "repositorySource",
  keyOf: (key) => JSON.stringify([repositorySourceId(key), key.allowed]),
  derive: (read, key) => {
    const fact = read.fact("hqRepositorySource", repositorySourceId(key));
    const stream = read.stream(repositorySourceScope(key));
    if (key.allowed === false || fact.kind === "withheld")
      return {
        state: "withheld",
        words: "You no longer have access to this repository.",
        alert: true,
        busy: false,
      };
    if (key.allowed === undefined)
      return { state: "unread", words: "Waiting for HQ…", alert: false, busy: false };
    const busy = stream.phase === "connecting" || stream.phase === "baselining";
    if (fact.kind === "known")
      return { state: "known", source: fact.value, busy, failed: stream.fault !== null };
    if (stream.fault !== null)
      return { state: "failed", words: stream.fault.message, alert: true, busy: false };
    return {
      state: busy ? "reading" : "unread",
      words: busy ? "Reading…" : "Waiting for HQ…",
      alert: false,
      busy,
    };
  },
  equals: sameValue,
};
