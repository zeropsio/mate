// The public knowledge surface: what a projection receives and renders. `Cell`, `newCell`,
// `advance` and `read` stay private to the stores under `cr/zerops`, imported from `./known.ts`.
export type {
  AbsenceEvidence,
  Coverage,
  FailureReason,
  Freshness,
  Known,
  Prerequisite,
  Shown,
  StaleReason,
  Stamp,
  WithheldReason,
  WithholdingCause,
  Withholding,
} from "./known.ts";
// The invalidation bus is a driver (§7.2 rule 2): this pure barrel carries its types, and the
// account runtime imports the bus from `./invalidation.ts`.
export type {
  AccountLogin,
  CrossTabInvalidation,
  CrossTabInvalidations,
  CrossTabInvalidationsOptions,
  GiteaOrigin,
  Invalidation,
  InvalidationBus,
  InvalidationBusOptions,
  InvalidationChannel,
  InvalidationSignal,
  TargetKey,
} from "./invalidation.ts";
export * from "./mateFeed.ts";
export * from "./presentation.ts";
export * from "./retryPolicy.ts";
