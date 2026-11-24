/**
 * The End of a waiting operation of an application, its production or a project: the write HQ's
 * offer allows, and what the confirmation says it leaves behind, by the operation's kind.
 */
import type { HqOperationStanding, MateDeletion, ProjectMove } from "@t3tools/client-runtime/data";

import type { PutLiveStanding } from "~/zerops/putLive.logic";

/** Who ends what: the operation's id and organisation, only where HQ offers this reader its end. */
function offeredEnd(
  standing: HqOperationStanding | MateDeletion | ProjectMove | PutLiveStanding,
  orgId: string | undefined,
) {
  if (standing.kind !== "waiting" || standing.endable !== true || orgId === undefined) {
    return undefined;
  }
  return { orgId, id: standing.id };
}

/** The `end-operation` write of an application's `standing`, where HQ offers it. */
export function endOperationIntent(
  standing: HqOperationStanding | PutLiveStanding,
  orgId: string | undefined,
  appId: string,
) {
  const offered = offeredEnd(standing, orgId);
  return offered && { kind: "end-operation" as const, ...offered, appId };
}

/** The `end-operation` write of a project's `standing`, where HQ offers it. */
export function endProjectOperationIntent(
  standing: HqOperationStanding | MateDeletion | ProjectMove,
  orgId: string | undefined,
  projectId: string,
) {
  const offered = offeredEnd(standing, orgId);
  return offered && { kind: "end-operation" as const, ...offered, projectId };
}

/** The confirmation of ending the operation of `kind` on what the person knows as `name`. */
export function operationEndWords(
  kind: string,
  name: string,
): { readonly title: string; readonly description: string } {
  const unable = "A request already at Zerops may still finish.";
  switch (kind) {
    case "mate_restart":
      return {
        title: `End restarting ${name}?`,
        description: `${unable} Ending it frees ${name} for new work and deletes nothing.`,
      };
    case "project_move":
      return {
        title: `End moving ${name}?`,
        description: `${unable} Ending it frees ${name} for new work and deletes nothing: it keeps the name Zerops shows.`,
      };
    case "mate_deletion":
      return {
        title: `End deleting ${name}?`,
        description: `${unable} Ending it frees ${name} for new work. If Zerops was already asked to delete its project, that goes on.`,
      };
    case "proposal_effect":
      return {
        title: `End ${name}?`,
        description: `${unable} Ending it records this approval as failed and deletes nothing.`,
      };
    case "app_rename":
      return {
        title: `End renaming ${name}?`,
        description: `${unable} Ending it frees ${name} for new work: projects already renamed in Zerops keep their new names, and the others keep their old ones.`,
      };
    case "app_deletion":
      return {
        title: `End deleting ${name}?`,
        description: `${unable} Ending it keeps ${name} and frees it for new work: what the deletion already removed stays gone, and everything else stays.`,
      };
    case "deploy_key":
      return {
        title: `End setting up ${name}?`,
        description: `${unable} Ending it frees the application for new work and deletes nothing in Zerops: a deploy key it already made stays.`,
      };
    case "access":
      return {
        title: `End changing access for ${name}?`,
        description: `${unable} Ending it frees ${name} for new access changes and deletes nothing: what Zerops already changed stays.`,
      };
    case "put_live":
      return {
        title: `End putting ${name} live?`,
        description: `${unable} Ending it frees the application for new work and deletes nothing in Zerops: what it already put in place stays.`,
      };
    case "production_removal":
      return {
        title: `End removing ${name}?`,
        description: `${unable} Ending it frees the application for new work. If Zerops was already asked to delete the project, that goes on; otherwise production stays and can be removed again.`,
      };
    default:
      return {
        title: `End setting up ${name}?`,
        description: `${unable} Ending it frees the application for new work and deletes nothing in Zerops: a stage it already made stays and can be deleted like any stage, and a half-made project may remain in Zerops outside the application; remove it there.`,
      };
  }
}
