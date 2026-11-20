/**
 * A dev host's redeploys and the Mate's restarts: a frozen host, its copies' recovery and thaw, a writer's app, the logins the Mate reports, and the V1 crew's import.
 *
 * @module crew/engine/decide.host
 */
import { CHECKED_STATES } from "../crewMachines.ts";
import { taskAssignment } from "./command.ts";
import type { CrewImport } from "./importV1Crew.ts";
import {
  copyBusy,
  hostFrozen,
  isWorking,
  membersInOrder,
  openTaskOf,
  questionKey,
  runningRun,
  tasksInOrder,
  DEFAULT_CREW_TIMING,
  frozenHosts,
  type CrewState,
  type CrewTiming,
  type MemberRecord,
  type TaskRecord,
} from "./state.ts";
import { type Builder, userOf, crewAs, laneEnvironmentOf } from "./decide.step.ts";
import { STOPPED_MIDWAY, deliver } from "./decide.turns.ts";
import { mergeIn } from "./decide.land.ts";
import { assignAgent } from "./decide.home.ts";
import { renewLeadWakes } from "./decide.run.ts";
import { advanceMember } from "./decide.advance.ts";
import { QUESTION_TO_PERSON_MS } from "./decide.tools.ts";

export const deploy = (b: Builder, host: string, phase: "started" | "ended"): void => {
  const record = b.state.hosts[host];
  const writers = membersInOrder(b.state).filter((member) => member.host === host);
  if (writers.length === 0) return;
  if (phase === "started") {
    if (record?.frozenSince != null) return;
    b.emit({ _tag: "HostUpdated", host, set: { frozenSince: b.now } });
    for (const member of writers) {
      if (member.active === null) continue;
      // Its turn goes on once the copies are back, for whoever it ran for.
      if (member.active.taskId !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: {
            carryOn: { why: redeployWords(host), as: crewAs(userOf(member.active.principal)) },
          },
        });
      }
      deliver(
        b,
        member,
        { _tag: "Stop", runId: member.active.runId },
        {
          purpose: "stop",
          taskId: null,
          principal: { kind: "engine" },
          text: null,
        },
      );
    }
    // The copies freeze in git too: no turn's save, merge or landing writes under the deploy.
    b.effect({ kind: "crew.host.freeze", host }, host, { host });
    return;
  }
  if (record?.frozenSince == null) return;
  recover(b, host);
};

/** Why a turn a redeploy stopped goes on once its copy is back. */
const redeployWords = (host: string): string =>
  `A redeploy of ${host} stopped your last turn; it goes on now that your copy is back.`;

/** The words a host frozen after a restart stands in while its redeploy runs or cannot be read. */
export const frozenWords = (host: string, phase: "running" | "unreadable"): string =>
  phase === "running"
    ? `${host} is still redeploying; its crew copies stay frozen until the deploy ends.`
    : `Mate could not read whether ${host}'s deploy still runs; its crew copies stay frozen, and Mate reads it again when Zerops reports a process.`;

export const timingOf = (state: CrewState): CrewTiming => state.timing ?? DEFAULT_CREW_TIMING;

/**
 * A frozen host's redeploy is read: at boot, and again at each process Zerops pushes. A read
 * under way may hold an answer from before the push, so one more queues behind it in the host's
 * lane; a third would read what the second does.
 */
export const readDeploy = (b: Builder, host: string): void => {
  const reads = Object.values(b.state.effects).filter(
    (effect) => effect.kind === "crew.deploy.poll" && effect.host === host,
  ).length;
  if (reads < 2) b.effect({ kind: "crew.deploy.poll", host }, host, { host });
};

/** A host whose copies are being recovered is no longer read for its redeploy. */
export const recovering = (b: Builder, host: string): boolean =>
  Object.values(b.state.effects).some(
    (effect) => effect.kind === "crew.recover" && effect.host === host,
  );

