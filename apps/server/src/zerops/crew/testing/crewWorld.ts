// @effect-diagnostics nodeBuiltinImport:off
/**
 * The crew's journeys: the `CrewWorld` port is every step a journey takes (a person presses, an
 * agent starts and ends its turn and calls its crew tools, the platform deploys, the server
 * restarts) and everything a journey reads back (the snapshot, what the crew sent into its
 * crewmates' conversations, as whom, and the tasks it holds).
 *
 * A journey is a list of phases, `crewJourney([...])`: each phase after the first is the same Mate
 * after a server restart. The journeys run on the engine world (`crewEngineWorld.ts`).
 *
 * @module crewWorld
 */

import {
  type ChatAttachment,
  type CrewCommand,
  type CrewCommandError,
  type CrewCommandResult,
  type CrewFiles,
  type CrewSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ThreadToolProfile } from "../../../spi/threadToolPolicy.ts";
import type { MateLogin } from "../../ZeropsLogins.ts";
import type { TurnPrincipal } from "../../ZeropsTurnAdmission.ts";
import type { MateUpdateDrain } from "../../../update/MateUpdateDrain.ts";
import { type CrewEngineService } from "../CrewEngine.ts";
import {
  type CrewMemoryOp,
  type CrewProposedTask,
  type CrewReportInput,
  type CrewReviewInput,
  type CrewSessionStart,
  type CrewThreadMember,
  type CrewToolText,
} from "../crewSeams.ts";
import { AS_CREW, CREW_ENGINE_TEST_TIMEOUT, eventually, KAREL } from "./crewEngineFixture.ts";
import { engineWorld } from "./crewEngineWorld.ts";

export { AS_CREW, CREW_ENGINE_TEST_TIMEOUT, eventually, KAREL };

// ─── The port ──────────────────────────────────────────────────────────────────────────────────

/**
 * A crewmate's conversation as the engine names it. A journey only ever gets one from the world (`firstTurn`, `sent`, the snapshot's
 * `currentThreadId`) and hands it back.
 */
export type CrewChat = string;

/** How a crewmate's turn ends, as its agent's provider reports it. */
export interface CrewTurnEnd {
  /** `completed` unless said. */
  readonly state?: "completed" | "interrupted" | "failed";
  /** The provider's own reason: `prompt_too_long`, `rapid_refill_breaker`, `api_error`, … */
  readonly reason?: string;
  /** What the conversation's session has spent so far, as the provider totals it. */
  readonly sessionCostUsd?: number;
}

/** What the crew sent into its crewmates' conversations, in order. */
export type CrewSent =
  /** A conversation opened for a crewmate: its `session`-th, in its copy (`null` for a reader). */
  | {
      readonly kind: "open";
      readonly chat: CrewChat;
      readonly handle: string;
      readonly session: number;
      readonly runtimeMode: string;
      readonly copy: string | null;
    }
  /** A turn started in a conversation: its words and pictures, on which login, as whom. */
  | {
      readonly kind: "turn";
      readonly chat: CrewChat;
      readonly text: string;
      readonly attachments: ReadonlyArray<ChatAttachment>;
      readonly instanceId: string | undefined;
      readonly runtimeMode: string;
    }
  | { readonly kind: "interrupt"; readonly chat: CrewChat }
  /** Its agent's session stopped. */
  | { readonly kind: "stop"; readonly chat: CrewChat }
  /** The conversation left the crewmate's chats. */
  | { readonly kind: "archive"; readonly chat: CrewChat }
  /** Its agent no longer resumes on its own when a usage window reopens. */
  | { readonly kind: "autoResume"; readonly chat: CrewChat; readonly enabled: boolean }
  /** A line in the conversation's chat between its turns: its words and its typed payload. */
  | {
      readonly kind: "seam";
      readonly chat: CrewChat;
      readonly words: string;
      readonly seam: unknown;
    }
  /** The conversation now runs in `path`; `expected` is the path a person's press saw. */
  | {
      readonly kind: "copy";
      readonly chat: CrewChat;
      readonly path: string | null | undefined;
      readonly expected: string | null | undefined;
    };

/** A step of the crew's own work a journey can stop at: `reached` once it waits there. */
export interface CrewHold {
  readonly reached: Effect.Effect<void>;
  readonly release: Effect.Effect<void>;
}

/**
 * Where a journey can hold the crew's work:
 * - `save`: a turn end's save of a crewmate's copy (the `wip(…): turn N` commit);
 * - `check`: the crewmate's check command (`test -f ok.txt` in the test crew home);
 * - `land`: a landing writing its commit onto your tree;
 * - `recover`: a deploy's end bringing the host's copies back, before it thaws;
 * - `sweep`: the boot's sweep of a copy's refs;
 * - `verdict`: the check's final read of the copy, after its command (`nth` such read);
 * - `send`: a turn on its way into a crewmate's conversation, before its agent gets it.
 */
