/**
 * The crew feed's frame from the crew owner's state: pure, state plus the facts the crew does not
 * own (the Mate's logins by name, its dev services, memory counts, the live context gauge, what
 * *Deliver* sent) in, a {@link CrewSnapshot} out, at a gapless revision.
 *
 * Wire rules it keeps: the lead first, then the crew home's order; `readOnly` is
 * `kind !== "writer"` and exactly such a crewmate has no lane and no app; `jobVersion` is
 * `promptVersions.current.job`; a crewmate's open task is the one it works on and its queued
 * tasks come oldest first. A crewmate talks in one conversation, so `currentThreadId` repeats its
 * `conversationId`, `stints` is empty and `sessions` says how many sessions it has had and why the
 * last one opened. The board is bounded: each crewmate's finished work beyond its newest few is
 * paged through `crew.taskPage`.
 *
 * @module crew/engine/project
 */
import {
  ThreadId,
  type CrewAttention,
  type CrewDevHost,
  type CrewLaneState,
  type CrewLogin,
  type CrewOperation,
  type CrewRun,
  type CrewSnapshot,
  type CrewTask,
  type CrewTaskPage,
  type CrewTaskPageInput,
  type CrewTint,
  type Crewmate,
} from "@t3tools/contracts";
import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import * as DateTime from "effect/DateTime";

import { QUESTION_TO_PERSON_MS, UNATTENDED_MS, attemptsOf } from "./decide.ts";
import {
  hostFrozen,
  isOpenTask,
  leadAnswers,
  leadOf,
  membersInOrder,
  questionKey,
  runElapsedMs,
  tasksInOrder,
  usagePercentOf,
  type AttentionRecord,
  type CrewState,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";

/** What the crew does not own but its frame shows. */
export interface CrewView {
  /** The clock at this frame, for how long a question or a task has waited. */
  readonly nowMs: number;
  /** The Mate's start epoch: a client compares the revision epoch first. */
  readonly epoch: number;
  /** A crewmate's login as the section names it, by handle. */
  readonly logins: Readonly<Record<string, CrewLogin>>;
  /** The dev services this Mate mounts: whether each reaches a database, `null` until read. */
  readonly devHosts: Readonly<Record<string, boolean | null>>;
  /** Each crewmate's memory: its entries and its unfiled lessons. */
  readonly memory: Readonly<Record<string, { readonly entries: number; readonly unfiled: number }>>;
  /** A crewmate's live context against its window, from the gauge. */
  readonly context: Readonly<Record<string, { readonly tokens: number; readonly window: number }>>;
  /** Landed tasks whose commit your remote already has. */
  readonly delivered: ReadonlySet<string>;
}

export const EMPTY_VIEW: CrewView = {
  nowMs: 0,
  epoch: 0,
  logins: {},
  devHosts: {},
  memory: {},
  context: {},
  delivered: new Set(),
};

/** A crewmate's finished tasks the board keeps; older ones page through `crew.taskPage`. */
export const FINISHED_ON_BOARD = 20;
const TASK_PAGE_DEFAULT = 20;
const DEFAULT_CONTEXT_WINDOW = 200_000;

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

const iso = (millis: number): string => DateTime.formatIso(DateTime.makeUnsafe(millis));

const firstLines = (text: string, count: number): string =>
  text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, count)
    .join("\n");

const FINISHED: ReadonlySet<string> = new Set(["landed", "discarded"]);

const devHostsOf = (view: CrewView): ReadonlyArray<CrewDevHost> =>
  Object.entries(view.devHosts)
    .map(([host, database]) => ({ host, database }))
    .toSorted((a, b) => a.host.localeCompare(b.host));

const tintOf = (member: MemberRecord): CrewTint =>
  (MATE_TINT_IDS as ReadonlyArray<string>).includes(member.tint ?? "")
    ? (member.tint as CrewTint)
    : "slate";

