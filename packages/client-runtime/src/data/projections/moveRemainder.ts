/** A retained Move's rename remainder; a later placement or manual rename makes it obsolete. */
import type { Projection } from "../store.ts";
import { linkKeys } from "../model.ts";
import { moveShown } from "../operations/moveProject.ts";
import { sameValue } from "./equal.ts";
import { operationProgress, type OperationProgress } from "./operation.ts";

export type MoveRemainder =
  | { readonly kind: "none" | "done" | "superseded" | "checking" | "withheld" }
  | { readonly kind: "waiting"; readonly progress: OperationProgress }
  | {
      readonly kind: "rename";
      readonly projectId: string;
      readonly from: string;
      readonly name: string;
    };

export const moveRemainder: Projection<
  {
    readonly orgId: string;
    readonly hqProjectId: string;
    readonly requestId: string;
  },
  MoveRemainder
> = {
  name: "moveRemainder",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, key) => {
    const record = read.operation(key.requestId);
    const intent = record?.intent;
    if (
      intent?.kind !== "move-project" ||
      intent.orgId !== key.orgId ||
      intent.hqProjectId !== key.hqProjectId
    )
      return { kind: "none" };
    const project = read.fact("project", intent.projectId);
    const placement = read.fact("placement", intent.projectId);
    if (project.kind === "withheld" || placement.kind === "withheld") return { kind: "withheld" };
    if (project.kind === "deleted" || placement.kind === "deleted") return { kind: "superseded" };
    const progress = operationProgress.derive(read, key.requestId);
    if (progress.stage !== "done" || progress.outcome !== "succeeded")
      return { kind: "waiting", progress };
    if (
      project.kind !== "known" ||
      placement.kind !== "known" ||
      read.stream(placement.scope).phase !== "live" ||
      read.stream(linkKeys.hq(key.orgId)).phase !== "live"
    )
      return { kind: "checking" };
    if (project.value.clientId !== key.orgId) return { kind: "withheld" };
    if (!moveShown(read, intent)) return { kind: "superseded" };
    if (project.value.name === intent.rename.name) return { kind: "done" };
    if (project.value.name !== intent.rename.from) return { kind: "superseded" };
    return { kind: "rename", projectId: intent.projectId, ...intent.rename };
  },
};
