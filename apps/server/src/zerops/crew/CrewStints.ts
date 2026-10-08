/**
 * CrewStints — a standing crewmate's conversations. A stint is one Mate
 * thread over one session; the crewmate is the same across them, its copy of
 * the code and its tasks carry on.
 *
 * - **Open** (a first dispatch or a rotation): the stint's row first, so the
 *   thread directory knows the thread before its session starts; then
 *   `thread.crew.create` with `approval-required` and the crewmate's login,
 *   then usage auto-resume off (ARCHITECTURE seam 23): only the person or
 *   the engine starts a crew turn, never a usage reset.
 * - **Retire**: `thread.archive`, then `thread.session.stop` — an archive has
 *   no side effects, so the session would otherwise live on (seam 24).
 * - **Rotate** = retire the current stint, open the next with the reason and
 *   a seed: the open task, the copy's commits since it started and the last
 *   report, which the new stint's first session starts from (probe 22 failed,
 *   so every changed prompt reaches a crewmate this way, PRD §5.6).
 *
 * A stint's `reason` is the seam line its conversation opens with ("Its job
 * changed"), which the chat shows verbatim above
 * the stint's first card. A rotation no turn follows (a press between turns,
 * a fresh save at a turn's end) also writes it into the new conversation at
 * once, which is empty until its first card.
 *
 * @module CrewStints
 */
import { CommandId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import {
  asRefusal,
  currentStint,
  memberOf,
  refuse,
  requireApplied,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { rotationSeed, stintReasonWords } from "./crewCards.ts";
import { appendSeam } from "./crewSeamLines.ts";
import { crewLane } from "./CrewDefinition.ts";
import { modelSelectionFor } from "./CrewDispatch.ts";
import { CREW_ID } from "./CrewHome.ts";
import { followCrewWork } from "./crewRuns.ts";
import type { CrewStintRow } from "./CrewStore.ts";
import { isOpenTask } from "./crewSnapshot.ts";
import { readTaskCard, readTaskReport } from "./crewTaskData.ts";
import type { RotationReason } from "./rotationDecision.ts";

const dispatch = (core: CrewCore, command: Parameters<CrewCore["orchestration"]["dispatch"]>[0]) =>
  asRefusal(core.orchestration.dispatch(command, { updateContinuation: true })).pipe(Effect.asVoid);

export const openStint = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  /** `reason` is the seam line the new conversation opens with; `null` for a crewmate's first. */
  input: { readonly reason: string | null; readonly seed: string | null },
) =>
  Effect.gen(function* () {
    const project = yield* asRefusal(
      core.projection.getActiveProjectByWorkspaceRoot(core.config.cwd),
    );
    if (Option.isNone(project)) {
      return yield* refuse("io", "This Mate has no project for its crewmates' conversations.");
    }
    const stint =
      Math.max(
        0,
        ...applied.stints.filter((row) => row.member === member.row.handle).map((row) => row.stint),
      ) + 1;
    const threadId = yield* core.uuid;
    const now = yield* core.now;
    const row: CrewStintRow = {
      crew: CREW_ID,
      member: member.row.handle,
      stint,
      threadId,
      sessionId: null,
      transcriptPath: null,
      compactions: 0,
      lastCompactSummary: null,
      rotatePending: false,
      reason: input.reason,
      seededFrom: input.seed === null ? null : { text: input.seed },
      briefVersion: applied.briefVersion,
      jobVersion: member.row.jobVersion,
      startedAt: now,
      retiredAt: null,
    };
    yield* asRefusal(core.store.putStint(row));
    yield* dispatch(core, {
      type: "thread.crew.create",
      commandId: CommandId.make(`crew:stint:${threadId}`),
      threadId: ThreadId.make(threadId),
      projectId: project.value.id,
      title: member.row.displayName,
      modelSelection: yield* modelSelectionFor(core, member.row),
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: worktreeOf(applied, member),
      createdAt: now,
      crew: { crew: CREW_ID, crewmate: member.row.handle, stint },
    });
    yield* dispatch(core, {
      type: "thread.usage-auto-resume.set",
      commandId: CommandId.make(`crew:stint:${threadId}:auto-resume`),
      threadId: ThreadId.make(threadId),
      enabled: false,
    });
    yield* asRefusal(core.reload);
    return row;
  });

/** A crewmate's current conversation, or its first when it has none yet. */
export const currentOrFirstStint = (core: CrewCore, member: CrewMember) =>
  core.opening(
    Effect.gen(function* () {
      const applied = yield* requireApplied(core);
      return (
        currentStint(applied, member.row.handle) ??
        (yield* openStint(core, applied, member, { reason: null, seed: null }))
      );
    }),
  );

/**
 * At boot, a writer's current conversation that records no copy at all — a
 * stint made while the Zerops policy dropped a worktree from every new
 * thread — gets its crew copy back. Nothing was chosen there, so nothing is
 * lost; a path a person chose stays theirs (`conversationCopies`).
 */
export const repairUnsetCopies = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    for (const handle of applied.members.keys()) {
      const member = memberOf(applied, handle);
      const stint = currentStint(applied, handle);
      const crewPath = member === undefined ? null : worktreeOf(applied, member);
      if (stint === undefined || crewPath === null) continue;
      const shell = yield* core.projection
        .getThreadShellById(ThreadId.make(stint.threadId))
        .pipe(Effect.orElseSucceed(() => Option.none()));
      if (Option.isNone(shell) || (shell.value.worktreePath ?? null) !== null) continue;
      yield* dispatch(core, {
        type: "thread.meta.update",
        commandId: CommandId.make(`crew:copy:${yield* core.uuid}`),
        threadId: ThreadId.make(stint.threadId),
        worktreePath: crewPath,
      });
    }
  });

