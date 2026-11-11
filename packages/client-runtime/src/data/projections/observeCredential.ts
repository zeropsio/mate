import type { ObserveCredential } from "../../zerops/hq/observeCredential.ts";
import {
  observeCredentialId,
  observeCredentialScope,
  type ObserveCredentialKey,
} from "../families/hqObserveCredential.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
export interface ObserveCredentialRead {
  readonly metadata:
    | { readonly state: "unread" | "reading" | "withheld" }
    | { readonly state: "known"; readonly value: ObserveCredential; readonly stale: boolean }
    | { readonly state: "failed"; readonly words: string };
}
export const observeCredential: Projection<ObserveCredentialKey, ObserveCredentialRead> = {
  name: "observeCredential",
  keyOf: observeCredentialId,
  derive: (read, key) => {
    const id = observeCredentialId(key);
    const fact = read.fact("hqObserveCredential", id);
    const stream = read.stream(observeCredentialScope(key));
    const metadata: ObserveCredentialRead["metadata"] =
      fact.kind === "known"
        ? {
            state: "known",
            value: fact.value,
            stale: stream.fault !== null || stream.phase !== "live",
          }
        : fact.kind === "withheld"
          ? { state: "withheld" }
          : stream.fault !== null
            ? { state: "failed", words: stream.fault.message }
            : {
                state:
                  stream.phase === "baselining" || stream.phase === "connecting"
                    ? "reading"
                    : "unread",
              };
    return { metadata };
  },
  equals: sameValue,
};