export const recover = (b: Builder, host: string): void => {
  if (recovering(b, host)) return;
  b.cancel("thaw-offer", host, "the redeploy ended");
  const writers = membersInOrder(b.state).filter((member) => member.host === host);
  const handles = new Set(writers.map((member) => member.handle));
  b.effect(
    {
      kind: "crew.recover",
      host,
      handles: writers.map((member) => member.handle),
      specs: writers.map((member) => ({
        handle: member.handle,
        setup: member.setup,
        ...laneEnvironmentOf(b.state, member),
      })),
      landings: tasksInOrder(b.state)
        .filter((task) => task.landedCommit !== null && handles.has(task.owner))
        .map((task) => ({ assignment: taskAssignment(task), title: task.title })),
    },
    host,
    { host },
  );
};

export const thaw = (
  b: Builder,
  host: string,
  lost: ReadonlyArray<string>,
  losses: ReadonlyArray<string> = [],
): void => {
  b.emit({ _tag: "HostUpdated", host, set: { frozenSince: null, unknownSince: null } });
  if (b.state.attention.some((row) => row.id === `deploy-unreadable:${host}`)) {
    b.emit({ _tag: "AttentionCleared", id: `deploy-unreadable:${host}` });
  }
  if (losses.length > 0) {
    b.emit({
      _tag: "ErrorNoted",
      text: `${host} came back from its deploy without crew work: ${losses.join(", ")}`,
    });
  } else if (
    b.state.lastError === frozenWords(host, "running") ||
    b.state.lastError === frozenWords(host, "unreadable")
  ) {
    b.emit({ _tag: "ErrorNoted", text: null });
  }
  for (const handle of lost) {
    const member = b.state.members[handle];
    if (member?.lane == null) continue;
    b.emit({
      _tag: "CrewmateUpdated",
      handle,
      set: { lane: { ...member.lane, state: "missing" } },
    });
  }
  for (const found of membersInOrder(b.state)) {
    if (found.host !== host) continue;
    // A copy the recovery brought back from its branch stands ready again.
    if (found.lane?.state === "missing" && !lost.includes(found.handle)) {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: found.handle,
        set: { lane: { ...found.lane, state: "ready" } },
      });
    }
    const member = b.state.members[found.handle]!;
    // What the redeploy or a restart left in the copy is saved first, as at boot.
    if (
      member.kind === "writer" &&
      member.lane?.state === "ready" &&
      !lost.includes(member.handle)
    ) {
      b.effect(
        {
          kind: "crew.sweep",
          handle: member.handle,
          host,
          checked: CHECKED_STATES.has(openTaskOf(b.state, member.handle)?.state ?? "queued"),
        },
        member.handle,
        { handle: member.handle },
      );
    }
    // A redeploy drops the supervisor's crew apps (spec-mate §2.8a.2): the engine adds them again.
    if (
      member.app === "running" &&
      member.runCommand !== null &&
      member.lane?.state === "ready" &&
      !lost.includes(member.handle)
    ) {
      runApp(b, member, member.runCommand);
    }
    const open = openTaskOf(b.state, member.handle);
    if (open?.state === "merging" && !open.checkpointing) mergeIn(b, open);
  }
};

/** A writer's own app run on its crew port, by the dev service's supervisor. */
export const runApp = (b: Builder, member: MemberRecord, command: string): void => {
  b.effect(
    {
      kind: "crew.app.run",
      handle: member.handle,
      host: member.host!,
      command,
      ...laneEnvironmentOf(b.state, member),
    },
    member.handle,
    { handle: member.handle },
  );
};

export const loginsChanged = (b: Builder, logins: ReadonlyArray<string>): void => {
  const changed = new Set(logins);
  for (const task of tasksInOrder(b.state)) {
    const member = b.state.members[task.owner];
    if (
      task.state === "queued" &&
      task.cantStart !== null &&
      member !== undefined &&
      changed.has(member.login)
    ) {
      b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { cantStart: null } });
    }
  }
};

/** What a restart stopped after a task's turn had ended, by the stage it stood in (V1's words). */
const AFTER_TURN_STAGES: Readonly<Partial<Record<TaskRecord["state"], string>>> = {
  merging: "Its turn had ended; the Mate restarted during its check.",
  checking: "Its turn had ended; the Mate restarted during its check.",
  landing: "Its turn had ended; the Mate restarted during its landing.",
};