export type CrewHoldStep =
  | { readonly step: "save" | "keep" | "check" | "land" | "recover" | "sweep" | "send" }
  | { readonly step: "verdict"; readonly nth: number };

/** A task as the crew holds it, not as a frame showed it. */
export interface CrewHeldTask {
  readonly id: string;
  readonly number: number;
  readonly state: string;
  readonly attempt: number;
  readonly reworks: number;
  readonly run: string | null;
  /** When it last moved, as the crew keeps it. */
  readonly movedAt: string;
}

/** One attempt of a task: its conversation, how it ended and what it spent. */
export interface CrewHeldAttempt {
  readonly attempt: number;
  readonly chat: CrewChat | null;
  readonly rotations: number;
  readonly ending: string | null;
  readonly endingDetail: string | null;
  readonly costUsd: number;
  readonly endedAt: string | null;
}

/** What a crewmate's conversation is set up with: its tool gate and its prompt's parts. */
export type CrewChatMember = Pick<
  CrewThreadMember,
  "handle" | "live" | "gate" | "prompt" | "maxBudgetUsd" | "model" | "effort"
>;

/** A conversation as the server held it when it went down. */
export interface CrewChatWas {
  /** Its turn was still running. */
  readonly running?: boolean;
  /** Where it ran: its copy, a path a person chose, or nowhere recorded. */
  readonly worktreePath?: string | null;
}

/**
 * A crewmate's sessions: the sessions of the engine's one conversation, each begun for a reason in
 * the crew's words.
 */
export interface CrewSessionsSeen {
  /** Sessions its conversation has had; a rotation adds one. */
  readonly count: number;
  /**
   * The latest: `active` once its agent's session started, `rotate-pending` while a rotation waits
   * for its next task, `open` otherwise.
   */
  readonly latest: "open" | "active" | "rotate-pending";
  /** Why each began, oldest first, in the crew's words; `null` for the first. */
  readonly reasons: ReadonlyArray<string | null>;
}

export interface CrewWorld {
  /** The service repository the crew works in: your tree; `backend`'s copy is `.crew/backend`. */
  readonly root: string;
  /** The Mate's workspace (the container's `/var/www`): the crew home lives here. */
  readonly workspace: string;
  /**
   * A ref the crew writes in the service repository on its own, beside a crewmate's open task: the
   * task's landing anchor.
   */
  readonly ownRef: Effect.Effect<string>;
  /** Where the server stores a chat's pictures and files. */
  readonly attachmentsDir: string;
  /** Writes the crew home's files: one writer `backend` on the test service, and `files` over it. */
  readonly writeHome: (files?: Readonly<Record<string, string>>) => void;

  // A person.
  /** A press of the person's, as `KAREL` unless said. */
  readonly press: (
    input: CrewCommand,
    as?: TurnPrincipal,
  ) => Effect.Effect<CrewCommandResult, CrewCommandError>;
  /** Opens the crew home's files. */
  readonly readFiles: Effect.Effect<CrewFiles, CrewCommandError>;

  // The server.
  /** The server finishes starting: it may send turns now. */
  readonly serverReady: Effect.Effect<void>;

  // A crewmate's agent, in its conversation; each step returns once the crew has taken it in.
  readonly turnStarts: (chat: CrewChat) => Effect.Effect<void>;
  readonly turnEnds: (chat: CrewChat, end?: CrewTurnEnd) => Effect.Effect<void>;
  /** The provider delivers the conversation's latest turn end again, as after a reconnect. */
  readonly turnEndRedelivered: (chat: CrewChat) => Effect.Effect<void>;
  /** The agent's answer in its turn. */
  readonly says: (chat: CrewChat, text: string) => Effect.Effect<void>;
  /** The agent's conversation compacted its context. */
  readonly compacted: (chat: CrewChat) => Effect.Effect<void>;
  readonly report: (chat: CrewChat, input: CrewReportInput) => Effect.Effect<CrewToolText>;
  readonly showOnDev: (
    chat: CrewChat,
    input: { readonly reason: string },
  ) => Effect.Effect<CrewToolText>;
  readonly propose: (
    chat: CrewChat,
    tasks: ReadonlyArray<CrewProposedTask>,
  ) => Effect.Effect<CrewToolText>;
  readonly review: (chat: CrewChat, input: CrewReviewInput) => Effect.Effect<CrewToolText>;
  readonly finish: (
    chat: CrewChat,
    input: { readonly summary: string },
  ) => Effect.Effect<CrewToolText>;
  readonly memory: (chat: CrewChat, op: CrewMemoryOp) => Effect.Effect<CrewToolText>;
  /** The agent's session starts (or resumes, or compacted): what the crew adds to its context. */
  readonly sessionStart: (
    chat: CrewChat,
    event: CrewSessionStart,
  ) => Effect.Effect<string | undefined>;

