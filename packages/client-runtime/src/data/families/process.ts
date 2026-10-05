/**
 * Zerops processes, observed as running work: the running membership paired with the
 * status-unfiltered updates. The running-filtered update stream never sends a process's end
 * (`klient/probe-org3`), so an indicator fed by it would never go out. Leaving the running scope is
 * a process no longer running, nothing about its outcome.
 *
 * @module data/families/process
 */
import { readActivityProcess, type ActivityProcess } from "../../zerops/activity/dto.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** A process as the platform's whole row says it: identity, status, pipeline, its end. */
export type ProcessValue = ActivityProcess;

declare module "../model.ts" {
  interface FamilyValues {
    readonly process: ProcessValue;
  }
}

/** The statuses the running registration admits (`registration-formats.jsonl`). */
const RUNNING_PROCESS_STATUSES = ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const;
const RUNNING: ReadonlySet<string> = new Set(RUNNING_PROCESS_STATUSES);

/** The row's `_version`, the platform's ordering of its observations; `null` where it has none. */
const versionOf = (raw: unknown): number | null =>
  typeof raw === "object" && raw !== null && "_version" in raw && typeof raw._version === "number"
    ? raw._version
    : null;

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
    decode: (raw) => {
      const value = readActivityProcess(raw);
      return value === undefined ? null : { id: value.id, value, version: versionOf(raw) };
    },
  },
};

export const runningScope = (orgId: string) => scopeOf(processFamily, orgId);
