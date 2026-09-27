/**
 * crewSnapshot — one frame of the crew feed, built from what the engine has
 * recorded (ARCHITECTURE §6: the subscription reads SQLite, never ssh).
 *
 * Pure: the crew tables' rows plus the engine's in-memory facts
 * ({@link SnapshotRuntime} — Apply's progress, the lane figures read at turn
 * end, apps, refused dispatches) in, a {@link CrewSnapshot} out. The engine's
 * snapshot hub calls it on every change, coalesced.
 *
 * Wire rules it keeps: the lead first, then the crew home's order; `readOnly`
 * is `kind !== "writer"` and exactly such a crewmate has no lane and no app;
 * `jobVersion` is `promptVersions.current.job`; a crewmate's open task is the
 * one it works on (not queued, landed, parked or discarded) and its queued
 * tasks come oldest first. Words stay off the wire, except a task's `reason`,
 * which the board shows after "Rework:" or "Stopped:".
 *
 * @module crewSnapshot
 */
import {
  ThreadId,
  type CrewAppState,
  type CrewAttention,
  type CrewClaimState,
  type CrewDevHost,
  type CrewLaneState,
  type CrewLogin,
  type CrewServed,
  type CrewSnapshot,
  type CrewStint,
  type CrewTask,
  type CrewTaskState,
  type CrewTint,
  type Crewmate,
} from "@t3tools/contracts";
import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";

import type { CrewAssignmentRow, CrewHostRow, CrewLaneRow, CrewMemberRow } from "./CrewStore.ts";
import {
  readTaskCard,
  readTaskCheck,
  readTaskReport,
  readTaskReview,
  readTaskWait,
} from "./crewTaskData.ts";

/** What the feed sends where crew mode is not on. */
export const CREW_OFF_SNAPSHOT: CrewSnapshot = {
  status: "off",
  seq: 0,
  crew: null,
  crewmates: [],
  hosts: [],
  board: { tasks: [] },
  run: null,
  attention: [],
  devHosts: [],
  landedNotDelivered: 0,
  lastError: null,
};

/** The dev services a writer's copy may live on, by name. */
const devHostsOf = (devHosts: SnapshotRuntime["devHosts"]): ReadonlyArray<CrewDevHost> =>
  [...devHosts]
    .map(([host, database]) => ({ host, database }))
    .toSorted((a, b) => a.host.localeCompare(b.host));

/** Crew mode is on and nothing is applied yet: the crewmate editor still offers the dev services. */
export const crewNoneSnapshot = (
  seq: number,
  runtime: Pick<SnapshotRuntime, "devHosts" | "lastError">,
): CrewSnapshot => ({
  ...CREW_OFF_SNAPSHOT,
  status: "none",
  seq,
  devHosts: devHostsOf(runtime.devHosts),
  lastError: runtime.lastError,
});

/** A stint as the engine recorded it (`crew_stint`). */
export interface SnapshotStint {
  readonly member: string;
  readonly stint: number;
  readonly threadId: string;
  /** Set once its first turn started. */
  readonly sessionId: string | null;
  readonly compactions: number;
  readonly lastCompactSummary: string | null;
  readonly rotatePending: boolean;
  readonly reason: string | null;
  readonly briefVersion: number;
  readonly jobVersion: number;
  readonly startedAt: string;
  readonly retiredAt: string | null;
}

/** A dev service's Show-on-dev claim. */
export interface SnapshotClaim {
  readonly host: string;
  readonly member: string;
  readonly state: CrewClaimState;
  readonly requestedAt: string;
  /** Why the crewmate asked, while it asks. */
  readonly reason: string | null;
}

/** Apply's per-crewmate progress (PRD §4.7), or why it failed. */
export interface LaneProgress {
  readonly state: Extract<CrewLaneState, "creating" | "setting-up" | "failed">;
  /** The setup command while `setting-up`; the reason while `failed`. */
  readonly detail: string | null;
}

