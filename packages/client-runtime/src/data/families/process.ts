/**
 * Zerops processes, observed as running work: the running membership paired with the
 * status-unfiltered updates. The running-filtered update stream never sends a process's end
 * (`klient/probe-org3`), so an indicator fed by it would never go out. Leaving the running scope is
 * a process no longer running, nothing about its outcome.
 *
 * @module data/families/process
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { scopeOf, type FamilySpec } from "./spec.ts";

export interface ProcessValue {
  readonly id: string;
  readonly projectId: string;
  readonly status: string;
  readonly actionName: string | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly process: ProcessValue;
  }
}

/** The statuses the running registration admits (`registration-formats.jsonl`). */
const RUNNING_PROCESS_STATUSES = ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const;
const RUNNING: ReadonlySet<string> = new Set(RUNNING_PROCESS_STATUSES);

const Row = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  status: Schema.String,
  actionName: Schema.optionalKey(Schema.NullOr(Schema.String)),
  _version: Schema.optionalKey(Schema.Number),
});
const decodeRow = Schema.decodeUnknownOption(Row);

const organization = (orgId: string) => ({ name: "clientId", operator: "eq", value: orgId });
const notBalancer = { name: "executorTag", operator: "ne", value: "L7_MASTER" };

export const processFamily: FamilySpec<"process"> = {
  family: "process",
  authority: "zerops",
  scope: { source: "zerops", suffix: "running", leaving: "removed", demand: "navigation" },
  /**
   * Running ids by project: a process runs while its newest row is not terminal and its running
   * scope has not let it go. A terminal row clears it; leaving the scope clears it inventing no end.
   */
  index: {
    name: "running",
    keyOf: (value, listed) =>
      RUNNING.has(value.status) && listed !== "removed" ? value.projectId : null,
  },
  zerops: {
    entity: "process",
    membership: ({ orgId }) => [
      organization(orgId),
      { name: "status", operator: "in", value: RUNNING_PROCESS_STATUSES },
      notBalancer,
    ],
    updates: ({ orgId }) => [organization(orgId), notBalancer],
    decode: (raw) =>
      Option.match(decodeRow(raw), {
        onNone: () => null,
        onSome: (row) => ({
          id: row.id,
          value: {
            id: row.id,
            projectId: row.projectId,
            status: row.status,
            actionName: row.actionName ?? null,
          },
          version: row._version ?? null,
        }),
      }),
  },
};

export const runningScope = (orgId: string) => scopeOf(processFamily, orgId);
