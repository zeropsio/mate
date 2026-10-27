/**
 * A Mate with a crew keeps its crew when it flips to the engine: at the flip's first boot, V1's crew
 * tables are read once, bounded, and never written, and what they hold becomes the crew owner's
 * state in one step; each crewmate's V1 stints become its one conversation's earlier record.
 *
 * - **The crew and its crewmates:** the applied home, its versions, and per crewmate its login,
 *   model, effort, ports, copy and sessions. Each crewmate's conversation is
 *   `crew-main-<handle>-1`, so a second flip names the same one and takes nothing.
 * - **Open work** comes over in its state, with its counters and dependencies. A turn or a script
 *   V1 had running is gone with V1: a task merging or checking goes on from its merge-in, one
 *   landing from its landing, each waiting on a person's *Continue*; a task working mid-way goes on
 *   when the run goes on, or, outside a run, on *Continue*.
 * - **Finished work:** each crewmate's newest {@link FINISHED_PER_CREWMATE}; older stays in V1.
 * - **The run:** a crew working on its own is paused once, "stopped for an update"; *Keep going*
 *   carries it on. A paused, stopped or finished run stays as it was.
 * - **Show on dev:** a held claim stays held and its dev server is read again; a request is
 *   dropped (the crewmate asks again). **Questions** stay open on their asker, the person's due
 *   from when it was asked. **Memory** and ports come over; the crew log and old attempts do not.
 *
 * The flip: {@link importV1Crew}, after the Mate's own conversation took its history. Nothing of
 * the crew's own runs before it: the import's step settles nothing.
 *
 * @module crew/engine/importV1Crew
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  ConversationId,
  CrewRunOptions,
  CrewRunReason,
  type CrewSessionReason,
  type CrewTaskState,
  type HistorySource,
  type Principal,
} from "@t3tools/contracts";
import type { CrewDefinition, CrewMemberSpec } from "@t3tools/shared/crewHome";

import {
  make as makeCrewStore,
  type CrewAssignmentRow,
  type CrewClaimRow,
  type CrewHostRow,
  type CrewLaneRow,
  type CrewMemberRow,
  type CrewMemoryRow,
  type CrewRunRow,
  type CrewStintRow,
} from "../CrewStore.ts";
import { CREW_ID } from "../CrewHome.ts";
import { stintReasonWords } from "../crewCards.ts";
import {
  readCheckedTip,
  readTaskCard,
  readTaskCheck,
  readTaskReport,
  readTaskReview,
  readTaskWait,
} from "../crewTaskData.ts";
import { CREW_ROTATE_AFTER_DEFAULT, type RotationReason } from "../rotationDecision.ts";
import type { CrewEnvelope } from "./command.ts";
import { IMPORTED_ROW, SESSION_REASON, UPDATE_WHY, firstLine } from "./decide.ts";
import {
  DEFAULT_CREW_LOGIN,
  crewmateConversationId,
  isOpenTask,
  type AttentionRecord,
  type ClaimRecord,
  type HostRecord,
  type LaneRecord,
  type MemberRecord,
  type RunRecord,
  type TaskRecord,
} from "./state.ts";

/** Each crewmate's finished tasks the import brings, newest first; older ones stay in V1. */
export const FINISHED_PER_CREWMATE = 50;

/** The command the import is told under: the same at every flip, so a re-run gets its receipt. */
export const CREW_IMPORT_COMMAND = CommandId.make("crew-import:v1");

/** Why a crew working on its own stopped at the flip; *Keep going* carries it on. */
export const UPDATE_PAUSE = "for an update";

// ── what V1 holds ───────────────────────────────────────────────────────────────────────────

/** V1's crew as its tables hold it: everything open, its finished work bounded. */
export interface V1Crew {
  readonly definition: CrewDefinition;
  readonly briefVersion: number;
  readonly members: ReadonlyArray<CrewMemberRow>;
  readonly lanes: ReadonlyArray<CrewLaneRow>;
  readonly tasks: ReadonlyArray<CrewAssignmentRow>;
  /** Each open task's current attempt, by task. */
  readonly attempts: ReadonlyMap<string, { readonly rotations: number }>;
  readonly stints: ReadonlyArray<CrewStintRow>;
  readonly run: CrewRunRow | null;
  readonly claims: ReadonlyArray<CrewClaimRow>;
  readonly hosts: ReadonlyArray<CrewHostRow>;
  readonly memory: ReadonlyArray<CrewMemoryRow>;
}

