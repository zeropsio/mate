/**
 * The data layer's one door for the apps: the account's store, the organization's navigation, the
 * Zerops wire over today's transport, the session's own calls to the platform and to the issuers
 * of its kept sessions, and the projections components read.
 *
 * @module data
 */
export {
  observeAccount,
  startMateAttention,
  type AccountObservation,
  type CompareAsk,
  type ShownHq,
} from "./account.ts";
export { makeMateAttentionWire, type MateAttentionWire } from "./adapters/mateAttention.ts";
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
  hqAppReleaseOffers,
  hqNavigation,
  hqPersonFacts,
  hqStatus,
  type HqNavigationRead,
} from "./projections/hqNavigation.ts";
export { hqMates, type HqMatesRead } from "./projections/hqMates.ts";
export { matesAttention, type MateAttentionRead } from "./projections/mateAttention.ts";
export {
  changeDiscussion,
  discussionGate,
  type ChangeDiscussionRead,
  type DiscussionGate,
} from "./projections/changeDiscussion.ts";
export { discussionDemand } from "./families/hqDiscussion.ts";
export type { ZeropsWire } from "./adapters/zerops.ts";
export {
  appEnvironments,
  appsEnvironments,
  type AppEnvironmentsRead,
} from "./projections/appEnvironments.ts";
export {
  hqAppDetail,
  hqAppDetails,
  type HqAppDetailRead,
  type HqAppFailure,
  type HqAppRecipes,
} from "./projections/hqAppDetail.ts";
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
export { makeBuildLogTransport } from "./adapters/buildLog.ts";
export {
  buildLogSessionKeyOf,
  makeAccountBuildLogs,
  type BuildLogLease,
  type BuildLogRegistry,
  type BuildLogSnapshot,
  type BuildLogStatus,
} from "./buildLogs.ts";
export { makeMateAdapter, mateContainerReads, type MateAdapter } from "./adapters/mate.ts";
export type { MateLinkValue } from "./families/mateLink.ts";
export {
  mateLink,
  mateLinks,
  mateOfEnvironment,
  type MateLinksRead,
} from "./projections/mateLinks.ts";
export { historyScope, runningScope, type ProcessValue } from "./families/process.ts";
export { projectsScope, type ProjectValue } from "./families/project.ts";
export { servicesScope, type ServiceValue } from "./families/service.ts";
export { PROJECT_ROUTINGS_LISTING } from "./families/publicRouting.ts";
export { publicAccess, type PublicAccess } from "./projections/publicAccess.ts";
export { projectServices, projectsServices, type ProjectServices } from "./projections/services.ts";
export { mateVariables, type MateVariables } from "./projections/mateVariables.ts";
export type {
  VaultChange,
  VaultImpact,
  VaultNotLive,
  VaultRead,
  VaultReader,
  VaultRef,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "./projections/vaultModel.ts";
export { vault, type VaultKey } from "./projections/vault.ts";
export {
  projectVariablesScope,
  type ProjectVariablesValue,
  type VariableRow,
} from "./families/projectVariables.ts";
export { serviceVariablesScope, type ServiceVariableValue } from "./families/serviceVariables.ts";
export {
  serviceRuns,
  type ServiceRuns,
  type ZeropsServiceDeployedVersion,
} from "./projections/serviceRuns.ts";
export type { ProjectUsage } from "./projections/usage.ts";
export { usageOwnerOf } from "./families/usage.ts";
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
  ownRowWanted,
  projectGone,
  type OrganizationProjects,
  type RosterRead,
} from "./projections/projects.ts";
export type { UnavailableReason } from "./projections/freshness.ts";
export { projectCreations } from "./projections/creation.ts";
export {
  organizationLocations,
  organizationMembers,
  servicesAgents,
  type LocationsRead,
  type MembersRead,
  type SampledRead,
} from "./projections/sampled.ts";
export { makeOperations, type Operations } from "./operations/coordinator.ts";
export { makeZeropsExecutor } from "./operations/executors/zerops.ts";
export { makeHqExecutor, type HqWrites } from "./operations/executors/hq.ts";
export { type FlowWriteIntent } from "./operations/flowWrites.ts";
export { flowAnswer, type FlowWriteAnswer } from "./projections/flowAnswer.ts";
export { restartWay } from "./operations/mateRestart.ts";
export { operationProgress, type OperationProgress } from "./projections/operation.ts";
export { SWEEP_FAILED_REASON } from "./operations/executors/throwawaySweep.ts";
export { operationEnd, type OperationEnd } from "./projections/operationEnd.ts";
export { operationWait, type OperationWait } from "./projections/operationWait.ts";
export {
  accountReadsAtom,
  NOT_READ_PROCESSES,
  listedProjectAtom,
  mateVariablesAtom,
  readMateMarker,
  NOT_READ_PROJECTS,
  NOT_READ_SERVICES,
  NOT_READ_USAGE,
  projectGoneAtom,
  projectStandingAtom,
  projectProcessesAtom,
  projectServicesAtom,
  projectsServicesAtom,
  projectUsageAtom,
  shownProjectsAtom,
  NOT_READ_HQ,
  shownHqMatesAtom,
  shownHqNavigationAtom,
  shownHqAppChangesAtom,
  shownHqPersonFactsAtom,
  shownHqStatusAtom,
  shownHqVerdictAtom,
  mateOfEnvironmentAtom,
  NO_MATE_LINKS,
  shownMateLinksAtom,
  type AccountReads,
} from "./reads.ts";
export { shownHqProjectPeopleAtom } from "./personReads.ts";
export {
  hqProjectPeople,
  type HqMateOwner,
  type HqProjectPeople,
} from "./projections/hqProjectPeople.ts";
export type { HqVerdict } from "./families/hqVerdict.ts";

export { environmentSetup } from "./projections/environmentSetup.ts";
