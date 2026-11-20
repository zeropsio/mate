import {
  hqLifecycleScope,
  isRecoverableLifecycle,
  type RecoverableLifecycleRecord,
} from "../families/hqLifecycle.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { moveRemainder } from "./moveRemainder.ts";
import { operationProgress } from "./operation.ts";
import type { OperationProgress } from "../../zerops/operationProgress.ts";

/** The steps after a Mate deletion's prepare, by their request ids' suffix (`useMateActions`). */
const DELETION_STEPS = [":delete", ":complete", ":retire", ":retired"] as const;

/** A step this session sent and its owner has not ended yet. */
const underWay = (progress: OperationProgress): boolean =>
  progress.stage === "submitting" ||
  progress.stage === "accepted" ||
  progress.stage === "reflected" ||
  (progress.stage === "uncertain" && progress.next === "asking-owner");

interface LifecycleRemainders {
  readonly renames: ReadonlyMap<
    string,
    {
      readonly requestId: string;
      readonly projectId: string;
      readonly from: string;
      readonly to: string;
    }
  >;
  readonly deletions: ReadonlyArray<RecoverableLifecycleRecord>;
  /**
   * The deletions among them whose cleanup no step of this session is carrying on: the ones the
   * person finishes. A deletion running its own steps lands its cleanup a moment later, and says
   * nothing it would take back.
   */
  readonly stalled: ReadonlyArray<RecoverableLifecycleRecord>;
  readonly unproven: ReadonlyArray<string>;
}
export const NO_LIFECYCLE_REMAINDERS: LifecycleRemainders = {
  renames: new Map(),
  deletions: [],
  stalled: [],
  unproven: [],
};
export const lifecycleRemainders: Projection<
  { readonly orgId: string; readonly hqProjectId: string },
  LifecycleRemainders
> = {
  name: "lifecycleRemainders",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, key) => {
    const renames = new Map<
      string,
      {
        readonly requestId: string;
        readonly projectId: string;
        readonly from: string;
        readonly to: string;
      }
    >();
    const deletions: RecoverableLifecycleRecord[] = [];
    const stalled: RecoverableLifecycleRecord[] = [];
    const unproven: string[] = [];
    for (const id of read.members(hqLifecycleScope(key.orgId)).ids) {
      const fact = read.fact("hqLifecycle", id);
      if (fact.kind !== "known") continue;
      const record = fact.value;
      if (!isRecoverableLifecycle(record, key.orgId, key.hqProjectId)) continue;
      if (record.intent.kind === "move-project") {
        const remainder = moveRemainder.derive(read, { ...key, requestId: id });
        if (remainder.kind === "rename")
          renames.set(remainder.projectId, {
            requestId: id,
            projectId: remainder.projectId,
            from: remainder.from,
            to: remainder.name,
          });
      } else if (record.intent.kind === "prepare-mate-deletion") {
        const retirement = operationProgress.derive(read, `${id}:retired`);
        if (retirement.stage === "done" && retirement.outcome === "succeeded") continue;
        const project = read.fact("project", record.intent.projectId);
        if (
          project.kind === "deleted" ||
          operationProgress.derive(read, `${id}:complete`).stage === "done"
        ) {
          deletions.push(record);
          if (!DELETION_STEPS.some((step) => underWay(operationProgress.derive(read, id + step))))
            stalled.push(record);
        } else if (project.kind !== "known") unproven.push(record.intent.projectId);
      }
    }
    return { renames, deletions, stalled, unproven };
  },
};
