export {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  ZeropsApiError,
  zeropsClientsFromUser,
  zeropsInvitationsFromUser,
  type ZeropsRegistrationResponse,
} from "./api.ts";
export type {
  ZeropsOrganization,
  ZeropsOrganizationInvitation,
  ZeropsOrganizationMember,
  ZeropsUser,
} from "./api/account.ts";
export type { ZeropsProject } from "./api/project.ts";
export type { ZeropsService } from "./api/service.ts";

export { mateContainerOf, severalMatesLine } from "./containerAddress.ts";

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

export { type ZeropsAgentType, type ZeropsCorePackage } from "./newProject.ts";
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
  withZeropsMateTag,
  type BirthPlacement,
  type ZeropsEnvironmentRole,
  type ZeropsGroupEnvironment,
  type ZeropsGroupPendingMember,
  type ZeropsMembership,
  type ZeropsMateFace,
  type ZeropsPlacedBirth,
  type ZeropsProjectOrder,
} from "./groups.ts";
export {
  mateTier,
  recipeTierServices,
  recipeTierServiceTypes,
  recipeTierRunning,
  type RecipeRuntime,
  type RecipeTier,
} from "./recipeTier.ts";
export { recipeReach, type RecipeReach } from "./recipeReach.ts";
export {
  releaseReadTargets,
  zeropsYamlSetupEnv,
  ZEROPS_YAML_NAMES,
  type ReleaseReadTarget,
  type SetupEnv,
} from "./releaseEnv.ts";
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
export type { BirthIntent } from "./birthIntent.ts";
export { assignCandidateMateTints, mateShapeOf, newMateTint } from "./mateTints.ts";
export {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
} from "@t3tools/shared/primaryConversation";
export {
  defaultAgentForRole,
  environmentCreationStepLabel,
  planEnvironmentCreation,
  type EnvironmentRecipeChoice,
  type EnvironmentCreationPlan,
  type EnvironmentCreationStep,
} from "./createEnvironment.ts";
export {
  resumableEnvironmentCreationStep,
  runEnvironmentCreation,
  servicesSettled,
  UNCONFIRMED_PROJECT,
  UNCONFIRMED_WRITE,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
  type ServiceDeployment,
} from "./runEnvironmentCreation.ts";
export {
  activityRanking,
  buildCanonicalGroupTree,
  inActivityOrder,
  type CanonicalGroupTreeView,
  type CanonicalGroupTreeEnvironment,
  type ZeropsProjectCarrier,
} from "./groupTree.ts";
export { rankZeropsCandidateForListing } from "./listingOrder.ts";
export {
  deleteMateOffered,
  groupWithoutMate,
  hasMate,
  mateEnvironmentsEmptyReason,
  PROJECT_GOING_STATUSES,
  projectDeleteOffered,
  selectMateEnvironments,
} from "./mateEnvironments.ts";
export { generateBotName } from "./bots.ts";
export { makeTokenWriteLock, type TokenWriteHold } from "./groupReach.ts";
export {
  CODE_IN_POOL_LINE,
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
export { changeRunMessage, linkedChanges, linksChange } from "./changeLinks.ts";
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
  type CanonicalGroupEnvironmentDeclaration,
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
  type ReviewStandingInput,
  type ReviewStandingModel,
  type ReviewPress,
  type ReviewPrimary,
  PRODUCTION_DEPLOYED_OUTSIDE,
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
  type ToldAddresses,
} from "./servedAddresses.ts";
export {
  changeKindTag,
  flowChange,
  flowAppChanges,
  flowChanges,
  flowVerbKey,
  flowVerbLabel,
  isRecipeProposal,
  recipeProposalRedone,
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
  type MateRunFacts,
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
  type ChangeActWords,
  type ChangeFacts,
  type ChangeVerbRead,
} from "./changeAct.ts";
export {
  ASKED,
  ASK_TO_MERGE,
  TAKE_ASK_BACK,
  VIEW_CHANGE,
  alsoMergesWords,
  askerName,
  changeStanding,
  changeStandingOf,
  changeTheirs,
  commentWaits,
  commentWord,
  mergersLine,
  mergersWho,
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
  gitOverview,
  gitOverviewPresentation,
  type GitOverviewIdentity,
  type GitOverviewView,
  gitRepositoryLine,
  type GitOverviewApp,
  type GitOverviewChange,
  type GitOverviewRepository,
} from "./gitOverview.ts";
export { resolveAddProjectVerb } from "./groupCreation.ts";
export {
  ENVIRONMENT_NOT_ADDED,
  environmentAddable,
  heldTiers,
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
