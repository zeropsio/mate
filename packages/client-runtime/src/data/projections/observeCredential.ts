import type { ObserveCredential } from "../../zerops/hq/observeCredential.ts";
import {
  observeCredentialId,
  observeCredentialScope,
  type ObserveCredentialKey,
} from "../families/hqObserveCredential.ts";
import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import { actionOf, type AutomationAction } from "./hqAutomation.ts";
import { sameValue } from "./equal.ts";
export interface ObserveCredentialRead {
  readonly metadata:
    | { readonly state: "unread" | "reading" | "withheld" }
    | { readonly state: "known"; readonly value: ObserveCredential; readonly stale: boolean }
    | { readonly state: "failed"; readonly words: string };
  readonly action: AutomationAction<"authorize" | "revoke">;
}
export const observeCredential: Projection<ObserveCredentialKey, ObserveCredentialRead> = {
  name: "observeCredential",
  keyOf: observeCredentialId,
  derive: (read, key) => {
    const id = observeCredentialId(key);
    const fact = read.fact("hqObserveCredential", id);
    const stream = read.stream(observeCredentialScope(key));
    const request = read.fact("hqObserveCredentialRequest", id);
    let metadata: ObserveCredentialRead["metadata"] =
      fact.kind === "known"
        ? { state: "known", value: fact.value, stale: stream.fault !== null }
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
    // No remote read supplies this account's request marker: absence means no local action.
    if (request.kind !== "known") return { metadata, action: { kind: "idle" } };
    const record = read.operation(request.value.requestId);
    const action = actionOf(
      record,
      (kind) => (kind === "authorize-observe-credential" ? "authorize" : "revoke"),
      "HQ may have changed observe authorization. Read its current state; revoke it to remove access.",
    );
    // A read already in flight when the person pressed cannot replace HQ's later write receipt.
    if (
      metadata.state !== "withheld" &&
      request.kind === "known" &&
      record?.receipt?.acceptance.kind === "accepted"
    ) {
      const sequence =
        fact.kind === "known" && fact.revision.kind === "mate-link" ? fact.revision.sequence : 0;
      const result =
        record.intent.kind === "authorize-observe-credential"
          ? operationResult(record, "authorize-observe-credential")
          : operationResult(record, "revoke-observe-credential");
      if (sequence <= request.value.after && result !== undefined)
        metadata = { state: "known", value: result, stale: stream.fault !== null };
    }
    return { metadata, action };
  },
  equals: sameValue,
};
