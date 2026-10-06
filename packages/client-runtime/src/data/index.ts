/**
 * The data layer's one door for the apps: the account's store, the organization's navigation, the
 * Zerops wire over today's transport, the session's own calls to the platform and to the issuers
 * of its kept sessions, and the projections components read.
 *
 * @module data
 */
export { observeAccount, type AccountObservation } from "./account.ts";
export { makeHqWire } from "./adapters/hqWire.ts";
export type { HqHandoverCandidates, HqMoveOffers, HqWire } from "./adapters/hq.ts";
export type {
  HqAppValue,
  HqOrganizationValue,
  HqPersonFacts,
  HqPressValue,
  HqStatusValue,
  PlacementValue,
} from "./families/hqNavigation.ts";
export {
  hqAppChanges,
  hqNavigation,
  hqPersonFacts,
  hqStatus,
  type HqNavigationRead,
} from "./projections/hqNavigation.ts";
export { hqMates, type HqMatesRead } from "./projections/hqMates.ts";
export { changeDiscussion, type ChangeDiscussionRead } from "./projections/changeDiscussion.ts";
export { discussionDemand } from "./families/hqDiscussion.ts";
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
export { projectsScope, type ProjectValue } from "./families/project.ts";
export { servicesScope, type ServiceValue } from "./families/service.ts";
export { projectServices, projectsServices, type ProjectServices } from "./projections/services.ts";
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
export {
  listedProject,
  organizationProjects,
  projectGone,
  type OrganizationProjects,
  type RosterRead,
} from "./projections/projects.ts";
export type { UnavailableReason } from "./projections/freshness.ts";
export { projectCreations } from "./projections/creation.ts";
export { makeOperations, type Operations } from "./operations/coordinator.ts";
export { makeZeropsExecutor } from "./operations/executors/zerops.ts";
export { makeHqExecutor, type HqWrites } from "./operations/executors/hq.ts";
export { restartWay } from "./operations/mateRestart.ts";
export { operationProgress, type OperationProgress } from "./projections/operation.ts";
export { SWEEP_FAILED_REASON } from "./operations/executors/throwawaySweep.ts";
export { operationEnd, type OperationEnd } from "./projections/operationEnd.ts";
export {
  accountReadsAtom,
  NOT_READ_PROCESSES,
  listedProjectAtom,
  NOT_READ_PROJECTS,
  NOT_READ_SERVICES,
  projectGoneAtom,
  projectProcessesAtom,
  projectServicesAtom,
  projectsServicesAtom,
  shownProjectsAtom,
  NOT_READ_HQ,
  shownHqMatesAtom,
  shownHqNavigationAtom,
  shownHqAppChangesAtom,
  shownHqPersonFactsAtom,
  shownHqStatusAtom,
  type AccountReads,
} from "./reads.ts";
