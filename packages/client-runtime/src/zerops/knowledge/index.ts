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
export * from "./presentation.ts";
export * from "./retryPolicy.ts";
