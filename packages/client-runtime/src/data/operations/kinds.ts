import { issueGitCredential, revokeGitCredential } from "./hqGitCredentials.ts";
import { mateUpdate } from "./mateUpdate.ts";
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
import { hqUpdate } from "./hqUpdate.ts";
import { HQ_WRITE_KINDS } from "./hqWrites.ts";
import { importContainer } from "./importContainer.ts";
import { importProject } from "./importProject.ts";
import { importServices } from "./importServices.ts";
import { renameApp, deleteApp } from "./hqAppWrites.ts";
import { FLOW_WRITE_KINDS } from "./flowWrites.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { mateRestart } from "./mateRestart.ts";
import { moveProject } from "./moveProject.ts";
import { MATE_DELETION_KINDS } from "./mateDeletion.ts";
import { renameProject } from "./renameProject.ts";
import { serviceRestart } from "./serviceRestart.ts";
import { startProject } from "./startProject.ts";
import { startService } from "./startService.ts";
import { throwawaySweep } from "./throwawaySweep.ts";
import { updateProjectTags } from "./updateProjectTags.ts";
import { vaultWrite } from "./vaultWrite.ts";

/** The registry, checked once at startup: each kind once. */
export function defineOperationKinds(
  kinds: ReadonlyArray<RegisteredOperationKind>,
): ReadonlyArray<RegisteredOperationKind> {
  const seen = new Set<string>();
  for (const { kind } of kinds) {
    if (seen.has(kind)) throw new Error(`The data layer registers operation kind ${kind} twice.`);
    seen.add(kind);
  }
  return kinds;
}

export const OPERATION_KINDS = defineOperationKinds([
  issueGitCredential,
  revokeGitCredential,
  throwawaySweep,
  mateRestart,
  mateUpdate,
  deleteProject,
  enableSubdomainAccess,
  startService,
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
  changeComment,
  renameApp,
  deleteApp,
  vaultWrite,
  serviceRestart,
  ...FLOW_WRITE_KINDS,
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
