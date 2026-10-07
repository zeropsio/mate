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
export { makeVaultReveal, type VaultReveal, type VaultRevealed } from "./adapters/vaultReveal.ts";
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
export { vaultChangesSince, vaultImpact, vaultNote } from "./projections/vaultChanges.ts";
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
  creationStepId,
  creationSteps,
  creationsSteps,
  type CreationRead,
  type CreationStep,
  type CreationStepRead,
} from "./projections/creationSteps.ts";
export {
  organizationLocations,
  organizationMembers,
  servicesAgents,
  type LocationsRead,
  type MembersRead,
  type SampledRead,
} from "./projections/sampled.ts";
export { makeOperations, type Operations } from "./operations/coordinator.ts";
export { makeHqExecutor, type HqWrites } from "./operations/executors/hq.ts";
export { makeZeropsExecutor } from "./operations/executors/zerops.ts";
export { type FlowWriteIntent } from "./operations/flowWrites.ts";
export { flowAnswer, type FlowWriteAnswer } from "./projections/flowAnswer.ts";
export { restartWay } from "./operations/mateRestart.ts";
export { runToEnd, type RunToEnd } from "./operations/runToEnd.ts";
export {
  recordedEnvironment,
  type RecordedEnvironment,
} from "./projections/recordedEnvironment.ts";
export { operationProgress, type OperationProgress } from "./projections/operation.ts";
export { SWEEP_FAILED_REASON } from "./operations/executors/throwawaySweep.ts";
export { operationEnd, type OperationEnd } from "./projections/operationEnd.ts";
export { operationWait, type OperationWait } from "./projections/operationWait.ts";
export {
  accountReadsAtom,
  NOT_READ_PROCESSES,
  listedProjectAtom,
  hqMateSetupAtom,
  NOT_READ_PROJECTS,
  NOT_READ_SERVICES,
  NOT_READ_USAGE,
  projectGoneAtom,
  projectStandingAtom,
  projectProcessesAtom,
  projectServicesAtom,
  projectsServicesAtom,
  projectUsageAtom,
  NOT_READ_VAULT,
  vaultAtom,
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

export {
  hqBirthProgress,
  hqBirthRequestId,
  type HqBirthProgress,
} from "./projections/hqBirthProgress.ts";
export {
  mateRegistration,
  registrationRequestId,
  type MateRegistration,
} from "./projections/mateRegistration.ts";
export { shownHqProjectPeopleAtom } from "./personReads.ts";
export {
  hqProjectPeople,
  type HqMateOwner,
  type HqProjectPeople,
} from "./projections/hqProjectPeople.ts";
export type { HqVerdict } from "./families/hqVerdict.ts";

export { environmentSetup } from "./projections/environmentSetup.ts";

export { hqMateSetup, type HqMateSetup } from "./projections/hqMateSetup.ts";
export { hqPicture, type HqPictureRead } from "./projections/hqPicture.ts";
export {
  pictureOwner,
  pictureId,
  pictureScope,
  pictureLink,
  type HqPictureKey,
} from "./families/hqPicture.ts";

export {
  platformAccess,
  type PlatformAccess,
  type PlatformAccessKey,
} from "./projections/platformAccess.ts";

export { platformInventory, type PlatformInventory } from "./projections/platformInventory.ts";

export { hqChangeRead, type HqChangeRead } from "./projections/hqChangeRead.ts";
export {
  changeReadOwner,
  changeReadId,
  changeReadRequest,
  changeReadScope,
} from "./families/hqChangeRead.ts";

export { moveRemainder, type MoveRemainder } from "./projections/moveRemainder.ts";
export type { MoveProjectIntent } from "./operations/moveProject.ts";

export { readsOfState } from "./store.ts";
export { streamOf } from "./reducer.ts";
export { classifyHqCall } from "./adapters/hqWire.ts";

export { makeBrowserHqApi, readAccountHqHealth } from "./adapters/hqBrowser.ts";

export {
  lifecycleRemainders,
  NO_LIFECYCLE_REMAINDERS,
  type LifecycleRemainders,
} from "./projections/lifecycleRemainders.ts";
export { recordedMoveRemainder } from "./projections/recordedMoveRemainder.ts";

export {
  inventory,
  inventoryCandidates,
  NOT_READ_INVENTORY,
  inventoryPlacements,
  type InventoryKey,
  type InventoryRead,
} from "./projections/inventory.ts";

export {
  makeDatabaseReads,
  makeDatabaseWire,
  type DatabaseReads,
  type DatabaseReadIntent,
} from "./adapters/database.ts";
export {
  databasePanel,
  databaseSession,
  databaseServices,
  databaseCatalog,
  databaseMentionContext,
  type DatabasePanelRead,
  type DatabaseCatalogRead,
} from "./projections/database.ts";
export { emptyDatabasePanel, databaseTreeTarget } from "./families/database.ts";
export {
  mateBrowserFrameFamily,
  mateBrowserFrameScope,
  mateBrowserFrameId,
  mateBrowserStreamId,
} from "./families/mateBrowserFrame.ts";
export {
  mateBrowserFrame,
  mateBrowserStream,
  UNKNOWN_BROWSER_FRAME,
  type MateBrowserFrameRead,
} from "./projections/mateBrowserFrame.ts";
export {
  makeMateBrowserFrameWire,
  startMateBrowserFrames,
  makeMateBrowserFrameSink,
} from "./adapters/mateBrowserFrame.ts";

export {
  inventoryTopology,
  EMPTY_PROJECT_TOPOLOGY_SNAPSHOT,
  type ProjectTopologySnapshot,
  type ProjectTopologyLiveness,
} from "./projections/inventoryTopology.ts";
