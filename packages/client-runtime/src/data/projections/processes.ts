/**
 * What surfaces read of running work (HANDOFF §2.2, §4.5): whether a project has a build or a
 * deploy under way — the menu's indicator — and the processes the account holds of one project,
 * with where the organization's running work and the project's history read stand. Both say
 * "not known yet" until the running scope's first baseline; through an outage they keep what was
 * read and say they are catching up.
 *
 * @module data/projections/processes
 */
import { historyScope, runningScope, type ProcessValue } from "../families/process.ts";
import { linkKeys } from "../model.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import type { StreamState } from "../streamMachine.ts";
import { sameValue } from "./equal.ts";

export interface ProjectKey {
  readonly orgId: string;
  readonly projectId: string;
}

const keyOf = ({ orgId, projectId }: ProjectKey) => `${orgId}/${projectId}`;

/** How the organization's running work is observed now: live, catching up, or refused. */
function freshness(read: ProjectionReads, orgId: string) {
  const link = read.stream(linkKeys.zerops(orgId));
  const running = read.stream(runningScope(orgId));
  const refusal = [link, running].find((stream) => stream.phase === "refused");
  const complete = read.coverage(runningScope(orgId)) === "complete";
  return {
    complete,
    live: link.phase === "live" && running.phase === "live",
    reconnecting: complete && refusal === undefined && running.phase !== "live",
    ...(refusal === undefined ? {} : { unavailableReason: refusalReason(refusal) }),
  };
}

/** What a refusal says to a surface: its session ended, it may not read, or it was refused. */
function refusalReason(stream: StreamState): "expired-session" | "forbidden" | "refused" {
  switch (stream.fault?.outcome) {
    case "authoritative-denial":
      return "forbidden";
    case "definitive-refusal":
    case "recoverable-session":
      return "expired-session";
    default:
      return "refused";
  }
}

export type RunningWork =
  | { readonly kind: "unknown"; readonly live: boolean }
  | { readonly kind: "running" | "idle"; readonly live: boolean };

/** The menu's build/deploy indicator for one project: on while anything of it runs. */
export const runningWork: Projection<ProjectKey, RunningWork> = {
  name: "runningWork",
  keyOf,
  derive: (read, { orgId, projectId }) => {
    const { complete, live } = freshness(read, orgId);
    if (!complete) return { kind: "unknown", live };
    return { kind: read.index("running", projectId).size > 0 ? "running" : "idle", live };
  },
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
  /** Every process held of the project, newest first; `undefined` before the first read. */
  readonly processes: ReadonlyArray<ProcessValue> | undefined;
  /** The organization's running work is observed live now. */
  readonly live: boolean;
  /** Read before and not live now: what is held stays, catching up. */
  readonly reconnecting: boolean;
  /** The organization's running work was refused: why. */
  readonly unavailableReason?: "expired-session" | "forbidden" | "refused";
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
    const held = [...read.index("project", projectId)].flatMap((id) => {
      const fact = read.fact("process", id);
      return fact.kind === "known" ? [fact.value] : [];
    });
    return {
      processes: complete || held.length > 0 ? [...held].sort(newestFirst) : undefined,
      ...fresh,
      history,
    };
  },
  equals: sameValue,
};
