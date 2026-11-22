import { hqLifecycleScope, isRecoverableLifecycle } from "../families/hqLifecycle.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { moveRemainder } from "./moveRemainder.ts";

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
}
export const NO_LIFECYCLE_REMAINDERS: LifecycleRemainders = {
  renames: new Map(),
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
    for (const id of read.members(hqLifecycleScope(key.orgId)).ids) {
      const fact = read.fact("hqLifecycle", id);
      if (fact.kind !== "known") continue;
      const record = fact.value;
      if (!isRecoverableLifecycle(record, key.orgId, key.hqProjectId)) continue;
      if (record.intent.kind !== "move-project") continue;
      const remainder = moveRemainder.derive(read, { ...key, requestId: id });
      if (remainder.kind === "rename")
        renames.set(remainder.projectId, {
          requestId: id,
          projectId: remainder.projectId,
          from: remainder.from,
          to: remainder.name,
        });
    }
    return { renames };
  },
};
