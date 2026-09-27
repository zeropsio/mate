// @effect-diagnostics nodeBuiltinImport:off - the gate resolves a tool's path by its real path, synchronously.
/**
 * crewDirectory — the engine's side of the seam (`crewSeams.ts`): who a
 * thread is (`CrewThreadDirectory`) and what a crew tool does
 * (`CrewToolHost`).
 *
 * `memberFor` is answered from the engine's in-memory copy of the crew, at
 * every tool call and session event of a crew thread, so a shaped turn, a
 * held claim or a retired stint shows in the very next decision. A thread no
 * stint names is a person's: no member, and the adapter runs it unchanged.
 * A stint that is not its crewmate's current one is not live: the policy
 * gives it the deny-all profile.
 *
 * A crew tool answers with text the model reads; a refusal is an `isError`
 * answer in the engine's words, never a failure of the call.
 *
 * @module crewDirectory
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { crewLane } from "./CrewDefinition.ts";
import {
  asRefusal,
  currentStint,
  laterPrincipal,
  memberOf,
  refuse,
  requireApplied,
  type AppliedCrew,
  type CrewCore,
  type CrewMember,
} from "./crewCore.ts";
import { CREW_ID } from "./CrewHome.ts";
import { crewRefusedRoots, type GateContext } from "./CrewPolicy.ts";
import { holdsClaim } from "./CrewRuntime.ts";
import { releaseClaim, showOnDev } from "./crewClaims.ts";
import type { CrewPromptMember } from "./crewPrompt.ts";
import type {
  CrewMemoryOp,
  CrewReportInput,
  CrewSessionStart,
  CrewThreadMember,
  CrewToolText,
} from "./crewSeams.ts";
import { isOpenTask } from "./crewSnapshot.ts";
import type { CrewStintRow } from "./CrewStore.ts";
import { readTaskCard } from "./crewTaskData.ts";
import { openTaskOf, saveTask, stepTask } from "./crewTasks.ts";

/** A crew turn's commands run at most this long in the crewmate's copy. */
export const CREW_PAYLOAD_TIMEOUT_SECONDS = 600;

/** The context window when `crew.yaml` names none. */
export const CREW_CONTEXT_DEFAULT = 200_000;

/**
 * The canonical path of an absolute path; a path that does not exist yet (a
 * file about to be written) resolves through its nearest existing ancestor.
 */
export const realpathOrNearest = (path: string): string => {
  try {
    return NodeFS.realpathSync(path);
  } catch {
    const parent = NodePath.dirname(path);
    return parent === path
      ? path
      : NodePath.join(realpathOrNearest(parent), NodePath.basename(path));
  }
};

const gateFor = (
  core: CrewCore,
  applied: AppliedCrew,
  member: CrewMember,
  stint: CrewStintRow,
): { readonly gate: GateContext; readonly prompt: CrewPromptMember } | undefined => {
  const { row, spec } = member;
  const shaped = core.memory.shaped.get(stint.threadId);
  const base = {
    foreignMigrations: applied.definition.members
      .filter(
        (other) =>
          other.handle !== row.handle && other.kind === "writer" && other.host === row.host,
      )
      .flatMap((other) => other.migrations),
    refusedRoots: crewRefusedRoots({ workspaceRoot: core.config.cwd, home: NodeOS.homedir() }),
    realpath: realpathOrNearest,
    workspaceRoot: core.config.cwd,
    turn: shaped?.turn ?? "work",
    holdsClaim: row.host !== null && holdsClaim(core.memory.claims.get(row.host), row.handle),
    ...(shaped?.devServer === undefined ? {} : { devServer: shaped.devServer }),
    payloadTimeoutSeconds: CREW_PAYLOAD_TIMEOUT_SECONDS,
  } as const;
  if (row.kind !== "writer") {
    return {
      gate: {
        kind: "live",
        member: { handle: row.handle, kind: row.kind, env: spec.env },
        ...base,
      },
      prompt: { handle: row.handle, kind: row.kind },
    };
  }
  const repository = row.host === null ? undefined : applied.repositories.get(row.host);
  if (repository === undefined) return undefined;
  const lane = crewLane(repository, row.handle);
  return {
    gate: {
      kind: "live",
      member: {
        handle: row.handle,
        kind: "writer",
        lane,
        ...(row.crewPort === null ? {} : { crewPort: row.crewPort }),
        env: spec.env,
      },
      ...base,
      // A writer's conversation runs in its copy (its stint's worktree), so
      // a relative path resolves there.
      workspaceRoot: lane.mountDir,
    },
    prompt: { handle: row.handle, kind: "writer", lane },
  };
};