  // The Mate's own conversation, the platform and the logins.
  /** A turn of the Mate's own runs (or no longer does): a landing waits for it. */
  readonly mateTurnRunning: (running: boolean) => Effect.Effect<void>;
  /**
   * The Mate deploys onto the test service with `zerops_deploy`: its call `started` (opened with
   * `item.started` as Claude and Codex do, or `item.updated` as the ACP agents do) or `finished`.
   */
  readonly deploy: (
    phase: "started" | "finished",
    options?: { readonly opens?: "item.started" | "item.updated" },
  ) => Effect.Effect<void>;
  /** The project's processes as the platform lists them; `unreadable` fails the read. */
  readonly deployState: (processes: ReadonlyArray<unknown> | "unreadable") => Effect.Effect<void>;
  /** A usage window of the Mate's agent stands at `usedPercent`. */
  readonly usage: (usedPercent: number) => Effect.Effect<void>;
  /** A login is signed in afresh: a default agent's, or an extra login's by id. */
  readonly signedIn: (
    login: "claude-code" | "codex" | { readonly extra: string },
  ) => Effect.Effect<void>;
  /** Admission refuses every turn with these words while set. */
  readonly refuseTurns: (words: string | undefined) => Effect.Effect<void>;
  /** Logins beyond the defaults, by id. */
  readonly logins: (logins: ReadonlyMap<string, MateLogin>) => Effect.Effect<void>;
  /** Logins whose agent is not live yet. */
  readonly agentsNotLive: (instanceIds: ReadonlySet<string>) => Effect.Effect<void>;
  /** How a crewmate's conversation stood when the server went down (set before a restart). */
  readonly chatWas: (chat: CrewChat, was: CrewChatWas) => Effect.Effect<void>;
  /** The task last moved at `at`: it has waited since, as far as the crew can tell. */
  readonly taskLastMovedAt: (taskId: string, at: string) => Effect.Effect<void>;
  /** Holds the crew's next such step before it runs. */
  readonly hold: (step: CrewHoldStep) => Effect.Effect<CrewHold>;

