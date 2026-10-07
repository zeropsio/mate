import type { EnvironmentCreationStep } from "../../zerops/createEnvironment.ts";
/** A composite press retains the observed results of its child owner operations. */
import type { EnvironmentCreationStepProgress } from "../../zerops/runEnvironmentCreation.ts";
import type { OperationKind } from "./kind.ts";
export type CreationPressState =
  | { readonly kind: "pressing" }
  | { readonly kind: "pressed" }
  | {
      readonly kind: "failed";
      readonly step: EnvironmentCreationStep["kind"];
      readonly reason: string;
      readonly uncertain?: true;
    };
export interface CreationPressResult {
  readonly progress: ReadonlyArray<EnvironmentCreationStepProgress>;
  readonly state: CreationPressState;
}
declare module "../model.ts" {
  interface OperationIntents {
    readonly "creation-press": { readonly orgId: string; readonly projectId: string };
  }
  interface OperationResults {
    readonly "creation-press": CreationPressResult;
  }
}
export const creationPress: OperationKind<"creation-press"> = {
  kind: "creation-press",
  executor: "zerops",
  reflected: (_read, _intent, receipt) => receipt.outcome.kind === "succeeded",
};