/** The seam's `memberFor`: one lookup in memory, never a read of the tables. */
export const memberFor = (core: CrewCore) => (threadId: string) =>
  Effect.map(core.applied, (applied): Option.Option<CrewThreadMember> => {
    if (applied === undefined) return Option.none();
    const stint = applied.stints.find((row) => row.threadId === threadId);
    const member = stint === undefined ? undefined : memberOf(applied, stint.member);
    if (stint === undefined || member === undefined) return Option.none();
    const { row, spec } = member;
    const current =
      stint.retiredAt === null && currentStint(applied, row.handle)?.threadId === threadId;
    const shaped = current ? gateFor(core, applied, member, stint) : undefined;
    return Option.some({
      crew: CREW_ID,
      handle: row.handle,
      kind: row.kind,
      stint: stint.stint,
      live: shaped !== undefined,
      gate: shaped?.gate ?? { kind: "deny-all" },
      prompt: {
        // A stint that is not live runs the deny-all profile, which carries no
        // prompt; its member is named without a copy it may not use.
        member: shaped?.prompt ?? {
          handle: row.handle,
          kind: row.kind === "lead" ? "lead" : "reader",
        },
        brief: applied.definition.brief,
        briefVersion: applied.briefVersion,
        job: spec.job,
        jobVersion: row.jobVersion,
        memory: false,
        crewTools: applied.agents.get(row.handle) !== "codex",
      },
      contextWindow: spec.context ?? CREW_CONTEXT_DEFAULT,
      ...(row.model === null ? {} : { model: row.model }),
      ...(row.effort === null ? {} : { effort: row.effort }),
    });
  });

const text = (value: string): CrewToolText => ({ text: value, isError: false });
const error = (value: string): CrewToolText => ({ text: value, isError: true });

/** Any failure of a tool's work, as an answer the model reads. */
const answered = <E extends { readonly message: string }>(effect: Effect.Effect<CrewToolText, E>) =>
  effect.pipe(Effect.catch((failure) => Effect.succeed(error(failure.message))));

/** `crew_report` (CONCEPT §5): done starts the merge-in at the turn's end; blocked asks the person. */
export const report = (core: CrewCore, member: CrewThreadMember, input: CrewReportInput) =>
  answered(
    Effect.gen(function* () {
      const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
      const open = openTaskOf(tasks, member.handle);
      if (open === undefined) {
        return text("You have no open task. The person gives you one with a message or a task.");
      }
      if (input.lessons !== undefined && input.lessons.length > 0) {
        yield* asRefusal(core.crewMemory.recordLessons(member, input.lessons, open.assignment));
      }
      const reported = {
        ...open,
        report: {
          status: input.status,
          summary: input.summary,
          question: input.question ?? null,
        },
      };
      switch (input.status) {
        case "progress":
          yield* saveTask(core, reported);
          yield* core.changed;
          return text("Noted.");
        case "blocked":
          yield* stepTask(core, reported, { type: "report-blocked" }, (next) => ({
            ...next,
            report: { ...reported.report, question: input.question ?? input.summary },
          }));
          yield* core.changed;
          return text(
            "Your question is with the person. Stop here; the answer arrives as a message.",
          );
        case "done": {
          yield* stepTask(core, reported, { type: "report-done" });
          const host = (yield* requireApplied(core)).members.get(member.handle)?.host ?? null;
          if (host !== null && holdsClaim(core.memory.claims.get(host), member.handle)) {
            yield* releaseClaim(core, laterPrincipal(open), host, "report");
          }
          yield* core.changed;
          return text(
            "Reported. When this turn ends the engine commits your work, merges your tree's head into " +
              "your copy and runs the check; the person lands it. Stop here.",
          );
        }
      }
    }),
  );