/** A selected legacy path discrepancy; reading it never changes the conversation. */
export const conversationCopies = (core: CrewCore, applied: AppliedCrew) =>
  Effect.gen(function* () {
    const rows: Array<import("@t3tools/contracts").CrewAttention> = [];
    for (const handle of applied.members.keys()) {
      const member = memberOf(applied, handle);
      const stint = currentStint(applied, handle);
      const crewPath = member === undefined ? null : worktreeOf(applied, member);
      if (stint === undefined || crewPath === null) continue;
      const shell = yield* core.projection.getThreadShellById(ThreadId.make(stint.threadId));
      if (Option.isNone(shell) || shell.value.worktreePath === crewPath) continue;
      rows.push({
        id: `conversation-copy:${stint.threadId}`,
        kind: "conversation-copy",
        handle,
        taskId: null,
        text: null,
        paths: [],
        host: null,
        at: stint.startedAt,
        copyAssignment: {
          threadId: ThreadId.make(stint.threadId),
          currentPath: shell.value.worktreePath,
          crewPath,
          source: "crew-stint",
        },
      });
    }
    return rows;
  });

/** Only the current conversation and the path the person saw may change. */
export const useCrewCopy = (
  core: CrewCore,
  input: {
    readonly handle: string;
    readonly threadId: string;
    readonly expectedPath: string | null;
  },
) =>
  Effect.gen(function* () {
    const applied = yield* requireApplied(core);
    const member = memberOf(applied, input.handle);
    const stint = currentStint(applied, input.handle);
    const crewPath = member === undefined ? null : worktreeOf(applied, member);
    const shell = yield* asRefusal(
      core.projection.getThreadShellById(ThreadId.make(input.threadId)),
    );
    if (
      stint?.threadId !== input.threadId ||
      crewPath === null ||
      Option.isNone(shell) ||
      shell.value.worktreePath !== input.expectedPath
    ) {
      return yield* refuse(
        "wrong-state",
        "The conversation changed. Open it again before choosing its copy.",
      );
    }
    yield* dispatch(core, {
      type: "thread.meta.update",
      commandId: CommandId.make(`crew:copy:${yield* core.uuid}`),
      threadId: ThreadId.make(input.threadId),
      worktreePath: crewPath,
      expectedWorktreePath: input.expectedPath,
    });
    yield* core.changed;
  });