/** What the engine knows in memory; lost on a restart and read again by the boot sweep. */
export interface SnapshotRuntime {
  readonly progress: ReadonlyMap<string, LaneProgress>;
  /** A lane against your tree, read at turn end and after a merge-in or a landing. */
  readonly laneStats: ReadonlyMap<
    string,
    {
      readonly ahead: number;
      readonly insertions: number;
      readonly deletions: number;
      readonly dirty: boolean;
    }
  >;
  /** Lanes whose directory a sweep or a script found gone. */
  readonly missingLanes: ReadonlySet<string>;
  readonly apps: ReadonlyMap<string, Exclude<CrewAppState, "none">>;
  /** A stint thread's context against its window, from its token usage. */
  readonly context: ReadonlyMap<string, { readonly tokens: number; readonly window: number }>;
  /** Landed tasks whose commit your remote already has. */
  readonly delivered: ReadonlySet<string>;
  /** Queued tasks admission refused to start, with its words. */
  readonly cantStart: ReadonlyMap<string, { readonly text: string; readonly at: string }>;
  readonly served: ReadonlyMap<string, CrewServed>;
  /** Your tree on each dev service: its branch and HEAD. */
  readonly integration: ReadonlyMap<
    string,
    { readonly branch: string | null; readonly head: string }
  >;
  /** A crewmate's login as the section names it. */
  readonly logins: ReadonlyMap<string, CrewLogin>;
  /** The dev services this Mate mounts: whether each reaches a database, `null` until read. */
  readonly devHosts: ReadonlyMap<string, boolean | null>;
  readonly lastError: string | null;
}

export const EMPTY_RUNTIME: SnapshotRuntime = {
  progress: new Map(),
  laneStats: new Map(),
  missingLanes: new Set(),
  apps: new Map(),
  context: new Map(),
  delivered: new Set(),
  cantStart: new Map(),
  served: new Map(),
  integration: new Map(),
  logins: new Map(),
  devHosts: new Map(),
  lastError: null,
};

export interface AppliedSnapshotInput {
  readonly seq: number;
  /** The crew home as applied. */
  readonly definition: CrewDefinition;
  readonly briefVersion: number;
  readonly members: ReadonlyArray<CrewMemberRow>;
  readonly lanes: ReadonlyArray<CrewLaneRow>;
  readonly stints: ReadonlyArray<SnapshotStint>;
  readonly tasks: ReadonlyArray<CrewAssignmentRow>;
  readonly hosts: ReadonlyArray<CrewHostRow>;
  readonly claims: ReadonlyArray<SnapshotClaim>;
  /** Each crewmate's memory: its entries and its unfiled lessons. */
  readonly memory: ReadonlyMap<string, { readonly entries: number; readonly unfiled: number }>;
  readonly runtime: SnapshotRuntime;
}

/** Tasks a crewmate is not working on. */
const NOT_OPEN: ReadonlySet<CrewTaskState> = new Set([
  "proposed",
  "queued",
  "landed",
  "parked",
  "discarded",
]);

export const isOpenTask = (state: CrewTaskState): boolean => !NOT_OPEN.has(state);

const firstLines = (text: string, count: number): string =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, count)
    .join("\n");

const DEFAULT_CONTEXT_WINDOW = 200_000;

const byNumber = (a: CrewAssignmentRow, b: CrewAssignmentRow) => a.number - b.number;

const stintState = (stint: SnapshotStint): CrewStint["state"] =>
  stint.retiredAt !== null
    ? "retired"
    : stint.rotatePending
      ? "rotate-pending"
      : stint.sessionId === null
        ? "open"
        : "active";

const toStint = (stint: SnapshotStint): CrewStint => ({
  stint: stint.stint,
  threadId: ThreadId.make(stint.threadId),
  state: stintState(stint),
  reason: stint.reason,
  lastCompactSummary: stint.lastCompactSummary,
  startedAt: stint.startedAt,
  retiredAt: stint.retiredAt,
});

const tintOf = (row: CrewMemberRow): CrewTint =>
  (MATE_TINT_IDS as ReadonlyArray<string>).includes(row.tint ?? "")
    ? (row.tint as CrewTint)
    : "slate";

const laneState = (
  handle: string,
  lane: CrewLaneRow,
  openTask: CrewAssignmentRow | undefined,
  runtime: SnapshotRuntime,
): { readonly state: CrewLaneState; readonly detail: string | null } => {
  const progress = runtime.progress.get(handle);
  if (progress !== undefined) return progress;
  if (lane.state === "lost") return { state: "failed", detail: "lost" };
  if (lane.state === "parked") return { state: "failed", detail: "parked" };
  if (lane.frozenSince !== null) return { state: "frozen", detail: null };
  if (runtime.missingLanes.has(handle)) return { state: "missing", detail: null };
  if (openTask !== undefined && readTaskWait(openTask.waiting)?.on === "conflict") {
    return { state: "conflicts", detail: null };
  }
  return { state: "ready", detail: null };
};