  // What a journey reads back.
  readonly snapshot: Effect.Effect<CrewSnapshot>;
  /** The first snapshot `check` holds for, the current one included; it waits on the crew. */
  readonly snapshotWhere: (
    check: (snapshot: CrewSnapshot) => boolean,
  ) => Effect.Effect<CrewSnapshot>;
  /** The crew feed: the current frame at once, then one per change. */
  readonly frames: Stream.Stream<CrewSnapshot>;
  readonly sent: Effect.Effect<ReadonlyArray<CrewSent>>;
  /** A crewmate's sessions once `check` holds for them; it waits on the crew. */
  readonly sessionsWhere: (
    handle: string,
    check: (sessions: CrewSessionsSeen) => boolean,
  ) => Effect.Effect<CrewSessionsSeen>;
  /** As whom each turn the crew started (or tried to) was asked to run, in order. */
  readonly admissions: Effect.Effect<ReadonlyArray<TurnPrincipal>>;
  readonly tasks: Effect.Effect<ReadonlyArray<CrewHeldTask>>;
  readonly attempts: (taskId: string) => Effect.Effect<ReadonlyArray<CrewHeldAttempt>>;
  /** The crew log's entries of these kinds: what the crew did, for triage. */
  readonly log: (
    kinds: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>>;
  readonly member: (chat: CrewChat) => Effect.Effect<Option.Option<CrewChatMember>>;
  /** The tool profile an agent of the Claude login gets in this conversation, if any. */
  readonly toolProfile: (chat: CrewChat) => Effect.Effect<ThreadToolProfile | undefined>;
  /** Whether the crew's tool profiles are in force at all. */
  readonly toolProfilesInstalled: Effect.Effect<boolean>;
  /** How many times the crew set up its tool profiles. */
  readonly profileInstalls: Effect.Effect<number>;
  /** The crew's service as the server serves it, for its RPCs. */
  readonly service: Effect.Effect<CrewEngineService>;
  /** All already-recorded crew work has produced its durable receipts. */
  readonly settled: Effect.Effect<void>;
  /** Accepted sign-in inputs, including inputs that leave the crew unchanged. */
  readonly signInReconciliations: Effect.Effect<number>;
  /** The engine's injected wall clock, including time advanced by the journey. */
  readonly currentTimeMillis: Effect.Effect<number>;
  readonly advanceTime: (millis: number) => Effect.Effect<void>;
  /** The Mate engine's own update drain. */
  readonly engineUpdateDrain: Effect.Effect<MateUpdateDrain | undefined>;
  /** How many sessions the crew opened on its services (git and shell). */
  readonly serviceSessions: Effect.Effect<number>;
  /** How many times the crew read the platform's deploy state. */
  readonly deployReads: Effect.Effect<number>;
}

/** One phase of a journey: the Mate from a (re)start to the next. */
export type CrewPhase<E> = (world: CrewWorld) => Effect.Effect<void, E>;

export interface CrewJourneyOptions {
  /**
   * The crew's tool profiles are put in force as the server does (`toolProfile` reads them);
   * otherwise a world only counts their setups.
   */
  readonly toolProfiles?: boolean;
}

/**
 * Plays a journey's phases on a world. A journey's own failure and its world's (its database, its
 * migrations) are both the test's failure, so the runner dies with either.
 */
export type CrewWorldRunner = <E>(
  phases: ReadonlyArray<CrewPhase<E>>,
  options: CrewJourneyOptions,
) => Effect.Effect<void>;

/**
 * Plays a journey on the engine world: one phase, or several with a server restart between each two.
 */
export const crewJourney = <E>(
  phases: CrewPhase<E> | ReadonlyArray<CrewPhase<E>>,
  options: CrewJourneyOptions = {},
): Effect.Effect<void> => engineWorld(typeof phases === "function" ? [phases] : phases, options);

// ─── Steps over the port ───────────────────────────────────────────────────────────────────────

/** What the crew sent of one kind. */
export const sentKind = <K extends CrewSent["kind"]>(world: CrewWorld, kind: K) =>
  Effect.map(world.sent, (all) =>
    all.filter((entry): entry is Extract<CrewSent, { readonly kind: K }> => entry.kind === kind),
  );

/** Every turn the crew started. */
export const turnsSent = (world: CrewWorld) => sentKind(world, "turn");

/** Every conversation the crew opened. */
export const opened = (world: CrewWorld) => sentKind(world, "open");

/** The seam lines the crew wrote into crewmates' chats: conversation, words, payload. */
export const seamsOf = (world: CrewWorld) =>
  Effect.map(sentKind(world, "seam"), (all) =>
    all.map((entry) => [entry.chat, entry.words, entry.seam] as const),
  );

/** As whom the crew's latest turn was asked to run. */
export const lastAdmitted = (world: CrewWorld) => Effect.map(world.admissions, (all) => all.at(-1));

export const everyCopyReady = (snapshot: CrewSnapshot) =>
  snapshot.status === "applied" &&
  snapshot.crewmates.every((mate) => mate.readOnly || mate.lane?.state === "ready");

/** Applies the crew home and waits until every copy is ready. */
export const applied = (world: CrewWorld) =>
  Effect.gen(function* () {
    world.writeHome();
    yield* world.press({ _tag: "apply" });
    yield* world.snapshotWhere(everyCopyReady);
  });

/** A press once the crewmate's copy is free: the boot's own work may hold it a moment. */
export const pressWhenFree = (world: CrewWorld, input: CrewCommand) =>
  eventually(
    world.press(input).pipe(
      Effect.as(true),
      Effect.catchTags({
        CrewCommandError: (error) =>
          error.detail?.includes("is busy") === true ? Effect.succeed(false) : Effect.fail(error),
      }),
    ),
  );

/** A press tried until the crew takes it. */
export const pressUntilTaken = (world: CrewWorld, input: CrewCommand) =>
  eventually(
    world.press(input).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    ),
  );

/** The conversation the crew opened for `handle`. */
export const chatOf = (world: CrewWorld, handle = "backend") =>
  Effect.map(opened(world), (all) => all.find((entry) => entry.handle === handle)?.chat);

/** Opens a task with a message and starts its first turn, with `edit` made in the copy. */
export const firstTurn = (world: CrewWorld, edit: () => void) =>
  Effect.gen(function* () {
    yield* world.press({
      _tag: "message",
      handle: "backend",
      text: "Change a.txt",
      attachments: [],
    });
    const chat = yield* chatOf(world);
    if (chat === undefined) return yield* Effect.die("the message opened no conversation");
    yield* world.turnStarts(chat);
    edit();
    return chat;
  });

/** The crewmate in `chat` calls `crew_report(done)`. */
export const reportDone = (world: CrewWorld, chat: CrewChat) =>
  world.report(chat, { status: "done", summary: "Done." });