export const recovered = (b: Builder): void => {
  renewLeadWakes(b);
  // A redeploy the restart cut off may still run: its host stays frozen until a read says it ended.
  for (const host of frozenHosts(b.state)) readDeploy(b, host);
  for (const member of membersInOrder(b.state)) {
    if (
      member.kind === "writer" &&
      member.lane?.state === "ready" &&
      !copyBusy(b.state, member.handle) &&
      // A frozen host's copies are swept once its redeploy ends.
      !hostFrozen(b.state, member.host)
    ) {
      const open = openTaskOf(b.state, member.handle);
      b.effect(
        {
          kind: "crew.sweep",
          handle: member.handle,
          host: member.host!,
          checked: open !== undefined && CHECKED_STATES.has(open.state),
        },
        member.handle,
        { handle: member.handle },
      );
    }
  }
  // What a restart cut after a turn's end (its save, its check, its landing) ends the attempt in
  // V1's words; the work itself goes on as its effect is taken up again.
  for (const task of tasksInOrder(b.state)) {
    const stage = AFTER_TURN_STAGES[task.state];
    if (stage === undefined) continue;
    const rows = task.attemptRows ?? [];
    const at = rows.findIndex((row) => row.attempt === task.counters.attempt);
    if (at === -1 || rows[at]!.endedAt !== null) continue;
    b.emit({
      _tag: "TaskUpdated",
      taskId: task.id,
      set: {
        attemptRows: rows.map((row, index) =>
          index === at
            ? // When the task last moved: what the restart cut stood then.
              { ...row, ending: "interrupted", endingDetail: stage, endedAt: task.updatedAt }
            : row,
        ),
      },
    });
  }
  // A running run carries on what a restart found stopped mid-way (V1's boot): its task goes on.
  if (runningRun(b.state) === undefined) return;
  for (const member of membersInOrder(b.state)) {
    const open = openTaskOf(b.state, member.handle);
    if (
      open?.state !== "working" ||
      open.midway === null ||
      isWorking(b.state, member.handle) ||
      member.carryOn !== null
    ) {
      continue;
    }
    b.emit({
      _tag: "CrewmateUpdated",
      handle: member.handle,
      set: { carryOn: { why: STOPPED_MIDWAY, as: null } },
    });
    advanceMember(b, member.handle);
  }
};

/**
 * V1's crew, taken in one step at the flip: its crewmates get their agents, held claims their dev
 * server read again, open questions their wake from when they were asked, a frozen host its
 * redeploy read, and each copy the boot's sweep. A crew that holds one already takes nothing.
 */
export const importV1 = (b: Builder, crew: CrewImport): void => {
  if (b.state.applied !== null || Object.keys(b.state.tasks).length > 0) return;
  b.emit({
    _tag: "CrewApplied",
    definition: crew.definition,
    briefVersion: crew.briefVersion,
    members: crew.members,
    removed: [],
  });
  for (const [host, set] of Object.entries(crew.hosts)) b.emit({ _tag: "HostUpdated", host, set });
  for (const task of crew.tasks) b.emit({ _tag: "TaskCreated", task });
  if (crew.run !== null) b.emit({ _tag: "RunStarted", run: crew.run });
  for (const [host, claim] of Object.entries(crew.claims)) {
    b.emit({ _tag: "ClaimUpdated", host, claim });
    b.effect({ kind: "crew.claim.read", host, handle: claim.handle, purpose: "import" }, host, {
      host,
      handle: claim.handle,
    });
  }
  for (const [handle, op] of Object.entries(crew.memory)) {
    b.emit({ _tag: "MemoryChanged", handle, op });
  }
  for (const row of crew.interrupted) b.emit({ _tag: "AttentionRaised", row });
  for (const task of tasksInOrder(b.state)) {
    if (task.state === "blocked" && task.askedAt !== null && task.report?.question != null) {
      b.arm("question", questionKey(task), task.askedAt + QUESTION_TO_PERSON_MS, {
        kind: "engine",
      });
    }
  }
  for (const member of membersInOrder(b.state)) assignAgent(b, member);
  recovered(b);
};