const FINISHED: ReadonlySet<CrewTaskState> = new Set(["landed", "discarded"]);

/**
 * V1's applied crew, read only: `null` when it has none. Its finished tasks are read newest first,
 * {@link FINISHED_PER_CREWMATE} per crewmate.
 */
export const readV1Crew = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* makeCrewStore;
  const definition = Option.getOrUndefined(yield* store.getDefinition(CREW_ID));
  if (definition === undefined || definition.state !== "applied") return null;
  const rows = yield* sql<{
    readonly assignment: string;
    readonly run: string | null;
    readonly member: string;
    readonly number: number;
    readonly title: string;
    readonly source: CrewAssignmentRow["source"];
    readonly createdBy: string;
    readonly card: string | null;
    readonly pending: string | null;
    readonly dependsOn: string;
    readonly fresh: number;
    readonly state: CrewTaskState;
    readonly attempt: number;
    readonly reworks: number;
    readonly remerges: number;
    readonly mergedHead: string | null;
    readonly check: string | null;
    readonly review: string | null;
    readonly report: string | null;
    readonly waiting: string | null;
    readonly landedCommit: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>`
    SELECT assignment, run, member, number, title, source,
      created_by AS "createdBy", card_json AS "card", pending_json AS "pending",
      depends_on_json AS "dependsOn", fresh, state, attempt, reworks, remerges,
      merged_head AS "mergedHead", check_json AS "check", review_json AS "review",
      report_json AS "report", waiting_json AS "waiting", landed_commit AS "landedCommit",
      created_at AS "createdAt", updated_at AS "updatedAt"
    FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY member, state IN ('landed', 'discarded') ORDER BY number DESC
      ) AS place
      FROM crew_assignment WHERE crew = ${CREW_ID}
    )
    WHERE state NOT IN ('landed', 'discarded') OR place <= ${FINISHED_PER_CREWMATE}
    ORDER BY number
  `;
  const tasks = rows.map((row): CrewAssignmentRow => ({
    ...row,
    crew: CREW_ID,
    card: json(row.card),
    pending: json(row.pending),
    dependsOn: stringsOf(json(row.dependsOn)),
    fresh: row.fresh !== 0,
    check: json(row.check),
    review: json(row.review),
    report: json(row.report),
    waiting: json(row.waiting),
  }));
  const open = tasks.filter((task) => !FINISHED.has(task.state));
  const attempts = new Map<string, { readonly rotations: number }>();
  for (const task of open) {
    const [attempt] = yield* sql<{ readonly rotations: number }>`
      SELECT rotations FROM crew_attempt
      WHERE assignment = ${task.assignment} AND attempt = ${task.attempt}
    `;
    if (attempt !== undefined) attempts.set(task.assignment, attempt);
  }
  const members = yield* store.members(CREW_ID);
  const memory: Array<CrewMemoryRow> = [];
  for (const member of members) memory.push(...(yield* store.memory(CREW_ID, member.handle)));
  const lanes = yield* store.lanes(CREW_ID);
  const hosts: Array<CrewHostRow> = [];
  for (const host of new Set(lanes.map((lane) => lane.host))) {
    const row = Option.getOrUndefined(yield* store.getHost(host));
    if (row !== undefined) hosts.push(row);
  }
  return {
    definition: definition.spec as CrewDefinition,
    briefVersion: definition.briefVersion,
    members,
    lanes,
    tasks,
    attempts,
    stints: yield* store.stints(CREW_ID),
    run: Option.getOrNull(yield* store.latestRun(CREW_ID)),
    claims: yield* store.claims(CREW_ID),
    hosts,
    memory,
  } satisfies V1Crew;
});

const json = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const stringsOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

// ── what the crew owner takes ───────────────────────────────────────────────────────────────

/** A crewmate's memory as V1 held it, for the memory projection to write whole. */
export interface ImportedMemory {
  readonly op: "imported";
  readonly entries: ReadonlyArray<Omit<CrewMemoryRow, "crew" | "member">>;
}

/** What the crew owner takes in its import step. */
export interface CrewImport {
  readonly definition: CrewDefinition;
  readonly briefVersion: number;
  /** In the crew home's order, the lead first. */
  readonly members: ReadonlyArray<MemberRecord>;
  readonly tasks: ReadonlyArray<TaskRecord>;
  readonly run: RunRecord | null;
  readonly claims: Readonly<Record<string, ClaimRecord>>;
  readonly hosts: Readonly<Record<string, Partial<HostRecord>>>;
  readonly memory: Readonly<Record<string, ImportedMemory>>;
  /** Tasks V1 left mid-way whose next step waits on a person's *Continue*. */
  readonly interrupted: ReadonlyArray<AttentionRecord>;
}

