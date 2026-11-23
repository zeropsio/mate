/**
 * An Owner's or an Admin's End of an application's operation whose maker cannot continue it: the
 * write HQ's offer allows, and what the confirmation says it leaves behind, by the operation's kind.
 */
import type { HqOperationStanding } from "@t3tools/client-runtime/data";

/** The `end-operation` write of `standing`, only where HQ offers this reader its end. */
export function endOperationIntent(
  standing: HqOperationStanding,
  orgId: string | undefined,
  appId: string,
) {
  if (standing.kind !== "waiting" || standing.endable !== true || orgId === undefined) {
    return undefined;
  }
  return { kind: "end-operation" as const, orgId, id: standing.id, appId };
}

/** The confirmation of ending the operation of `kind` on what the person knows as `name`. */
export function operationEndWords(
  kind: string,
  name: string,
): { readonly title: string; readonly description: string } {
  const unable = "Its maker can no longer continue it.";
  switch (kind) {
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
    case "put_live":
      return {
        title: `End putting ${name} live?`,
        description: `${unable} Ending it frees the application for new work and deletes nothing in Zerops: what it already put in place stays.`,
      };
    default:
      return {
        title: `End setting up ${name}?`,
        description: `${unable} Ending it frees the application for new work and deletes nothing in Zerops: a stage it already made stays and can be deleted like any stage, and a half-made project may remain in Zerops outside the application; remove it there.`,
      };
  }
}
