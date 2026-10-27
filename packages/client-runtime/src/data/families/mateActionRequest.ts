/** Own-action identities only; command outcomes stay in retained operation receipts. */
import type { MateActionIntent } from "../operations/mateActions.ts";
import type { FamilySpec } from "./spec.ts";
export interface MateActionRequest extends MateActionIntent {
  readonly requestId: string;
  readonly ordinal: number;
}
declare module "../model.ts" {
  interface FamilyValues {
    readonly mateActionRequest: MateActionRequest;
  }
}
export const mateActionRequestFamily: FamilySpec<"mateActionRequest"> = {
  family: "mateActionRequest",
  authority: "mate",
  scope: {
    source: "mate",
    suffix: "action-request",
    leaving: "removed",
    demand: "detail",
    mode: "once",
  },
  indexes: [{ name: "mateActionsIn", keyOf: (value) => value.environmentId }],
};
export const mateActionRequestId = (intent: MateActionIntent) =>
  encodeURIComponent(JSON.stringify([intent.environmentId, intent.action, intent.target]));
export const mateActionRequestScope = (environmentId: string) =>
  `mate:${encodeURIComponent(environmentId)}:action-request` as const;
