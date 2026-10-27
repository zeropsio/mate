/**
 * What surfaces read of running work: whether a project has a build or a
 * deploy under way — the menu's indicator — and the processes the account holds of one project,
 * with where the organization's running work and the project's history read stand. Both say
 * "not known yet" until the running scope's first baseline; through an outage they keep what was
 * read and say they are catching up.
 *
 * @module data/projections/processes
 */
import { historyScope, runningScope, runsStill, type ProcessValue } from "../families/process.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { StreamState } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness, type UnavailableReason } from "./freshness.ts";

export interface ProjectKey {
  readonly orgId: string;
  readonly projectId: string;
}

const keyOf = ({ orgId, projectId }: ProjectKey) => `${orgId}/${projectId}`;

/** How the organization's running work is observed now: live, catching up, or refused. */
const freshness = (read: ProjectionReads, orgId: string) =>
  scopeFreshness(read, runningScope(orgId));

export type RunningWork =
  | { readonly kind: "unknown"; readonly live: boolean }
  | { readonly kind: "running" | "idle"; readonly live: boolean };

/** The work the menu's indicator is for: a build, or a deploy. */
const BUILDS_AND_DEPLOYS: ReadonlySet<string> = new Set(["stack.build", "stack.deploy"]);

/** The menu's build/deploy indicator for one project: on while a build or deploy of it runs. */
export const runningWork: Projection<ProjectKey, RunningWork> = {
  name: "runningWork",
  keyOf,
  derive: (read, { orgId, projectId }) => {
    const { complete, live } = freshness(read, orgId);
    if (!complete) return { kind: "unknown", live };
    const building = [...read.index("running", projectId)].some((id) => {
      const fact = read.fact("process", id);
      return fact.kind === "known" && BUILDS_AND_DEPLOYS.has(fact.value.actionName);
    });
    return { kind: building ? "running" : "idle", live };
  },
  equals: sameValue,
};

/** Which of the listed projects a build or deploy runs on now, in the list's order. */
export const buildsUnderWay: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  ReadonlyArray<string>
> = {
  name: "buildsUnderWay",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) =>
    projectIds.filter(
      (projectId) => runningWork.derive(read, { orgId, projectId }).kind === "running",
    ),
  equals: sameValue,
};

/** Where a project's history read stands: not demanded, under way, read, or refused. */
export type HistoryRead = "unread" | "reading" | "read" | "failed";

function historyRead(stream: StreamState): HistoryRead {
  switch (stream.phase) {
    case "live":
      return "read";
    case "refused":
    case "unsupported":
      return "failed";
    case "idle":
    case "paused":
    case "closed":
      return "unread";
    default:
      return "reading";
  }
}

export interface ProjectProcesses {
  /** Known rows before active-list filtering; missing membership proves no terminal outcome. */
  readonly retained: ReadonlyArray<ProcessValue> | undefined;
  /** Every process held of the project, newest first; `undefined` before the first read. */
  readonly processes: ReadonlyArray<ProcessValue> | undefined;
  /** Those that run now, as the organization's running work lists them, newest first. */
  readonly running: ReadonlyArray<ProcessValue>;
  /** The organization's running work is observed live now. */
  readonly live: boolean;
  /** Read before and not live now: what is held stays, catching up. */
  readonly reconnecting: boolean;
  /** The organization's running work was refused: why. */
  readonly unavailableReason?: UnavailableReason;
  readonly history: HistoryRead;
}

const newestFirst = (left: ProcessValue, right: ProcessValue) =>
  right.created.localeCompare(left.created);

/** The processes the account holds of one project, and how current they are. */
export const projectProcesses: Projection<ProjectKey, ProjectProcesses> = {
  name: "projectProcesses",
  keyOf,
  derive: (read, { orgId, projectId }) => {
    const { complete, ...fresh } = freshness(read, orgId);
    const history = historyRead(read.stream(historyScope(orgId, projectId)));
    const valuesOf = (ids: ReadonlySet<string>) =>
      [...ids]
        .flatMap((id) => {
          const fact = read.fact("process", id);
          return fact.kind === "known" ? [fact.value] : [];
        })
        .sort(newestFirst);
    const running = read.index("running", projectId);
    // One whose row still says it runs, though the running scope let it go — its end happened
    // while nobody watched — is no process anyone can follow: it is left out, its end invented by
    // nobody.
    const retained = valuesOf(read.index("project", projectId));
    const held = retained.filter(
      (process) => !runsStill(process.status) || running.has(process.id),
    );
    return {
      retained: complete || retained.length > 0 ? retained : undefined,
      processes: complete || held.length > 0 ? held : undefined,
      running: valuesOf(running),
      ...fresh,
      history,
    };
  },
  equals: sameValue,
};

/** Several projects' processes at once: what a surface listing many Mates follows each one by. */
export const projectsProcesses: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, ProjectProcesses>>
> = {
  name: "projectsProcesses",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) =>
    Object.fromEntries(
      projectIds.map((projectId) => [
        projectId,
        projectProcesses.derive(read, { orgId, projectId }),
      ]),
    ),
  equals: sameValue,
};
