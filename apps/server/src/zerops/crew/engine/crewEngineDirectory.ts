// @effect-diagnostics nodeBuiltinImport:off - the gate resolves a tool's path by its real path, synchronously.
/**
 * The seam's two sides on the engine (`crewSeams.ts`): who a provider thread is
 * (`CrewThreadDirectory`) and what a crew tool does (`CrewToolHost`), answered from the crew
 * owner's state.
 *
 * - **A thread** is the engine's `<conversation>/s/<n>`: the crewmate whose one conversation it is,
 *   live while `n` is the session generation its conversation runs on now and the crewmate is
 *   still on the crew; an older generation gets the deny-all profile.
 * - **A tool** is a command to the crew owner under the crewmate's running run, its reply the
 *   model's answer; a refusal is an `isError` answer in the crew's words. Memory runs on the
 *   crewmate's records, written one change at a time through the owner.
 *
 * @module crew/engine/crewEngineDirectory
 */
import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type ConversationId,
  type CrewCommandError,
  type Principal,
  type ThreadId,
} from "@t3tools/contracts";

import { conversationOfThread } from "../../../engine/pump/TurnPump.ts";
import type { ProviderInstanceAgent } from "../../../spi/providerInstances.ts";
import type { ZeropsRepository } from "../../ZeropsRepositorySource.ts";
import { crewLane } from "../CrewDefinition.ts";
import { CREW_ID } from "../CrewHome.ts";
import type { CrewMemoryService, CrewMemoryTask } from "../CrewMemory.ts";
import { crewRefusedRoots, type GateContext, type GateTurn } from "../CrewPolicy.ts";
import type { CrewPromptMember } from "../crewPrompt.ts";
import type { CrewReadsService } from "../CrewReads.ts";
import type {
  CrewSessionStart,
  CrewThreadMember,
  CrewToolHost,
  CrewToolText,
} from "../crewSeams.ts";
import {
  CREW_CONTEXT_DEFAULT,
  CREW_PAYLOAD_TIMEOUT_SECONDS,
  realpathOrNearest,
} from "../crewDirectory.ts";
import type { CrewInput, CrewToolCall } from "./command.ts";
import type { CrewAccepted } from "./CrewOwner.ts";
import {
  isOpenTask,
  membersInOrder,
  openTaskOf,
  sessionBudgetUsd,
  tasksInOrder,
  type CrewState,
  type MemberRecord,
} from "./state.ts";

export interface EngineCrewDirectoryInputs {
  readonly state: Effect.Effect<CrewState>;
  /** The session generation a conversation runs on now. */
  readonly generation: (conversationId: ConversationId) => Effect.Effect<number | undefined>;
  /** A host's verified repository; none until the crew verified it. */
  readonly repositoryOf: (host: string) => Effect.Effect<Option.Option<ZeropsRepository>>;
  readonly agentOf: (login: string) => Effect.Effect<ProviderInstanceAgent | undefined>;
  /** The Mate's tree: where readers and the lead work, and relative paths resolve. */
  readonly workspaceRoot: string;
  /** Tells the crew owner one input as `principal`. */
  readonly ask: (
    input: CrewInput,
    principal: Principal,
  ) => Effect.Effect<CrewAccepted, CrewCommandError>;
  readonly memory: CrewMemoryService;
  readonly reads: Pick<CrewReadsService, "diff">;
}

const THREAD_GENERATION = /\/s\/(\d+)$/u;

const generationOfThread = (thread: string): number | undefined => {
  const match = THREAD_GENERATION.exec(thread);
  return match === null ? undefined : Number(match[1]);
};

/** The shaped turn a crewmate's running run is: a claim's start or release, else its work. */
const turnOf = (member: MemberRecord): GateTurn =>
  member.active?.purpose === "claim-start" || member.active?.purpose === "claim-release"
    ? member.active.purpose
    : "work";

const text = (value: string): CrewToolText => ({ text: value, isError: false });
const error = (value: string): CrewToolText => ({ text: value, isError: true });