/** `crew_board`: the roster and the tasks (PRD Δ7 — never in the prompt). */
export const board = (core: CrewCore) =>
  answered(
    Effect.gen(function* () {
      const applied = yield* requireApplied(core);
      const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
      const roster = applied.definition.members.flatMap((spec) => {
        const row = applied.members.get(spec.handle);
        if (row === undefined) return [];
        const open = tasks.find((task) => task.member === spec.handle && isOpenTask(task.state));
        const job =
          spec.job
            .split("\n")
            .find((line) => line.trim() !== "")
            ?.trim() ?? "";
        return [
          `- @${spec.handle} (${row.displayName}), ${spec.kind}${row.host === null ? "" : ` on ${row.host}`}` +
            `${job === "" ? "" : ` — ${job}`}` +
            `${open === undefined ? "" : ` — on #${open.number} ${open.title}`}`,
        ];
      });
      const board = tasks
        .filter((task) => task.state !== "discarded")
        .map((task) => {
          const card = readTaskCard(task.card);
          const done = card?.doneWhen.trim() ?? "";
          return `- #${task.number} ${task.title} — @${task.member} — ${task.state}${done === "" ? "" : ` — done when: ${done}`}`;
        });
      return text(
        [
          `Crew ${applied.definition.name} — brief v${applied.briefVersion}: ${applied.definition.brief.title}`,
          "",
          "Crewmates:",
          ...roster,
          "",
          "Tasks:",
          ...(board.length === 0 ? ["- none yet"] : board),
        ].join("\n"),
      );
    }),
  );

/** `crew_diff`: a crewmate's changes against your tree; its own when no handle is named. */
export const diff = (
  core: CrewCore,
  member: CrewThreadMember,
  input: { readonly handle?: string; readonly path?: string },
) =>
  answered(
    Effect.gen(function* () {
      const applied = yield* requireApplied(core);
      const handle = input.handle ?? member.handle;
      const target = memberOf(applied, handle);
      if (target === undefined) return yield* refuse("unknown-crewmate", `@${handle}`);
      if (target.row.host === null) return error(`@${handle} has no copy of the code.`);
      const changes = yield* asRefusal(core.reads.diff(target.row.host, handle, input.path));
      return text(changes.trim() === "" ? `@${handle} has no changes against your tree.` : changes);
    }),
  );

/**
 * A session of the crewmate's current stint started: the stint records its
 * session and transcript (a stint with a session is active), and a new
 * stint's first session starts from its rotation seed.
 */
export const sessionStart = (core: CrewCore, member: CrewThreadMember, event: CrewSessionStart) =>
  Effect.gen(function* () {
    const applied = yield* core.applied;
    const stint = applied?.stints.find(
      (row) => row.member === member.handle && row.stint === member.stint,
    );
    if (stint === undefined) return undefined;
    if (stint.sessionId !== event.sessionId || stint.transcriptPath !== event.transcriptPath) {
      yield* core.store
        .updateStint(stint.crew, stint.member, stint.stint, (row) => ({
          ...row,
          sessionId: event.sessionId,
          transcriptPath: event.transcriptPath,
        }))
        .pipe(Effect.andThen(core.reload), Effect.andThen(core.changed), Effect.ignore);
    }
    const seed = stint.seededFrom;
    return event.source === "startup" &&
      typeof seed === "object" &&
      seed !== null &&
      "text" in seed &&
      typeof seed.text === "string"
      ? seed.text
      : undefined;
  });

/** Records a compaction's summary on the stint, for the compaction row's expansion. */
export const postCompact = (core: CrewCore, member: CrewThreadMember, summary: string) =>
  core.store
    .updateStint(CREW_ID, member.handle, member.stint, (row) => ({
      ...row,
      lastCompactSummary: summary,
    }))
    .pipe(Effect.andThen(core.reload), Effect.andThen(core.changed), Effect.ignore);

/** `crew_show_on_dev` (CONCEPT §3.3): asks the person to show the crewmate's copy on its service. */
export const showOnDevTool = (
  core: CrewCore,
  member: CrewThreadMember,
  input: { readonly reason: string },
) => answered(showOnDev(core, member, input));

/** `crew_memory` (CONCEPT §3A): one operation on the crewmate's memory, tied to its open task. */
export const memoryTool = (core: CrewCore, member: CrewThreadMember, op: CrewMemoryOp) =>
  answered(
    Effect.gen(function* () {
      const tasks = yield* asRefusal(core.store.assignments(CREW_ID));
      const answer = yield* asRefusal(
        core.crewMemory.apply(member, op, openTaskOf(tasks, member.handle)?.assignment),
      );
      yield* core.changed;
      return answer;
    }),
  );

/** Tools of later phases: answered, never run. */
export const notYet = (tool: string) =>
  Effect.succeed(error(`${tool} is not available to this crew yet.`));
