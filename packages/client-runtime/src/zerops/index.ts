export {
  DEFAULT_ZEROPS_API_BASE,
  ZeropsApiClient,
  ZeropsApiError,
  buildZeropsContainerUrl,
  zeropsClientsFromUser,
  zeropsRegionFromPublicZone,
  type ListProjectsOptions,
  type ZeropsApiClientOptions,
  type ZeropsApiErrorKind,
  type ZeropsClientMembership,
  type ZeropsLoginResponse,
  type ZeropsLocation,
  type ZeropsOrganization,
  type ZeropsProject,
  type ZeropsRegistrationResponse,
  type ZeropsService,
  type ZeropsServicePort,
  type ZeropsAutoscaling,
  type ZeropsAutoscalingResource,
  type ZeropsCurrentStat,
  type ZeropsStatHistoryItem,
  type ZeropsStatHistoryWindow,
  type ZeropsStatPair,
  type ZeropsUser,
} from "./api.ts";

export {
  canCreateProjectsInOrganization,
  resolveActiveZeropsOrganization,
  zeropsOrganizationRoleLabel,
  type ZeropsOrganizationSelectionInput,
} from "./accountScope.ts";

export {
  ZEROPS_SELECTION_STORAGE_KEY,
  ZEROPS_SESSION_STORAGE_KEY,
  clearZeropsSelection,
  clearZeropsSession,
  loadZeropsSelection,
  loadZeropsSession,
  isUsableZeropsSession,
  isZeropsSession,
  parseZeropsSession,
  requiresZeropsTwoFactor,
  saveZeropsSelection,
  saveZeropsSession,
  type ZeropsSelection,
  type ZeropsSession,
  type ZeropsStorageAdapter,
} from "./session.ts";

export {
  ZEROPS_CAPTCHA_ERROR_CODE,
  buildZeropsRegistrationBody,
  isZeropsCaptchaRejection,
  type ZeropsRegistrationBody,
  type ZeropsRegistrationInput,
} from "./registration.ts";

export {
  VSCODE_PASSWORD_LENGTH,
  ZEROPS_AGENT_TYPE_CANONICAL_ORDER,
  buildCreateProjectBody,
  buildDevelopmentContainerImportBody,
  buildZcpServiceImportYaml,
  generateVscodePassword,
  nextZcpServiceName,
  type CreateProjectBody,
  type DevelopmentContainerImportBody,
  type RandomBytes,
  type ZeropsAgentType,
} from "./newProject.ts";
export {
  MATE_MARKER_TAG,
  MATE_TAG_NAMESPACE,
  ZEROPS_GROUP_ID_LENGTH,
  deriveZeropsGroups,
  formatGroupTag,
  formatRoleTag,
  generateZeropsGroupId,
  readZeropsGroupTags,
  withZeropsBotTag,
  ZEROPS_BOT_NAME_MAX_LENGTH,
  withZeropsGroupTags,
  withZeropsMateTag,
  type DeriveZeropsGroupsOptions,
  type ZeropsEnvironmentRole,
  type ZeropsGroup,
  type ZeropsGroupEnvironment,
  type ZeropsGroupTags,
  type ZeropsGroupTree,
} from "./groups.ts";
export {
  canCreateEnvironment,
  groupNamesFromRecords,
  makeMockZeropsRecipeStore,
  recipeServicesYaml,
  type ZeropsGroupRecord,
  type ZeropsRecipeStore,
} from "./recipeStore.ts";
export { GO_HELLO_WORLD_GROUP, GO_HELLO_WORLD_GROUP_ID } from "./recipeStoreSeed.ts";
export { derivePublicRoutes, type ZeropsPublicRoute } from "./publicRoutes.ts";
export {
  summarizeEnvironmentServices,
  type ZeropsEnvironmentServices,
} from "./environmentSummary.ts";
export { assignCandidateMateTints, assignMateTints, preferredMateTint } from "./mateTints.ts";
export { recipeFromProjectExport, type ExportedRecipe } from "./recipeExport.ts";
export {
  selectAutoConnectTargets,
  ZEROPS_AUTO_CONNECT_LIMIT,
  type AutoConnectCandidate,
  type AutoConnectTarget,
} from "./autoConnect.ts";
export {
  deriveGiteaState,
  formatToolTag,
  GITEA_ADMIN_USER_COMMAND,
  GITEA_HTTP_PORT,
  GITEA_RUNNER_TOKEN_COMMAND,
  partitionZeropsToolProjects,
  readZeropsToolKind,
  type ZeropsGiteaPhase,
  type ZeropsGiteaProbe,
  type ZeropsGiteaSetupStep,
  type ZeropsGiteaState,
  type ZeropsGiteaStepState,
  type ZeropsToolKind,
  type ZeropsToolProject,
} from "./tools.ts";
export { buildGiteaImportYaml, buildGiteaRunnerImportYaml } from "./giteaRecipe.ts";
export {
  resolvePrimaryConversation,
  type ZeropsConversationCandidate,
  type ZeropsPrimaryConversation,
  type ZeropsPrimaryConversationReason,
} from "./primaryConversation.ts";
export {
  agentOwnershipNeedsAttention,
  agentOwnershipNotice,
  resolveAgentOwnership,
  type ZeropsAgentAuthorizer,
  type ZeropsAgentOwnership,
  type ZeropsAgentOwnershipInput,
} from "./agentOwnership.ts";
export {
  defaultAgentForRole,
  environmentCreationStepLabel,
  planEnvironmentCreation,
  type EnvironmentCreationInput,
  type EnvironmentRecipeChoice,
  type EnvironmentCreationPlan,
  type EnvironmentCreationStep,
} from "./createEnvironment.ts";
export {
  ENVIRONMENT_SERVICE_POLL_INTERVAL_MS,
  ENVIRONMENT_SERVICE_WAIT_CAP_MS,
  runEnvironmentCreation,
  type EnvironmentCreationOutcome,
  type EnvironmentCreationPlatform,
  type EnvironmentCreationStepProgress,
  type EnvironmentCreationStepState,
  type RunEnvironmentCreationInput,
} from "./runEnvironmentCreation.ts";
export {
  buildZeropsGroupTree,
  type ZeropsGroupTreeEnvironment,
  type ZeropsGroupTreeGroup,
  type ZeropsGroupTreeTool,
  type ZeropsGroupTreeView,
  type ZeropsProjectCarrier,
} from "./groupTree.ts";
export {
  hasMate,
  hasMateContainer,
  mateEnvironmentsEmptyReason,
  selectMateEnvironments,
} from "./mateEnvironments.ts";
export { botDisplayName, generateBotName, hasBotName, ZEROPS_BOT_NAME_POOL } from "./bots.ts";
