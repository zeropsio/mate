import type { ObserveCredential } from "../../zerops/hq/observeCredential.ts";
import type { ObserveCredentialKey } from "../families/hqObserveCredential.ts";
import type { OperationKind } from "./kind.ts";
declare module "../model.ts" {
  interface OperationIntents {
    readonly "authorize-observe-credential": ObserveCredentialKey;
    readonly "revoke-observe-credential": ObserveCredentialKey;
  }
  interface OperationResults {
    readonly "authorize-observe-credential": ObserveCredential;
    readonly "revoke-observe-credential": ObserveCredential;
  }
}
export const authorizeObserveCredential: OperationKind<"authorize-observe-credential"> = {
  kind: "authorize-observe-credential",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
export const revokeObserveCredential: OperationKind<"revoke-observe-credential"> = {
  kind: "revoke-observe-credential",
  executor: "hq",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
