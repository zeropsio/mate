/**
 * The data layer's one door for the apps: the account's store, the organization's navigation, the
 * Zerops wire over today's transport, and the projections components read.
 *
 * @module data
 */
export { startZeropsNavigation, type RunningLink } from "./account.ts";
export type { DetailDemand } from "./demand.ts";
export { makeAccountStore, type AccountStore, type Projection } from "./store.ts";
export {
  makeZeropsWire,
  repairZeropsSession,
  type ZeropsWireClient,
} from "../zerops/data/zeropsWire.ts";