export const makeEngineCrewDirectory = (inputs: EngineCrewDirectoryInputs) => {
  const memberOfConversation = (state: CrewState, conversationId: string) =>
    membersInOrder(state).find((member) => member.conversationId === conversationId);

  const gateFor = (
    state: CrewState,
    member: MemberRecord,
  ): Effect.Effect<{ readonly gate: GateContext; readonly prompt: CrewPromptMember } | undefined> =>
    Effect.gen(function* () {
      const definition = state.applied?.definition;
      const spec = definition?.members.find((entry) => entry.handle === member.handle);
      if (definition === undefined || spec === undefined) return undefined;
      const claim = member.host === null ? undefined : state.claims[member.host];
      const turn = turnOf(member);
      const base = {
        foreignMigrations: definition.members
          .filter(
            (other) =>
              other.handle !== member.handle &&
              other.kind === "writer" &&
              other.host === member.host,
          )
          .flatMap((other) => other.migrations),
        refusedRoots: crewRefusedRoots({
          workspaceRoot: inputs.workspaceRoot,
          home: NodeOS.homedir(),
        }),
        realpath: realpathOrNearest,
        workspaceRoot: inputs.workspaceRoot,
        turn,
        holdsClaim:
          claim !== undefined &&
          claim.handle === member.handle &&
          (claim.state === "starting" || claim.state === "held" || claim.state === "releasing"),
        ...(turn !== "work" && claim?.devServer != null ? { devServer: claim.devServer } : {}),
        payloadTimeoutSeconds: CREW_PAYLOAD_TIMEOUT_SECONDS,
      } as const;
      if (member.kind !== "writer") {
        return {
          gate: {
            kind: "live",
            member: { handle: member.handle, kind: member.kind, env: spec.env },
            ...base,
          },
          prompt: { handle: member.handle, kind: member.kind },
        };
      }
      const repository =
        member.host === null ? Option.none() : yield* inputs.repositoryOf(member.host);
      if (Option.isNone(repository)) return undefined;
      const lane = crewLane(repository.value, member.handle);
      return {
        gate: {
          kind: "live",
          member: {
            handle: member.handle,
            kind: "writer",
            lane,
            ...(member.crewPort === null ? {} : { crewPort: member.crewPort }),
            env: spec.env,
          },
          ...base,
          workspaceRoot: lane.mountDir,
        },
        prompt: { handle: member.handle, kind: "writer", lane },
      };
    });

  const memberFor = (threadId: ThreadId) =>
    Effect.gen(function* (): Effect.fn.Return<Option.Option<CrewThreadMember>> {
      const conversationId = conversationOfThread(threadId);
      const generation = generationOfThread(threadId);
      if (conversationId === undefined || generation === undefined) return Option.none();
      const state = yield* inputs.state;
      const member = memberOfConversation(state, conversationId);
      const applied = state.applied;
      const spec = applied?.definition.members.find((entry) => entry.handle === member?.handle);
      if (member === undefined || applied === null || spec === undefined) return Option.none();
      const agent = yield* inputs.agentOf(member.login);
      const hostsCrewTools = agent?.threadProfile?.tools === true;
      const current = (yield* inputs.generation(conversationId)) ?? 1;
      const shaped = generation === current ? yield* gateFor(state, member) : undefined;
      const budget = sessionBudgetUsd(state);
      return Option.some({
        crew: CREW_ID,
        handle: member.handle,
        kind: member.kind,
        stint: generation,
        live: shaped !== undefined,
        gate: shaped?.gate ?? { kind: "deny-all" },
        prompt: {
          member: shaped?.prompt ?? {
            handle: member.handle,
            kind: member.kind === "lead" ? "lead" : "reader",
          },
          brief: applied.definition.brief,
          briefVersion: applied.briefVersion,
          job: spec.job,
          jobVersion: member.jobVersion,
          memory: hostsCrewTools,
          crewTools: hostsCrewTools,
        },
        contextWindow: spec.context ?? CREW_CONTEXT_DEFAULT,
        ...(budget === null ? {} : { maxBudgetUsd: budget }),
        ...(member.model === null ? {} : { model: member.model }),
        ...(member.effort === null ? {} : { effort: member.effort }),
      });
    });

  /** A tool call from the crewmate's running run, under that run's principal. */
  const tool = (member: CrewThreadMember, call: CrewToolCall) =>
    Effect.gen(function* () {
      const state = yield* inputs.state;
      const record = state.members[member.handle];
      const principal: Principal = record?.active?.principal ?? { kind: "engine" };
      const accepted = yield* inputs.ask(
        { _tag: "Tool", handle: member.handle, runId: record?.active?.runId ?? null, call },
        principal,
      );
      return accepted.reply ?? text("Noted.");
    }).pipe(Effect.catch((refusal) => Effect.succeed(error(refusal.detail ?? refusal.message))));

  /** The crewmate's open task as its state packet states it. */
  const memoryTask = (state: CrewState, handle: string): CrewMemoryTask | undefined => {
    const task = openTaskOf(state, handle);
    if (task === undefined) return undefined;
    const lastLine = task.check?.output.trimEnd().split("\n").at(-1)?.trim();
    return {
      assignment: task.id,
      number: task.number,
      title: task.title,
      brief: task.card.brief,
      doneWhen: task.card.doneWhen,
      state: task.state,
      attempt: task.counters.attempt,
      dispatchCommit: "",
      ...(task.check === null
        ? {}
        : { lastCheck: lastLine ? `${task.check.state}: ${lastLine}` : task.check.state }),
      resets: [],
    };
  };

  const sessionStart = (member: CrewThreadMember, event: CrewSessionStart) =>
    Effect.gen(function* () {
      if (!member.prompt.memory) return undefined;
      const task = memoryTask(yield* inputs.state, member.handle);
      return yield* (
        event.source === "resume"
          ? inputs.memory.delta(member, task)
          : inputs.memory.packet(member, task)
      ).pipe(Effect.orElseSucceed(() => undefined));
    });

  const board = Effect.gen(function* () {
    const state = yield* inputs.state;
    const applied = state.applied;
    if (applied === null) return error("No crew is applied.");
    const roster = membersInOrder(state).map((member) => {
      const open = openTaskOf(state, member.handle);
      return (
        `- @${member.handle} (${member.displayName}), ${member.kind}` +
        `${member.host === null ? "" : ` on ${member.host}`}` +
        `${member.jobFirstLine === "" ? "" : ` — ${member.jobFirstLine}`}` +
        `${open === undefined ? "" : ` — on #${open.number} ${open.title}`}`
      );
    });
    const tasks = tasksInOrder(state)
      .filter((task) => task.state !== "discarded")
      .map((task) => {
        const done = task.card.doneWhen.trim();
        return `- #${task.number} ${task.title} — @${task.owner} — ${task.state}${done === "" ? "" : ` — done when: ${done}`}`;
      });
    return text(
      [
        `Crew ${applied.definition.name} — brief v${applied.briefVersion}: ${applied.definition.brief.title}`,
        "",
        "Crewmates:",
        ...roster,
        "",
        "Tasks:",
        ...(tasks.length === 0 ? ["- none yet"] : tasks),
      ].join("\n"),
    );
  });

  const toolHost: CrewToolHost["Service"] = {
    report: (member, input) =>
      Effect.gen(function* () {
        if (input.lessons !== undefined && input.lessons.length > 0) {
          const state = yield* inputs.state;
          const open = openTaskOf(state, member.handle);
          yield* inputs.memory.recordLessons(member, input.lessons, open?.id).pipe(Effect.ignore);
        }
        return yield* tool(member, { tool: "report", input });
      }),
    board: () => board,
    diff: (member, input) =>
      Effect.gen(function* () {
        const state = yield* inputs.state;
        const handle = input.handle ?? member.handle;
        const target = state.members[handle];
        if (target === undefined) return error(`There is no @${handle} on the crew.`);
        if (target.host === null) return error(`@${handle} has no copy of the code.`);
        const changes = yield* inputs.reads.diff(target.host, handle, input.path);
        return text(
          changes.trim() === "" ? `@${handle} has no changes against your tree.` : changes,
        );
      }).pipe(Effect.catch((failure) => Effect.succeed(error(failure.message)))),
    showOnDev: (member, input) => tool(member, { tool: "show-on-dev", reason: input.reason }),
    propose: (member, plan) => tool(member, { tool: "propose", plan }),
    review: (member, input) => tool(member, { tool: "review", input }),
    finish: (member) => tool(member, { tool: "finish" }),
    memory: (member, op) =>
      Effect.gen(function* () {
        const state = yield* inputs.state;
        const open = openTaskOf(state, member.handle);
        return yield* inputs.memory.apply(
          member,
          op,
          open !== undefined && isOpenTask(open.state) ? open.id : undefined,
        );
      }).pipe(Effect.catch((failure) => Effect.succeed(error(failure.message)))),
    sessionStart,
    postCompact: () => Effect.void,
  };

  /**
   * The state packet a crewmate's new session starts from (a rotation's seed): its memory, its
   * open task and its copy's ground; none for a crewmate that keeps no memory.
   */
  const sessionPacket = (handle: string) =>
    Effect.gen(function* () {
      const state = yield* inputs.state;
      const member = state.members[handle];
      if (member === undefined) return null;
      const memberOf = yield* memberFor(`${member.conversationId}/s/0` as ThreadId);
      if (Option.isNone(memberOf) || !memberOf.value.prompt.memory) return null;
      return yield* inputs.memory
        .packet(memberOf.value, memoryTask(state, handle))
        .pipe(Effect.orElseSucceed(() => null));
    });

  return {
    directory: { memberFor },
    sessionPacket,
    toolHost,
    /** The member a crewmate's conversation belongs to, for its workspace. */
    memberOfConversation,
  };
};