const laneState = (
  state: CrewState,
  member: MemberRecord,
  open: TaskRecord | undefined,
): { readonly state: CrewLaneState; readonly detail: string | null } => {
  const lane = member.lane!;
  if (lane.state === "creating" || lane.state === "setting-up" || lane.state === "failed") {
    return { state: lane.state, detail: lane.detail };
  }
  if (hostFrozen(state, member.host)) return { state: "frozen", detail: null };
  if (lane.state === "missing") return { state: "missing", detail: null };
  if (open?.wait?.on === "conflict") return { state: "conflicts", detail: null };
  return { state: "ready", detail: null };
};

const toTask = (state: CrewState, task: TaskRecord, view: CrewView): CrewTask => {
  const stats = state.members[task.owner]?.lane?.stats ?? null;
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    owner: task.owner,
    state: task.state,
    source: task.source,
    createdBy: task.createdBy,
    createdAt: iso(task.createdAt),
    dependsOn: task.dependsOn,
    fresh: task.fresh,
    brief: task.card.brief,
    doneWhen: task.card.doneWhen,
    note: task.card.note,
    attempts: attemptsOf(task),
    reason: task.state === "rework" || task.state === "parked" ? (task.wait?.reason ?? null) : null,
    question: task.state === "blocked" ? (task.report?.question ?? null) : null,
    waitingOn: task.state === "waiting-on-you" ? (task.wait?.paths ?? []) : [],
    diffStat:
      isOpenTask(task.state) && stats !== null && stats.ahead > 0
        ? { insertions: stats.insertions, deletions: stats.deletions }
        : null,
    report: task.report?.summary ?? null,
    check: task.check === null ? null : { state: task.check.state, output: task.check.output },
    review: task.review,
    landedCommit: task.landedCommit,
    landedAt: task.state === "landed" && task.landedAt !== null ? iso(task.landedAt) : null,
    delivered: task.state === "landed" && view.delivered.has(task.id),
  };
};

/** One *Waiting on you* row per task that needs the person, in board order. */
const taskAttention = (
  state: CrewState,
  task: TaskRecord,
  view: CrewView,
): CrewAttention | undefined => {
  const row = (
    kind: CrewAttention["kind"],
    fields: Partial<Pick<CrewAttention, "text" | "paths" | "at">> = {},
  ): CrewAttention => ({
    id: `${kind}:${task.id}`,
    kind,
    handle: task.owner,
    taskId: task.id,
    text: fields.text ?? null,
    paths: fields.paths ?? [],
    host: null,
    at: fields.at ?? iso(task.updatedAt),
  });
  const wait = task.wait;
  switch (task.state) {
    case "blocked":
      // The lead takes the question first; the person sees it once the lead passes it on, or after 15 minutes.
      return leadAnswers(state) &&
        state.lead.escalated[questionKey(task)] === undefined &&
        view.nowMs - (task.askedAt ?? task.updatedAt) < QUESTION_TO_PERSON_MS
        ? undefined
        : row("question", { text: task.report?.question ?? null });
    case "ready":
      return row("ready-to-land");
    case "waiting-on-you":
      return row("landing-wait", { paths: wait?.paths ?? [] });
    case "parked":
      return row("parked", { text: wait?.reason ?? null });
    case "rework":
      if (wait?.on === "conflict") return row("conflict", { paths: wait.paths });
      // A running run sends it back to its crewmate itself.
      if (wait?.on === "review") {
        return state.run?.state === "running" ? undefined : row("sent-back", { text: wait.reason });
      }
      if (wait?.on === "check-failed") {
        const last = (task.check?.output ?? "").trimEnd().split("\n").at(-1)?.trim();
        return row("check-failed", { text: last === undefined || last === "" ? null : last });
      }
      return undefined;
    case "working": {
      // Its queue waits behind it: after a few idle minutes the person sees why.
      const stopped = task.midway;
      return stopped === null || view.nowMs - stopped.since < UNATTENDED_MS
        ? undefined
        : row("stalled", { text: stopped.why, at: iso(stopped.since) });
    }
    case "review": {
      const lead = leadOf(state);
      const reviewing =
        state.lead.serving?.taskId === task.id && lead !== undefined && lead.active !== null;
      return reviewing || view.nowMs - task.updatedAt < UNATTENDED_MS
        ? undefined
        : row("review-wait");
    }
    case "queued": {
      // A dependency that will not land holds it for good.
      const gone = task.dependsOn.some((id) => {
        const dependency = state.tasks[id]?.state;
        return dependency === "discarded" || dependency === "parked";
      });
      if (gone) return row("dependency-gone");
      return task.cantStart === null
        ? undefined
        : row("cant-start", { text: task.cantStart.text, at: iso(task.cantStart.at) });
    }
    default:
      return undefined;
  }
};

