/**
 * Zerops processes, observed as running work: the running membership paired with the
 * status-unfiltered updates. The running-filtered update stream never sends a process's end
 * (`klient/probe-org3`), so an indicator fed by it would never go out. Leaving the running scope is
 * a process no longer running, nothing about its outcome.
 *
 * @module data/families/process
 */
import { readActivityProcess, type ActivityProcess } from "../../zerops/activity/dto.ts";
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

/** A process as the platform's whole row says it: identity, status, pipeline, its end. */
export type ProcessValue = ActivityProcess;

declare module "../model.ts" {
  interface FamilyValues {
    readonly process: ProcessValue;
  }
}

const HISTORY = "history";

/** The statuses the running registration admits (`registration-formats.jsonl`). */
const RUNNING_PROCESS_STATUSES = ["PENDING", "RUNNING", "ROLLBACKING", "CANCELING"] as const;
const RUNNING: ReadonlySet<string> = new Set(RUNNING_PROCESS_STATUSES);

/** Whether a status says the process still runs; anything else is its end. */
export const runsStill = (status: string): boolean => RUNNING.has(status);

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
  indexes: [
    /**
     * Running ids by project: a process runs while its newest row is not terminal and its running
     * scope has not let it go. A terminal row clears it; leaving the scope clears it inventing no
     * end.
     */
    {
      name: "running",
      keyOf: (value, listed) =>
        RUNNING.has(value.status) && listed !== "removed" ? value.projectId : null,
    },
    /** Every process this account holds, by project: running, ended, or read in a history. */
    { name: "project", keyOf: (value) => value.projectId },
    /**
     * Every process the organization's running work showed, by project: one running now, or one
     * its running scope listed, whatever ended it since and whichever read brought that end.
     */
    {
      name: "seenRunning",
      keyOf: (value, listed) =>
        listed !== undefined || RUNNING.has(value.status) ? value.projectId : null,
    },
  ],
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
  ended: (value) => !runsStill(value.status),
  details: [
    {
      suffix: HISTORY,
      // A process falls out of the newest hundred by age, which says nothing of its end.
      leaving: "removed",
      zerops: {
        path: ({ ownerId }) => `/project/${encodeURIComponent(ownerId ?? "")}/process?limit=100`,
        items: (answer) =>
          typeof answer === "object" &&
          answer !== null &&
          "list" in answer &&
          Array.isArray(answer.list)
            ? answer.list
            : undefined,
      },
    },
  ],
};

export const runningScope = (orgId: string) => scopeOf(processFamily, orgId);

/** One project's newest hundred processes, observed while a screen demands them. */
export const historyScope = (orgId: string, projectId: string): ScopeKey =>
  `zerops:${orgId}:${HISTORY}:${projectId}`;
