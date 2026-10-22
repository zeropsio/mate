import { HQ_GIT_TARGET_KINDS } from "./hqGitTargets.ts";
import { creationPress } from "./creationPress.ts";
import { issueGitCredential, revokeGitCredential } from "./hqGitCredentials.ts";
import { HQ_AUTOMATION_KINDS } from "./hqAutomation.ts";
import { HQ_TASK_SOURCE_KINDS } from "./hqTaskSources.ts";
import { WORKSPACE_MUTATION_KINDS } from "./mateWorkspace.ts";
import { mateWriteFile } from "./mateWriteFile.ts";
import { mateAction } from "./mateActions.ts";
import { mateUpdate } from "./mateUpdate.ts";
import { mateSendTurn } from "./mateSendTurn.ts";
import { MATE_ENGINE_KINDS } from "./mateEngine.ts";
/**
 * The operation kinds this account submits. A new kind is one module beside these and one line
 * here.
 *
 * @module data/operations/kinds
 */
import type { OperationIntent } from "../model.ts";
import { assignMateOwner, finishMateHandover } from "./assignMateOwner.ts";
import { createProject } from "./createProject.ts";
import { changeComment } from "./changeComment.ts";
import { deleteProject } from "./deleteProject.ts";
import { enableSubdomainAccess } from "./enableSubdomainAccess.ts";
import { enableZeropsMate } from "./enableZeropsMate.ts";
import { hardenProject } from "./hardenProject.ts";
import { HQ_BIRTH_KINDS } from "./hqBirth.ts";
import { HQ_CHIEF_KINDS } from "./hqChief.ts";
import { hqUpdate } from "./hqUpdate.ts";
import { HQ_WRITE_KINDS } from "./hqWrites.ts";
import { importContainer } from "./importContainer.ts";
import { importProject } from "./importProject.ts";
import { importServices } from "./importServices.ts";
import { renameApp, deleteApp } from "./hqAppWrites.ts";
import {
  connectGitRemoteViaApp,
  followGithubRepository,
  stopFollowingGithubRepository,
} from "./hqGithubRemote.ts";
import { FLOW_WRITE_KINDS } from "./flowWrites.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { mateDeploy } from "./mateDeploy.ts";
import { mateRestart } from "./mateRestart.ts";
import { moveProject } from "./moveProject.ts";
import { MATE_DELETION_KINDS } from "./mateDeletion.ts";
import { renameProject } from "./renameProject.ts";
import { serviceRestart } from "./serviceRestart.ts";
import { startProject } from "./startProject.ts";
import { startService } from "./startService.ts";
import { stopService } from "./stopService.ts";
import { deleteService } from "./deleteService.ts";
import { throwawaySweep } from "./throwawaySweep.ts";
import { updateProjectTags } from "./updateProjectTags.ts";
import { vaultWrite } from "./vaultWrite.ts";
import { ADDRESS_WRITE_KINDS } from "./addressWrites.ts";
import { APP_ACCESS_KINDS } from "./appAccess.ts";
import { TEAM_KINDS } from "./team.ts";

/** The registry, checked once at startup: each kind once. Its kinds keep their names' types. */
export function defineOperationKinds<const Kinds extends ReadonlyArray<RegisteredOperationKind>>(
  kinds: Kinds,
): Kinds {
  const seen = new Set<string>();
  for (const { kind } of kinds) {
    if (seen.has(kind)) throw new Error(`The data layer registers operation kind ${kind} twice.`);
    seen.add(kind);
  }
  return kinds;
}

export const OPERATION_KINDS = defineOperationKinds([
  creationPress,
  ...HQ_GIT_TARGET_KINDS,
  issueGitCredential,
  revokeGitCredential,
  ...HQ_AUTOMATION_KINDS,
  ...HQ_TASK_SOURCE_KINDS,
  ...WORKSPACE_MUTATION_KINDS,
  mateWriteFile,
  mateSendTurn,
  ...MATE_ENGINE_KINDS,
  mateAction,
  throwawaySweep,
  mateRestart,
  mateDeploy,
  mateUpdate,
  deleteProject,
  enableSubdomainAccess,
  startService,
  stopService,
  deleteService,
  startProject,
  enableZeropsMate,
  renameProject,
  updateProjectTags,
  assignMateOwner,
  finishMateHandover,
  moveProject,
  ...MATE_DELETION_KINDS,
  createProject,
  importProject,
  importServices,
  importContainer,
  hardenProject,
  hqUpdate,
  ...HQ_WRITE_KINDS,
  ...HQ_BIRTH_KINDS,
  ...HQ_CHIEF_KINDS,
  changeComment,
  renameApp,
  deleteApp,
  connectGitRemoteViaApp,
  followGithubRepository,
  stopFollowingGithubRepository,
  vaultWrite,
  serviceRestart,
  ...FLOW_WRITE_KINDS,
  ...ADDRESS_WRITE_KINDS,
  ...APP_ACCESS_KINDS,
  ...TEAM_KINDS,
]);

/** The kind an intent belongs to, in a registry: the account's, or a test's own. */
export function operationKind(
  kinds: ReadonlyArray<RegisteredOperationKind>,
  intent: OperationIntent,
): RegisteredOperationKind {
  const kind = kinds.find((candidate) => candidate.kind === intent.kind);
  if (kind === undefined) throw new Error(`No operation kind ${intent.kind} is registered.`);
  return kind;
}