/**
 * Where a crewmate's conversation runs: a writer's in its copy (the lane's
 * directory through the mount), so the chat's diff and file panels open the
 * copy; a reader's and the lead's in the Mate's tree.
 */
const worktreeOf = (applied: AppliedCrew, member: CrewMember): string | null => {
  const repository =
    member.row.kind === "writer" && member.row.host !== null
      ? applied.repositories.get(member.row.host)
      : undefined;
  return repository === undefined ? null : crewLane(repository, member.row.handle).mountDir;
};

export const retireStint = (core: CrewCore, stint: CrewStintRow) =>
  Effect.gen(function* () {
    const now = yield* core.now;
    yield* asRefusal(
      core.store.updateStint(stint.crew, stint.member, stint.stint, (row) => ({
        ...row,
        retiredAt: now,
        rotatePending: false,
      })),
    );
    yield* dispatch(core, {
      type: "thread.archive",
      commandId: CommandId.make(`crew:retire:${stint.threadId}`),
      threadId: ThreadId.make(stint.threadId),
    });
    yield* dispatch(core, {
      type: "thread.session.stop",
      commandId: CommandId.make(`crew:stop:${stint.threadId}`),
      threadId: ThreadId.make(stint.threadId),
      createdAt: now,
    });
    core.memory.working.delete(stint.threadId);
    core.memory.shaped.delete(stint.threadId);
    yield* followCrewWork(core);
    yield* asRefusal(core.reload);
  });

/** What a new stint of `member` starts from: its open task, its copy's commits since, its last report. */
export const stintSeed = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  reason: RotationReason,
) =>
  Effect.gen(function* () {
    const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
    const task = tasks.find((row) => row.member === member.row.handle && isOpenTask(row.state));
    const card = task === undefined ? null : readTaskCard(task.card);
    const lane =
      member.row.kind === "writer"
        ? Option.getOrUndefined(yield* asRefusal(core.store.getLane(CREW_ID, member.row.handle)))
        : undefined;
    const commits =
      task === undefined || lane === undefined
        ? []
        : yield* core.reads
            .laneLog(lane.host, member.row.handle, lane.dispatchCommit)
            .pipe(Effect.orElseSucceed(() => []));
    return rotationSeed({
      handle: member.row.handle,
      reason,
      task:
        task === undefined || card === null
          ? null
          : {
              number: task.number,
              title: task.title,
              card,
              report: readTaskReport(task.report)?.summary ?? null,
            },
      commits,
    });
  });

/** Retires the crewmate's current conversation and opens the next, seeded. */
export const rotate = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  reason: RotationReason,
) =>
  Effect.gen(function* () {
    const seed = yield* stintSeed(core, applied, member, reason);
    const current = currentStint(applied, member.row.handle);
    const latest = { brief: applied.briefVersion, job: member.row.jobVersion };
    const words = stintReasonWords(
      reason,
      current === undefined ? latest : { brief: current.briefVersion, job: current.jobVersion },
      latest,
    );
    if (current !== undefined) yield* retireStint(core, current);
    core.memory.applyChoices.delete(member.row.handle);
    const reloaded = yield* core.applied;
    return yield* openStint(core, reloaded ?? applied, member, { reason: words, seed });
  });

/** A rotation no turn follows: the new conversation opens with its seam line. */
export const rotateBetweenTurns = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  reason: RotationReason,
) =>
  Effect.gen(function* () {
    const previous = currentStint(applied, member.row.handle);
    const opened = yield* rotate(core, applied, member, reason);
    if (opened.reason !== null) {
      yield* appendSeam(core, opened.threadId, opened.reason, {
        seam: "stint",
        previousThreadId: previous === undefined ? null : ThreadId.make(previous.threadId),
      });
    }
    return opened;
  });