/** A writer's copy: from its lane row, or from Apply's progress while the row does not exist yet. */
const laneSummary = (
  handle: string,
  lane: CrewLaneRow | undefined,
  open: CrewAssignmentRow | undefined,
  runtime: SnapshotRuntime,
  lastCheck: CrewAssignmentRow | undefined,
): Crewmate["lane"] => {
  const progress = runtime.progress.get(handle);
  if (lane === undefined && progress === undefined) return null;
  const stats = runtime.laneStats.get(handle);
  return {
    branch: lane?.branch ?? `crew/${handle}`,
    ahead: stats?.ahead ?? 0,
    insertions: stats?.insertions ?? 0,
    deletions: stats?.deletions ?? 0,
    dirty: stats?.dirty ?? false,
    check: lastCheck === undefined ? null : readTaskCheck(lastCheck.check),
    ...(lane === undefined ? progress! : laneState(handle, lane, open, runtime)),
  };
};

const toTask = (row: CrewAssignmentRow, input: AppliedSnapshotInput): CrewTask => {
  const card = readTaskCard(row.card);
  const wait = readTaskWait(row.waiting);
  const report = readTaskReport(row.report);
  const stats = input.runtime.laneStats.get(row.member);
  return {
    id: row.assignment,
    number: row.number,
    title: row.title,
    owner: row.member,
    state: row.state,
    source: row.source,
    createdBy: row.createdBy === "" ? null : row.createdBy,
    createdAt: row.createdAt,
    dependsOn: row.dependsOn,
    fresh: row.fresh,
    brief: card?.brief ?? "",
    doneWhen: card?.doneWhen ?? "",
    note: card?.note ?? null,
    attempts: row.attempt,
    reason: row.state === "rework" || row.state === "parked" ? (wait?.reason ?? null) : null,
    question: row.state === "blocked" ? (report?.question ?? null) : null,
    waitingOn: row.state === "waiting-on-you" ? (wait?.paths ?? []) : [],
    diffStat:
      isOpenTask(row.state) && stats !== undefined && stats.ahead > 0
        ? { insertions: stats.insertions, deletions: stats.deletions }
        : null,
    report: report?.summary ?? null,
    check: readTaskCheck(row.check),
    review: readTaskReview(row.review),
    landedCommit: row.landedCommit,
    delivered: row.state === "landed" && input.runtime.delivered.has(row.assignment),
  };
};

/** One *Waiting on you* row per task that needs the person (PRD §5.5), in board order. */
const taskAttention = (
  row: CrewAssignmentRow,
  runtime: SnapshotRuntime,
): CrewAttention | undefined => {
  const wait = readTaskWait(row.waiting);
  const attention = (
    kind: CrewAttention["kind"],
    fields: Partial<Pick<CrewAttention, "text" | "paths" | "at">> = {},
  ): CrewAttention => ({
    id: `${kind}:${row.assignment}`,
    kind,
    handle: row.member,
    taskId: row.assignment,
    text: fields.text ?? null,
    paths: fields.paths ?? [],
    host: null,
    at: fields.at ?? row.updatedAt,
  });
  switch (row.state) {
    case "blocked":
      return attention("question", { text: readTaskReport(row.report)?.question ?? null });
    case "ready":
      return attention("ready-to-land");
    case "waiting-on-you":
      return attention("landing-wait", { paths: wait?.paths ?? [] });
    case "parked":
      return attention("parked", { text: wait?.reason ?? null });
    case "rework":
      if (wait?.on === "conflict") return attention("conflict", { paths: wait.paths });
      if (wait?.on === "check-failed") {
        const output = readTaskCheck(row.check)?.output ?? "";
        const last = output.trimEnd().split("\n").at(-1)?.trim();
        return attention("check-failed", { text: last === undefined || last === "" ? null : last });
      }
      return undefined;
    case "queued": {
      const refused = runtime.cantStart.get(row.assignment);
      return refused === undefined
        ? undefined
        : attention("cant-start", { text: refused.text, at: refused.at });
    }
    default:
      return undefined;
  }
};

