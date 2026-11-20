// The public knowledge surface: what a projection receives and renders.
export type { FailureReason, Freshness, Known, Shown, StaleReason } from "./known.ts";
// The invalidation bus is a driver (§7.2 rule 2): this pure barrel carries its types, and the
// account runtime imports the bus from `./invalidation.ts`.
export type { Invalidation } from "./invalidation.ts";
export * from "./presentation.ts";
export * from "./signals.ts";