/** A crewmate's conversation and the chain of V1 stints it continues. */
export interface CrewmateHistory {
  readonly handle: string;
  readonly conversationId: ConversationId;
  readonly source: HistorySource;
}

export interface CrewImportPlan {
  readonly crew: CrewImport;
  readonly histories: ReadonlyArray<CrewmateHistory>;
}

const ms = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

const ROTATIONS: ReadonlyArray<RotationReason> = [
  "start-fresh",
  "prompt-changed",
  "login-changed",
  "fresh-task",
  "principal-changed",
  "second-rework",
  "compactions",
  "context-overflow",
  "transcript-missing",
];

/** V1's words for a stint, as the session reason a live rotation names; `unknown` if unread. */
const WORDS: ReadonlyMap<string, CrewSessionReason> = new Map(
  ROTATIONS.flatMap((reason) =>
    [
      [
        { brief: 1, job: 1 },
        { brief: 2, job: 1 },
      ],
      [
        { brief: 1, job: 1 },
        { brief: 1, job: 2 },
      ],
      [
        { brief: 1, job: 1 },
        { brief: 2, job: 2 },
      ],
    ].map(([running, current]) => [
      stintReasonWords(reason, running!, current!),
      SESSION_REASON[reason],
    ]),
  ),
);

export const stintReason = (words: string | null): CrewSessionReason | null =>
  words === null ? null : (WORDS.get(words) ?? "unknown");

const decodeOptions = Schema.decodeUnknownOption(CrewRunOptions);
const isRunReason = Schema.is(CrewRunReason);

const optionsOf = (row: CrewRunRow): CrewRunOptions =>
  Option.getOrElse(decodeOptions(row.options), () => ({
    budgetUsd: row.budgetUsd ?? "unlimited",
    timeLimitHours: "unlimited",
    stopAtUsagePercent: null,
    landing: "person",
    devGrant: false,
    leadMayStart: false,
  }));

/** The run as the engine keeps it: a crew working on its own is paused, once, for the update. */
const runOf = (row: CrewRunRow): RunRecord => {
  const base = {
    id: row.run,
    startedBy: row.startedBy,
    startedAt: Date.parse(row.startedAt),
    options: optionsOf(row),
    spentUsd: row.spentUsd,
    keptMs: row.wallMs,
    since: null,
    leadWakes: 0,
  };
  switch (row.state) {
    case "running":
      return { ...base, state: "paused", reason: null, reasonDetail: UPDATE_PAUSE };
    case "finishing":
      // Its last turns were cut with V1: there is nothing left for it to wrap up.
      return { ...base, state: "finished", reason: null, reasonDetail: null };
    default:
      return {
        ...base,
        state: row.state,
        reason: isRunReason(row.reason) ? row.reason : null,
        reasonDetail: row.reasonDetail,
      };
  }
};

/** Where a task V1 had moving goes on from, now its turn or script is gone. */
const STAGE: Partial<
  Record<CrewTaskState, { readonly state: CrewTaskState; readonly row: string }>
> = {
  merging: { state: "merging", row: "its merge-in stopped for an update; Continue merges again" },
  checking: { state: "merging", row: "its check stopped for an update; Continue checks again" },
  landing: { state: "ready", row: "its landing stopped for an update; Continue lands it" },
};

