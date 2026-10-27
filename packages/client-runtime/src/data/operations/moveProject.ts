/** Placement changes belong to HQ; the original intent also retains the Zerops rename remainder. */
import { isMateKind, type RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import type { IntentOf, OperationKind } from "./kind.ts";
import type { ProjectionReads } from "../store.ts";
import { linkKeys } from "../model.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "move-project": {
      readonly orgId: string;
      /** The accepting HQ, so recovery cannot write through a replacement HQ. */
      readonly hqProjectId: string;
      readonly projectId: string;
      readonly from: { readonly appId: string | null; readonly kind: RoleProjectKind };
      readonly to: { readonly appId: string | null; readonly kind: RoleProjectKind };
      readonly rename: { readonly from: string; readonly name: string };
    };
  }
}

export type MoveProjectIntent = IntentOf<"move-project">;
export const changesMateClass = (intent: MoveProjectIntent) =>
  isMateKind(intent.from.kind) !== isMateKind(intent.to.kind);

export function moveShown(read: ProjectionReads, intent: MoveProjectIntent): boolean {
  const placement = read.fact("placement", intent.projectId);
  return (
    placement.kind === "known" &&
    placement.value.appId === intent.to.appId &&
    placement.value.kind === intent.to.kind
  );
}

export const moveProject: OperationKind<"move-project"> = {
  kind: "move-project",
  executor: "hq",
  reflected: (read, intent) => moveShown(read, intent),
  // Placement alone cannot prove that credentials, keys and jobs were replaced for a class change.
  settledBy: (read, intent) =>
    !changesMateClass(intent) && moveShown(read, intent) ? { kind: "succeeded" } : null,
  effectHandles: (read, intent) => {
    if (changesMateClass(intent)) return null;
    const placement = read.fact("placement", intent.projectId);
    // An unread or stale baseline cannot establish that this effect was absent before sending.
    if (
      placement.kind !== "known" ||
      read.stream(placement.scope).phase !== "live" ||
      read.stream(linkKeys.hq(intent.orgId)).phase !== "live" ||
      read.coverage(placement.scope) !== "complete"
    )
      return null;
    return moveShown(read, intent) ? [intent.projectId] : [];
  },
};