/** The lead's rows: its own questions, and its plan while tasks wait as proposed. */
const leadAttention = (
  state: CrewState,
  tasks: ReadonlyArray<TaskRecord>,
): ReadonlyArray<CrewAttention> => {
  const lead = leadOf(state)?.handle ?? null;
  const row = (
    id: string,
    kind: CrewAttention["kind"],
    handle: string | null,
    text: string | null,
    at: number,
  ): CrewAttention => ({
    id,
    kind,
    handle,
    taskId: null,
    text,
    paths: [],
    host: null,
    at: iso(at),
  });
  const proposed = tasks.filter((task) => task.state === "proposed");
  return [
    ...Object.entries(state.lead.questions).map(([handle, question]) =>
      row(`question:${handle}`, "question", handle, question.text, question.at),
    ),
    ...(proposed.length === 0
      ? []
      : [
          row(
            `plan:${lead ?? "crew"}`,
            "plan",
            lead,
            null,
            Math.max(...proposed.map((task) => task.createdAt)),
          ),
        ]),
  ];
};

/** The operation a row stands for, in the shape V1's operations take. */
const operationOf = (state: CrewState, entry: AttentionRecord): CrewOperation | undefined => {
  const facts = entry.operation;
  if (facts === undefined) return undefined;
  const member = entry.handle === null ? undefined : state.members[entry.handle];
  return {
    id: entry.id,
    crew: state.ownerId.replace(/^crew\//u, ""),
    handle: entry.handle ?? "",
    taskId: entry.taskId,
    kind: facts.kind,
    stage: facts.stage,
    confirmedStage: facts.confirmedStage,
    status: facts.status,
    startedBy: facts.startedBy,
    resumeState: facts.resumeState,
    targets: {
      host: member?.host ?? null,
      path: null,
      ref: null,
      threadId: member?.conversationId ?? null,
      commandId: null,
      attempt: facts.attempt,
    },
    result: null,
    detail: entry.text,
    startedAt: iso(entry.at),
    updatedAt: iso(entry.at),
  };
};

/** Rows the crew raised itself: an effect that failed for good, a copy gone, a redeploy unread. */
const crewAttention = (state: CrewState): ReadonlyArray<CrewAttention> => [
  ...membersInOrder(state)
    .filter((member) => member.lane?.state === "missing")
    .map((member): CrewAttention => ({
      id: `copy-missing:${member.handle}`,
      kind: "copy-missing",
      handle: member.handle,
      taskId: null,
      text: null,
      paths: [],
      host: member.host,
      at: iso(member.session.startedAt),
    })),
  ...state.attention
    .filter((entry) => entry.operation?.row !== false)
    .map((entry): CrewAttention => ({
      id: entry.id,
      kind: entry.id.startsWith("deploy-unreadable:") ? "deploy-unreadable" : "interrupted",
      ...(entry.operation === undefined ? {} : { operation: operationOf(state, entry)! }),
      handle: entry.handle,
      taskId: entry.taskId,
      text: entry.text,
      paths: [],
      host: entry.id.startsWith("deploy-unreadable:")
        ? entry.id.slice("deploy-unreadable:".length)
        : null,
      at: iso(entry.at),
    })),
];

const toCrewmate = (
  state: CrewState,
  member: MemberRecord,
  tasks: ReadonlyArray<TaskRecord>,
  view: CrewView,
): Crewmate => {
  const own = tasks.filter((task) => task.owner === member.handle);
  const open = own.find((task) => isOpenTask(task.state));
  const readOnly = member.kind !== "writer";
  const lastCheck = own.findLast((task) => task.check !== null);
  const context = view.context[member.handle];
  const briefVersion = state.applied?.briefVersion ?? 1;
  return {
    handle: member.handle,
    displayName: member.displayName,
    tint: tintOf(member),
    kind: member.kind,
    jobFirstLine: member.jobFirstLine,
    jobVersion: member.jobVersion,
    promptVersions: {
      running: member.session.running,
      current: { brief: briefVersion, job: member.jobVersion },
    },
    login: view.logins[member.handle] ?? { id: member.login, label: member.login },
    model: member.model,
    effort: member.effort,
    readOnly,
    host: readOnly ? null : member.host,
    currentThreadId: ThreadId.make(member.conversationId),
    stints: [],
    conversationId: member.conversationId,
    sessions: { count: member.session.count, lastReason: member.session.lastReason },
    context:
      context === undefined
        ? null
        : { tokens: context.tokens, window: context.window || DEFAULT_CONTEXT_WINDOW },
    compactions: member.session.compactions,
    memory: view.memory[member.handle] ?? { entries: 0, unfiled: 0 },
    openTaskId: open?.id ?? null,
    queuedTaskIds: own.filter((task) => task.state === "queued").map((task) => task.id),
    lane:
      readOnly || member.lane === null
        ? null
        : {
            branch: member.lane.branch,
            ahead: member.lane.stats?.ahead ?? 0,
            insertions: member.lane.stats?.insertions ?? 0,
            deletions: member.lane.stats?.deletions ?? 0,
            dirty: member.lane.stats?.dirty ?? false,
            check:
              lastCheck?.check == null
                ? null
                : { state: lastCheck.check.state, output: lastCheck.check.output },
            ...laneState(state, member, open),
          },
    app: readOnly
      ? null
      : {
          state: member.runCommand === null ? "none" : member.app,
          port: member.crewPort,
          url: null,
        },
  };
};

const toRun = (state: CrewState, nowMs: number): CrewRun | null => {
  const run = state.run;
  if (run === null) return null;
  return {
    id: run.id,
    state: run.state,
    reason: run.reason,
    reasonDetail: run.reasonDetail,
    startedBy: run.startedBy,
    startedAt: iso(run.startedAt),
    elapsedMs: runElapsedMs(run, nowMs),
    spentUsd: run.spentUsd,
    usagePercent: usagePercentOf(state),
    options: run.options,
  };
};

/** The board as the frame carries it: everything open, and each crewmate's newest finished. */
const boardTasks = (state: CrewState): ReadonlyArray<TaskRecord> => {
  const tasks = tasksInOrder(state);
  const kept = new Set<string>();
  const finishedBy = new Map<string, number>();
  for (const task of tasks.toReversed()) {
    if (!FINISHED.has(task.state)) {
      kept.add(task.id);
      continue;
    }
    const count = finishedBy.get(task.owner) ?? 0;
    if (count < FINISHED_ON_BOARD) kept.add(task.id);
    finishedBy.set(task.owner, count + 1);
  }
  return tasks.filter((task) => kept.has(task.id));
};

/** A frame's content, its revision aside: a commit that changes nothing shown moves no frame. */
export const crewFrameContent = (frame: CrewSnapshot): string => {
  const { seq: _seq, revision: _revision, ...shown } = frame;
  return JSON.stringify(shown);
};

/**
 * The frame to publish after `published`, or none when it shows nothing new. A frame whose showing
 * moved at the same step (a dev service came up or went) comes with its view moved on, so a client
 * that takes only newer frames takes it.
 */
export const nextCrewFrame = (
  published: CrewSnapshot,
  frame: CrewSnapshot,
): CrewSnapshot | null => {
  if (crewFrameContent(published) === crewFrameContent(frame)) return null;
  const was = published.revision;
  const now = frame.revision;
  if (was === undefined || now === undefined || was.epoch !== now.epoch || was.seq !== now.seq) {
    return frame;
  }
  return { ...frame, revision: { ...now, view: (was.view ?? 0) + 1 } };
};

/** One frame of the crew feed. */
export const crewSnapshotOf = (state: CrewState, view: CrewView): CrewSnapshot => {
  const revision = { epoch: view.epoch, seq: state.headSeq };
  const applied = state.applied;
  if (applied === null) {
    return {
      ...CREW_OFF_SNAPSHOT,
      status: "none",
      seq: state.headSeq,
      revision,
      devHosts: devHostsOf(view),
      lastError: state.lastError,
    };
  }
  const tasks = boardTasks(state);
  const all = tasksInOrder(state);
  const claimAttention = Object.entries(state.claims)
    .filter(([, claim]) => claim.state === "requested")
    .map(([host, claim]): CrewAttention => ({
      id: `show-on-dev:${host}`,
      kind: "show-on-dev",
      handle: claim.handle,
      taskId: null,
      text: claim.reason,
      paths: [],
      host,
      at: iso(claim.requestedAt),
    }));
  return {
    status: "applied",
    seq: state.headSeq,
    revision,
    crew: {
      name: applied.definition.name,
      briefTitle: applied.definition.brief.title,
      briefVersion: applied.briefVersion,
      briefExcerpt: firstLines(applied.definition.brief.text, 2),
    },
    crewmates: membersInOrder(state).map((member) => toCrewmate(state, member, all, view)),
    hosts: Object.entries(state.hosts)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([host, record]) => {
        const claim = state.claims[host];
        return {
          host,
          integration: record.integration,
          crewPorts: record.crewPorts,
          served: record.served,
          claim: {
            state: claim?.state ?? "none",
            handle: claim?.handle ?? null,
            grantWaiting: claim?.grantWaiting ?? false,
          },
        };
      }),
    board: { tasks: tasks.map((task) => toTask(state, task, view)) },
    run: toRun(state, view.nowMs),
    attention: [
      ...all.flatMap((task) => taskAttention(state, task, view) ?? []),
      ...leadAttention(state, all),
      ...claimAttention,
      ...crewAttention(state),
    ],
    operations: state.attention.flatMap((entry) => operationOf(state, entry) ?? []),
    devHosts: devHostsOf(view),
    landedNotDelivered: all.filter(
      (task) =>
        task.state === "landed" && task.landedCommit !== null && !view.delivered.has(task.id),
    ).length,
    lastError: state.lastError,
  };
};

/**
 * A crewmate's finished work, newest first, before a cursor: what the board no longer carries.
 * The cursor is the last task's `#N`, opaque to the client.
 */
export const crewTaskPage = (
  state: CrewState,
  input: CrewTaskPageInput,
  view: CrewView,
): CrewTaskPage => {
  const before = input.before === null ? Number.POSITIVE_INFINITY : Number(input.before);
  const limit = input.limit ?? TASK_PAGE_DEFAULT;
  const finished = tasksInOrder(state)
    .filter((task) => task.owner === input.handle && FINISHED.has(task.state))
    .filter((task) => task.number < before)
    .toReversed();
  const page = finished.slice(0, limit);
  return {
    tasks: page.map((task) => toTask(state, task, view)),
    next: finished.length > limit ? String(page.at(-1)!.number) : null,
  };
};