const toCrewmate = (
  spec: CrewMemberSpec,
  row: CrewMemberRow,
  input: AppliedSnapshotInput,
): Crewmate => {
  const { runtime } = input;
  const stints = input.stints
    .filter((stint) => stint.member === row.handle)
    .toSorted((a, b) => a.stint - b.stint);
  const current = stints.findLast((stint) => stint.retiredAt === null);
  const tasks = input.tasks.filter((task) => task.member === row.handle).toSorted(byNumber);
  const open = tasks.find((task) => isOpenTask(task.state));
  const lane = input.lanes.find((candidate) => candidate.lane === row.handle);
  const readOnly = row.kind !== "writer";
  const lastCheck = tasks.findLast((task) => readTaskCheck(task.check) !== null);
  const context = current === undefined ? undefined : runtime.context.get(current.threadId);
  return {
    handle: row.handle,
    displayName: row.displayName,
    tint: tintOf(row),
    kind: row.kind,
    jobFirstLine: firstLines(spec.job, 1),
    jobVersion: row.jobVersion,
    promptVersions: {
      running:
        current === undefined ? null : { brief: current.briefVersion, job: current.jobVersion },
      current: { brief: input.briefVersion, job: row.jobVersion },
    },
    login: runtime.logins.get(row.handle) ?? {
      id: row.login ?? "claudeAgent",
      label: "",
      agent: "claude-code",
    },
    model: row.model,
    effort: row.effort,
    readOnly,
    host: readOnly ? null : row.host,
    currentThreadId: current === undefined ? null : ThreadId.make(current.threadId),
    stints: stints.map(toStint),
    context:
      context === undefined
        ? null
        : { tokens: context.tokens, window: context.window || DEFAULT_CONTEXT_WINDOW },
    compactions: current?.compactions ?? 0,
    memory: input.memory.get(row.handle) ?? { entries: 0, unfiled: 0 },
    openTaskId: open?.assignment ?? null,
    queuedTaskIds: tasks.filter((task) => task.state === "queued").map((task) => task.assignment),
    lane: readOnly ? null : laneSummary(row.handle, lane, open, runtime, lastCheck),
    app: readOnly
      ? null
      : {
          state: row.runCommand === null ? "none" : (runtime.apps.get(row.handle) ?? "stopped"),
          port: row.crewPort,
          url: null,
        },
  };
};

export const appliedSnapshot = (input: AppliedSnapshotInput): CrewSnapshot => {
  const rows = new Map(input.members.map((row) => [row.handle, row]));
  const ordered = [
    ...input.definition.members.filter((member) => member.kind === "lead"),
    ...input.definition.members.filter((member) => member.kind !== "lead"),
  ].flatMap((spec) => {
    const row = rows.get(spec.handle);
    return row === undefined ? [] : [toCrewmate(spec, row, input)];
  });
  const tasks = input.tasks.toSorted(byNumber);
  const claimAttention = input.claims
    .filter((claim) => claim.state === "requested")
    .map((claim): CrewAttention => ({
      id: `show-on-dev:${claim.host}`,
      kind: "show-on-dev",
      handle: claim.member,
      taskId: null,
      text: claim.reason,
      paths: [],
      host: claim.host,
      at: claim.requestedAt,
    }));
  return {
    status: "applied",
    seq: input.seq,
    crew: {
      name: input.definition.name,
      briefTitle: input.definition.brief.title,
      briefVersion: input.briefVersion,
      briefExcerpt: firstLines(input.definition.brief.text, 2),
    },
    crewmates: ordered,
    hosts: input.hosts.map((host) => {
      const claim = input.claims.find((candidate) => candidate.host === host.host);
      return {
        host: host.host,
        integration: input.runtime.integration.get(host.host) ?? null,
        crewPorts: host.crewPorts,
        served: input.runtime.served.get(host.host) ?? { by: "unknown" },
        claim: { state: claim?.state ?? "none", handle: claim?.member ?? null },
      };
    }),
    board: { tasks: tasks.map((row) => toTask(row, input)) },
    run: null,
    attention: [
      ...tasks.flatMap((row) => taskAttention(row, input.runtime) ?? []),
      ...claimAttention,
    ],
    devHosts: devHostsOf(input.runtime.devHosts),
    landedNotDelivered: tasks.filter(
      (row) => row.state === "landed" && !input.runtime.delivered.has(row.assignment),
    ).length,
    lastError: input.runtime.lastError,
  };
};
