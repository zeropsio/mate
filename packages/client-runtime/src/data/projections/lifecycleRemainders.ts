import { hqLifecycleScope } from "../families/hqLifecycle.ts";
import type { HqLifecycleRecord } from "@t3tools/shared/hqLifecycle";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { moveRemainder } from "./moveRemainder.ts";
import { operationProgress } from "./operation.ts";

export interface LifecycleRemainders {
  readonly renames: ReadonlyMap<
    string,
    {
      readonly requestId: string;
      readonly projectId: string;
      readonly from: string;
      readonly to: string;
    }
  >;
  readonly deletions: ReadonlyArray<HqLifecycleRecord>;
}
export const NO_LIFECYCLE_REMAINDERS: LifecycleRemainders = { renames: new Map(), deletions: [] };
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
    const deletions: HqLifecycleRecord[] = [];
    for (const id of read.members(hqLifecycleScope(key.orgId)).ids) {
      const fact = read.fact("hqLifecycle", id);
      if (fact.kind !== "known") continue;
      const record = fact.value;
      if (record.intent.orgId !== key.orgId || record.intent.hqProjectId !== key.hqProjectId)
        continue;
      if (record.intent.kind === "move-project") {
        const remainder = moveRemainder.derive(read, { ...key, requestId: id });
        if (remainder.kind === "rename")
          renames.set(remainder.projectId, {
            requestId: id,
            projectId: remainder.projectId,
            from: remainder.from,
            to: remainder.name,
          });
      } else if (
        record.intent.kind === "prepare-mate-deletion" &&
        (read.fact("project", record.intent.projectId).kind === "deleted" ||
          operationProgress.derive(read, `${id}:complete`).stage === "done")
      ) {
        const retirement = operationProgress.derive(read, `${id}:retired`);
        if (retirement.stage !== "done" || retirement.outcome !== "succeeded")
          deletions.push(record);
      }
    }
    return { renames, deletions };
  },
};