const taskOf = (
  row: CrewAssignmentRow,
  v1: V1Crew,
  at: number,
  runOn: boolean,
): { readonly task: TaskRecord; readonly row: AttentionRecord | null } => {
  const card = readTaskCard(row.card);
  const stage = STAGE[row.state];
  const report = readTaskReport(row.report);
  const check = readTaskCheck(row.check);
  const updatedAt = Date.parse(row.updatedAt);
  const lead = v1.members.find((member) => member.handle === row.member)?.kind === "lead";
  const task: TaskRecord = {
    id: row.assignment,
    number: row.number,
    title: row.title,
    owner: row.member,
    state: stage?.state ?? row.state,
    source: row.source,
    createdBy: row.source === "lead" ? null : row.createdBy,
    createdAt: Date.parse(row.createdAt),
    updatedAt,
    dependsOn: row.dependsOn,
    fresh: row.fresh,
    card: card ?? { brief: row.title, doneWhen: "", note: null },
    counters: {
      attempt: Math.max(1, row.attempt),
      reworks: row.reworks,
      remerges: row.remerges,
      requeues: 0,
      rotations: v1.attempts.get(row.assignment)?.rotations ?? 0,
    },
    started: row.attempt > 0,
    wait: readTaskWait(row.waiting),
    report,
    askedAt: row.state === "blocked" && !lead ? updatedAt : null,
    review: readTaskReview(row.review),
    check: check === null ? null : { ...check, tip: readCheckedTip(row.check) ?? null },
    landedCommit: row.landedCommit,
    landedAt: row.state === "landed" ? updatedAt : null,
    cantStart: null,
    midway: row.state === "working" ? { since: at, why: UPDATE_WHY } : null,
    starting: null,
    landAs: null,
    nudgedAttempt: null,
    landRetriedAttempt: null,
    checkpointing: false,
    runId: row.run,
  };
  const words =
    stage?.row ?? (row.state === "working" && !runOn ? "it stopped for an update" : null);
  return {
    task,
    row:
      words === null
        ? null
        : {
            id: `${IMPORTED_ROW}${row.assignment}`,
            handle: row.member,
            taskId: row.assignment,
            text: words,
            at,
          },
  };
};

const laneOf = (row: CrewLaneRow | undefined): LaneRecord => ({
  branch: row?.branch ?? "",
  // Git is the truth for a copy: the boot's sweep reads it again. A copy V1 lost is missing.
  state: row === undefined || row.state === "lost" ? "missing" : "ready",
  detail: null,
  stats: null,
});

const memberOf = (
  spec: CrewMemberSpec,
  row: CrewMemberRow | undefined,
  v1: V1Crew,
  hasOpenTask: boolean,
  at: number,
): MemberRecord => {
  const stints = v1.stints
    .filter((stint) => stint.member === spec.handle)
    .toSorted((left, right) => left.stint - right.stint);
  const current = stints.at(-1);
  const login = row?.login ?? spec.login ?? DEFAULT_CREW_LOGIN;
  const writer = spec.kind === "writer";
  return {
    handle: spec.handle,
    kind: spec.kind,
    displayName: row?.displayName ?? spec.displayName,
    tint: row?.tint ?? spec.tint ?? null,
    login,
    model: row?.model ?? spec.model ?? null,
    effort: row?.effort ?? spec.effort ?? null,
    host: writer ? (row?.host ?? spec.host ?? null) : null,
    check: spec.check ?? null,
    setup: spec.setup ?? null,
    runCommand: row?.runCommand ?? spec.run ?? null,
    restartAfterMerge: row?.restartAfterMerge ?? spec.restartAfterMerge,
    rotateAfter: spec.rotateAfter ?? CREW_ROTATE_AFTER_DEFAULT,
    crewPort: row?.crewPort ?? null,
    jobFirstLine: firstLine(spec.job),
    conversationId: ConversationId.make(crewmateConversationId(v1.definition.crew, spec.handle, 1)),
    jobVersion: row?.jobVersion ?? 1,
    session: {
      count: Math.max(1, stints.length),
      lastReason: stintReason(current?.reason ?? null),
      running: null,
      principal: null,
      login,
      compactions: current?.compactions ?? 0,
      startedAt: ms(current?.startedAt ?? null) ?? at,
    },
    apply: null,
    // Its V1 session does not come over: a crewmate with work open starts the next one from its
    // state packet, as after a transcript lost.
    rotateWhenFree: hasOpenTask ? "transcript-missing" : null,
    active: null,
    lastEnd: null,
    carryOn: null,
    lastNote: null,
    lane: writer ? laneOf(v1.lanes.find((lane) => lane.lane === spec.handle)) : null,
    app: "stopped",
  };
};

