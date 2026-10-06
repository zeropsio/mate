/**
 * The data layer's one door for the apps: the account's store, the organization's navigation, the
 * Zerops wire over today's transport, the session's own calls to the platform and to the issuers
 * of its kept sessions, and the projections components read.
 *
 * @module data
 */
export { observeAccount, type AccountObservation } from "./account.ts";
export type { DetailDemand } from "./demand.ts";
export { makeAccountStore, type AccountStore, type Projection } from "./store.ts";
export {
  makeZeropsWire,
  repairZeropsSession,
  type ZeropsWireClient,
} from "../zerops/data/zeropsWire.ts";
export {
  makeZeropsSessionCalls,
  probeZeropsPrincipal,
  unavailableVerdict,
  type ZeropsPrincipalVerdict,
  type ZeropsSessionCalls,
} from "../zerops/data/zeropsSession.ts";
export { endIssuedSession } from "./adapters/issuedSessions.ts";
export { historyScope, runningScope, type ProcessValue } from "./families/process.ts";
export {
  buildsUnderWay,
  projectProcesses,
  projectsProcesses,
  runningWork,
  type HistoryRead,
  type ProjectKey,
  type ProjectProcesses,
  type RunningWork,
} from "./projections/processes.ts";
export { makeOperations, type Operations } from "./operations/coordinator.ts";
export { makeZeropsExecutor } from "./operations/executors/zerops.ts";
export { restartWay } from "./operations/mateRestart.ts";
export { operationProgress, type OperationProgress } from "./projections/operation.ts";
export { SWEEP_FAILED_REASON } from "./operations/executors/throwawaySweep.ts";
export { operationEnd, type OperationEnd } from "./projections/operationEnd.ts";
export {
  accountReadsAtom,
  NOT_READ_PROCESSES,
  projectProcessesAtom,
  type AccountReads,
} from "./reads.ts";
