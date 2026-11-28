export { ZeropsApiError } from "./errors.ts";
export {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  zeropsClientsFromUser,
  zeropsInvitationsFromUser,
} from "./api.ts";
export type {
  ZeropsOrganization,
  ZeropsOrganizationInvitation,
  ZeropsOrganizationMember,
  ZeropsUser,
} from "./api/account.ts";
export type { ZeropsProject } from "./api/project.ts";
export type { ZeropsService } from "./api/service.ts";

export { mateContainerOf } from "./containerAddress.ts";

export {
  resolveActiveZeropsOrganization,
  zeropsOrganizationRoleLabel,
  zeropsRoleWords,
} from "./accountScope.ts";

export {
  ZEROPS_SESSION_STORAGE_KEY,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  parseZeropsSession,
  saveZeropsSelection,
  saveZeropsSession,
  type ZeropsSession,
  type ZeropsStorageAdapter,
} from "./session.ts";

export type { ZeropsCorePackage } from "./newProject.ts";
export {
  changedMateFace,
  deriveCanonicalGroups,
  type CanonicalGroup,
  type CanonicalGroupsOptions,
  formatMateFace,
  heldGroupLabel,
  kindOfRole,
  readMateFace,
  readZeropsMembership,
  ZEROPS_BOT_NAME_MAX_LENGTH,
  appProjectName,
  nameUnderApp,
  projectNameInApp,
  renamedProjectName,
  type BirthPlacement,
  type ZeropsEnvironmentRole,
  type ZeropsGroupPendingMember,
  type ZeropsMembership,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
  type ZeropsProjectOrder,
} from "./groups.ts";
export {
  tierProjectVariables,
  recipeTierServices,
  recipeTierServiceTypes,
  recipeTierRunning,
  type RecipeRuntime,
  type RecipeTier,
} from "./recipeTier.ts";
export { recipeReach, type RecipeReach } from "./recipeReach.ts";
export { unionAgents } from "./agentSelection.ts";
export {
  isGenericPlatformError,
  projectCreationOutcome,
  type ZeropsProjectCreation,
} from "./projectCreation.ts";
export {
  derivePublicRouteOffers,
  derivePublicRoutes,
  isPlatformSubdomain,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "./publicRoutes.ts";
export {
  summarizeEnvironmentServices,
  type ZeropsEnvironmentServices,
} from "./environmentSummary.ts";
export type { BirthAgent, BirthIntent } from "./birthIntent.ts";
export { assignCandidateMateTints, mateShapeOf, newMateTint } from "./mateTints.ts";
export {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "@t3tools/shared/primaryConversation";
export { defaultAgentForRole, type EnvironmentRecipeChoice } from "./createEnvironment.ts";
export {
  activityRanking,
  buildCanonicalGroupTree,
  inActivityOrder,
  type CanonicalGroupTreeView,
} from "./groupTree.ts";
export { rankZeropsCandidateForListing } from "./listingOrder.ts";
export {
  groupWithoutMate,
  hasMate,
  mateEnvironmentsEmptyReason,
  PROJECT_GOING_STATUSES,
  projectDeleteOffered,
  selectMateEnvironments,
} from "./mateEnvironments.ts";
export { generateBotName } from "./bots.ts";
export {
  checkoutLabel,
  checkoutPathFor,
  conversationCodeFolder,
  ZEROPS_WORKSPACE_ROOT,
  gitCheckoutHostnames,
  gitEmptyLine,
  gitActionAllowed,
  gitBlock,
  GIT_UNREADABLE_LINE,
  mateChangeIn,
  NO_REPOSITORY_LINE,
  pullRequestBlocked,
  leaseOfRepository,
  threadCheckoutHostnames,
  type CheckoutLease,
  type GitBlock,
  type GitChangedFile,
  type GitCheckoutState,
} from "./gitTab.ts";
export { changeRunMessage, linkedChanges } from "./changeLinks.ts";
export {
  zeropsAccountDisplay,
  zeropsInitials,
  type ZeropsAccountDisplay,
} from "./accountDisplay.ts";
export {
  MANAGED_WORDS,
  RUNTIME_WORDS,
  serviceTypeWords,
  typeWord,
  type VaultServiceKind,
} from "./serviceTypeWords.ts";
export { mateNextStep, type MateNextStep } from "./mateNextStep.ts";
export {
  mateArriving,
  mateArrivingUntil,
  matePose,
  matePoseOf,
  type MateLife,
  type MatePoseFacts,
} from "./matePose.ts";
export {
  compareForRelease,
  flowReleaseOf,
  releaseRunBy,
  nameStopByRelease,
  releaseEntries,
  releaseInFlight,
  releaseInFlightReason,
  releaseLanding,
  RELEASE_CHECKING,
  releaseCandidate,
  RELEASE_NO_PRODUCTION,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type ReleaseComparison,
  type ReleaseEntry,
  type ReleaseGate,
  releaseRow,
  releaseStalled,
  type ReleaseStall,
  rolledBackTo,
  shortCommit,
  type FlowRelease,
  type FlowReleaseRow,
} from "./release.ts";

export {
  releaseVersionField,
  releaseVersionSuggestions,
  type ReleaseVersionSuggestion,
} from "./releaseVersion.ts";
export {
  appRecipeOf,
  deployWord,
  canonicalEnvironmentRowInputsOf,
  canonicalGroupStopsOf,
  type CanonicalGroupEnvironmentRowInput,
  type CanonicalGroupStops,
  releaseDeploys,
  type AppRecipe,
  type GroupEnvironmentRowInput,
  type GroupStopProject,
  type ReleaseCreation,
  type ReleaseCreationFailure,
  type ReleaseDeployFailure,
} from "./groupDeploys.ts";
export {
  groupHistory,
  historyAge,
  historyEarlier,
  historyLine,
  historyNote,
  releaseTagsByCommit,
  type HistoryEntry,
} from "./groupHistory.ts";
export {
  releaseCarriedToggleLabel,
  releaseDescription,
  rolledBackDescription,
} from "./releaseCarried.ts";
export {
  carriedReads,
  compareReadKey,
  gitProductionRuns,
  movedCommits,
  movedCount,
  releaseReads,
  rollbackReads,
  rollbackServices,
  productionRuns,
  type CompareRead,
  type CompareReads,
  type Moved,
  type MovedCommits,
  type ProductionRun,
} from "./releaseCompare.ts";
export {
  carriedByRecords,
  carriedMoved,
  outsideMoved,
  rollbackFromHistories,
} from "./releaseRecorded.ts";
export {
  groupFlow,
  placeAddresses,
  OUTSIDE_MATE,
  OUTSIDE_MATE_MEANS,
  PRODUCTION_DEPLOYING,
  PRODUCTION_OUTSIDE_MATE,
  STAGE_SETTING_UP,
  stageFirstDeploy,
  type GroupFlow,
  type GroupFlowComing,
  type GroupFlowInput,
  type GroupFlowMate,
  type GroupFlowAddress,
  type GroupFlowPreview,
  type GroupFlowProduction,
  type GroupFlowStop,
  type GroupFlowStopState,
  type GroupNextStepKind,
} from "./groupFlow.ts";
export {
  addressComing,
  comingLine,
  firstDeployLine,
  firstDeployTone,
  listedStopComing,
  stopServes,
  type FirstDeploy,
  type PlatformService,
  type ListedStop,
  type StopComing,
} from "./stopComing.ts";
export { stageMarks, stageRead, stageStandings } from "./stageMarks.ts";
export { cannotTellWhatRuns, changesCountWords, serviceNames } from "./projectAttention.ts";
export {
  answerCommentsLabel,
  answerCommentsRequest,
  changeAskLabel,
  commentsToAnswer,
  changeAskPrompt,
  changeHandedPrompt,
  changeConversationCount,
  changeRemarks,
  type ChangeRemark,
} from "./changeConversation.ts";
export {
  REVIEW_LABEL,
  MERGE_AS_IT_IS,
  MERGE_CHECK_LATE_MS,
  mergeCheckWait,
  type MergeCheckWait,
  RELEASE_ESTIMATE_MS,
  RELEASE_READING,
  RELEASE_READING_LATE,
  RELEASE_READING_WORKING,
  RELEASE_TAKES,
  REVIEW_RELEASE_LABEL,
  changeReview,
  crewTaskReview,
  releaseReview,
  gitRemoteExpiry,
  reviewAge,
  rollbackReview,
  type ChangeReviewInput,
  type MergeCheckRefusal,
  type ReviewGithubChecks,
  type ReleaseOutcome,
  type ReleaseReplaces,
  type ReviewClose,
  type ReviewAskPress,
  type ReviewHand,
  type ReviewPress,
  type ReviewPrimary,
  PRODUCTION_OUTSIDE_DECIDES,
  type ReviewQuestion,
  type ReviewState,
  type ReviewVerdict,
} from "./reviewVerdict.ts";
export {
  holdReleaseFacts,
  releaseFacts,
  releaseFailure,
  releaseFailureOf,
  releaseFollows,
  releaseOutcomeOf,
  releaseStageMarks,
  releaseStep,
  releaseSteps,
  rollbackOnItsWay,
  type ReleaseFacts,
  type ReleaseFailure,
  type ReleaseFailureReads,
} from "./releaseFacts.ts";
export { releaseCreationsFailed, releaseEndedEvents } from "./releaseEnded.ts";
export { formatRunClock } from "./runClock.ts";
export {
  changeCommitRows,
  changeReadoutJudged,
  changeReadoutOfCompare,
  changeReadoutOfRecord,
  type ChangeReadout,
  type ChangeReadoutCommit,
} from "./changeReadout.ts";
export { changeFileParts, parseChangeDiff, type ChangeDiffFile } from "./changeDiff.ts";
export { changeFileDiffState, type ChangeFileDiffState } from "./changeFileDiff.ts";
export {
  servedAddressAdvice,
  servedAddressNote,
  servedPlaces,
  servedUrls,
  type ServedPlace,
} from "./servedAddresses.ts";
export {
  changeKindTag,
  flowChange,
  flowAppChanges,
  flowChanges,
  flowVerbKey,
  flowVerbLabel,
  pullRequestsByMate,
  agentLastSpokeAt,
  agentNotesFor,
  agentTurnNotes,
  productionTurnNotes,
  releaseEndedWords,
  productionRelease,
  changeLandedEvents,
  type ChangeLandedEvent,
  type ProductionLive,
  type ReleaseEndedEvent,
  changeAsksForReview,
  changeInMateReview,
  changeShowsReview,
  changeState,
  changeStateFor,
  READY_TO_MERGE,
  type ReleaseContentsSummary,
  waitingForProduction,
  releaseContentsSummary,
  sidebarChangeLabel,
  type FlowPullRequest,
  type FlowVerb,
} from "./projectFlow.ts";
export {
  changeActBusy,
  changeActOf,
  changeActStands,
  changeActWords,
  worksOnChange,
  type ChangeAct,
  type ChangeFacts,
  type ChangeVerbRead,
} from "./changeAct.ts";
export {
  ASKED,
  ASK_TO_MERGE,
  VIEW_CHANGE,
  changeStanding,
  changeStandingOf,
  changeTheirs,
  shownMergeAsk,
  standingPressLabel,
  standingWaits,
  standingWord,
  viewerMerges,
  viewerOwnsMate,
  mateWaitsOnOwner,
  releaseWaitsOnViewer,
  type ChangeStanding,
  type ChangeStandingFacts,
  type ChangeStandingOf,
  type ChangeStandingRead,
  type MateWhose,
  type ViewerMerges,
} from "./changeStanding.ts";
export {
  codeStanding,
  codeStandingOffers,
  codeStandingLine,
  codeStandingSentence,
  type CodeStanding,
  type CodeStandingOffers,
} from "./codeStanding.ts";
export {
  gitOverview,
  gitOverviewGroups,
  codeSize,
  gitChangesStatus,
  gitOverviewView,
  gitStandingNotice,
  type GitRepositoryFacts,
  type GitOverviewApp,
  type GitOverviewChange,
  type GitOverviewRepository,
} from "./gitOverview.ts";
export { resolveAddProjectVerb } from "./groupCreation.ts";
export {
  ENVIRONMENT_NOT_ADDED,
  type HeldEnvironment,
  environmentSlots,
  type EnvironmentSlotRow,
  type HalfMadeGroupEnvironment,
  productionRunsOf,
  type GroupEnvironment,
  type GroupEnvironmentTier,
  applicationEnvironments,
  listedEnvironmentsOf,
  putLiveHasChange,
  type ApplicationEnvironmentFacts,
} from "./groupEnvironments.ts";
export {
  deployedCommit,
  deployedVersion,
  canonicalEnvironmentRow,
  type CanonicalEnvironmentRow,
  type DeployedVersion,
  type EnvironmentRow,
  type EnvironmentServiceState,
  type GroupRowTone,
  productionProjectOf,
  zeropsProjectOf,
} from "./groupRows.ts";
export { sameCommit } from "./versionName.ts";

export {
  gitCiLine,
  gitRequiredChecks,
  gitDeliveryOf,
  type GitDelivery,
  type GitDeliveryEnvironment,
  type GitRepositoryDelivery,
} from "./gitDelivery.ts";