/** What V1's crew becomes on the engine, at `at`: the crew owner's import and each chain. */
export const crewImportOf = (v1: V1Crew, at: number): CrewImportPlan => {
  const run = v1.run === null ? null : runOf(v1.run);
  const runOn = run?.state === "running" || run?.state === "paused";
  const imported = v1.tasks.map((row) => taskOf(row, v1, at, runOn));
  const tasks = imported.map((entry) => entry.task);
  const open = new Set(tasks.filter((task) => isOpenTask(task.state)).map((task) => task.owner));
  const specs = [
    ...v1.definition.members.filter((spec) => spec.kind === "lead"),
    ...v1.definition.members.filter((spec) => spec.kind !== "lead"),
  ];
  const members = specs.map((spec) =>
    memberOf(
      spec,
      v1.members.find((row) => row.handle === spec.handle),
      v1,
      open.has(spec.handle),
      at,
    ),
  );
  const handles = new Set(members.map((member) => member.handle));

  const claims: Record<string, ClaimRecord> = {};
  for (const claim of v1.claims) {
    if (claim.state !== "held" || !handles.has(claim.member)) continue;
    claims[claim.host] = {
      state: "held",
      handle: claim.member,
      requestedAt: Date.parse(claim.requestedAt),
      reason: null,
      grantWaiting: false,
      devServer: null,
      workDir: null,
      grantedBy:
        claim.grantedBy === null
          ? null
          : ({ kind: "person", subject: claim.grantedBy } as Principal),
    };
  }

  const hosts: Record<string, Partial<HostRecord>> = {};
  for (const member of members) {
    if (member.host !== null) hosts[member.host] = {};
  }
  for (const row of v1.hosts) hosts[row.host] = { ...hosts[row.host], crewPorts: row.crewPorts };
  for (const lane of v1.lanes) {
    const since = ms(lane.frozenSince);
    const frozen = hosts[lane.host]?.frozenSince ?? null;
    if (since !== null && (frozen === null || since < frozen)) {
      hosts[lane.host] = { ...hosts[lane.host], frozenSince: since };
    }
  }

  const memory: Record<string, ImportedMemory> = {};
  for (const entry of v1.memory) {
    if (!handles.has(entry.member)) continue;
    const { crew: _crew, member, ...rest } = entry;
    memory[member] = { op: "imported", entries: [...(memory[member]?.entries ?? []), rest] };
  }

  const histories = members.flatMap((member): ReadonlyArray<CrewmateHistory> => {
    const stints = v1.stints
      .filter((stint) => stint.member === member.handle)
      .toSorted((left, right) => left.stint - right.stint);
    const first = stints[0];
    if (first === undefined) return [];
    return [
      {
        handle: member.handle,
        conversationId: member.conversationId,
        source: {
          kind: "v1",
          threadId: first.threadId,
          chain: stints.map((stint, index) => ({
            threadId: stint.threadId,
            reason: index === 0 ? null : stintReason(stint.reason),
            words: stint.reason,
          })),
        },
      },
    ];
  });

  return {
    crew: {
      definition: v1.definition,
      briefVersion: v1.briefVersion,
      members,
      tasks,
      run,
      claims,
      hosts,
      memory,
      interrupted: imported.flatMap((entry) => (entry.row === null ? [] : [entry.row])),
    },
    histories,
  };
};

// ── the flip ────────────────────────────────────────────────────────────────────────────────

/** How the flip reaches the engine: the wiring binds both to the live engine. */
export interface CrewImportDoor<E> {
  /**
   * Starts a crewmate conversation's import of its earlier record (`askImport`): the turns it
   * reserved, none when it already has them or already ran.
   */
  readonly history: (
    conversation: ConversationId,
    source: HistorySource,
  ) => Effect.Effect<number, E>;
  /** Tells the crew owner, receipt-safe by the envelope's command id. */
  readonly crew: (envelope: CrewEnvelope) => Effect.Effect<unknown, E>;
}

export interface CrewImportReport {
  /** V1 had an applied crew. */
  readonly crew: boolean;
  readonly crewmates: number;
  readonly tasks: number;
  /** The V1 turns the crewmates' conversations reserved this time; none on a re-run. */
  readonly turns: number;
}

const ENGINE: Principal = { kind: "engine" };

/**
 * The flip's crew step, once the Mate's own conversation took its history: each crewmate's chain is
 * asked first (its conversation holds every run until its record is in), then the crew owner takes
 * the crew. Each part is receipt-safe and imports once, so a restart anywhere runs it again whole.
 */
export const importV1Crew = <E>(door: CrewImportDoor<E>, at: number) =>
  Effect.gen(function* () {
    const v1 = yield* readV1Crew;
    if (v1 === null) return { crew: false, crewmates: 0, tasks: 0, turns: 0 } as CrewImportReport;
    const plan = crewImportOf(v1, at);
    let turns = 0;
    for (const history of plan.histories) {
      turns += yield* door.history(history.conversationId, history.source);
    }
    yield* door.crew({
      commandId: CREW_IMPORT_COMMAND,
      principal: ENGINE,
      input: { _tag: "ImportV1", crew: plan.crew },
    });
    return {
      crew: true,
      crewmates: plan.crew.members.length,
      tasks: plan.crew.tasks.length,
      turns,
    } as CrewImportReport;
  });
