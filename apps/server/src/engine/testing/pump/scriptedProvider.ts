/**
 * A scripted ProviderService for the engine's end-to-end tests: each of the six drivers answers
 * the engine's calls with the events, in the order, its adapter emits them (the bridge's scripted
 * cases cite the adapter lines), and the test plays the agent — it says something, calls a tool,
 * asks, finishes, crashes, hits a usage limit, starts a turn of its own.
 *
 * The events go out through the real SPI bus (`ProviderRuntimeEventBusLive`) over this service's
 * stream, so the engine reads exactly what it reads from real drivers. Every call the engine made
 * is in `calls`, in order.
 */
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import type {
  ProviderSession,
  ProviderRuntimeEvent,
  ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../../provider/Services/ProviderService.ts";
import { ProviderRuntimeEventBusLive } from "../../../spi/ProviderRuntimeEventBus.ts";
import type { BridgeDriver } from "../../bridge/spi3.ts";

const NOW = "2026-10-07T00:00:00.000Z";

/** Cursor, Grok and Antigravity hold the whole turn in their send: it returns at the turn's end. */
export const holdsTurn = (driver: BridgeDriver) =>
  driver === "cursor" || driver === "grok" || driver === "antigravity";

/** Claude and OpenCode take a message into the running turn. */
export const steers = (driver: BridgeDriver) => driver === "claudeAgent" || driver === "opencode";

export const NAMES: Record<BridgeDriver, string> = {
  claudeAgent: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  grok: "Grok",
  antigravity: "Antigravity",
};

interface Session {
  readonly thread: string;
  alive: boolean;
  open: string | null;
  turns: number;
  /** A held send's return (ACP): resolved at the turn's end, failed when the session dies. */
  held: Deferred.Deferred<void, Error> | null;
  readonly requests: Map<string, "approval" | "question">;
  model: string | undefined;
}

class ScriptedError extends Error {
  readonly _tag: string;
  constructor(tag: string, message: string) {
    super(message);
    this._tag = tag;
  }
}

export interface ScriptedProviderOptions {
  readonly driver: BridgeDriver;
  /** The next session start fails with these words. */
  failStart?: string | undefined;
  /** The agent never confirms a Stop: the interrupt returns and the turn runs on. */
  ignoreInterrupt?: boolean | undefined;
  /** The session start never returns; letting go of it is recorded as `let-go <thread>`. */
  startHangs?: boolean | undefined;
  /** The interrupt call never returns. */
  interruptHangs?: boolean | undefined;
  /** A send takes this long before the driver opens its turn and returns. */
  slowSendMs?: number | undefined;
  /** The next send never comes back: the driver holds it with nothing said. */
  holdNextSend?: boolean | undefined;
  /**
   * The next send meets a session that died under it: the old session's exit comes, then
   * ProviderService re-creates the session on its own and the send goes into it.
   */
  recoverOnNextSend?: boolean | undefined;
}

export const makeScriptedProvider = (options: ScriptedProviderOptions) =>
  Effect.gen(function* () {
    const driver = options.driver;
    const pubsub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<string, Session>();
    const calls: Array<string> = [];
    /** Each session start's input, as the engine asked it. */
    const starts: Array<unknown> = [];
    /** Each send's input, as the engine asked it. */
    const sends: Array<unknown> = [];
    let events = 0;
    let requests = 0;
    let items = 0;
    let tasks = 0;

    const emit = (type: string, thread: string, fields: Record<string, unknown> = {}) =>
      PubSub.publish(pubsub, {
        type,
        eventId: `e${++events}`,
        provider: driver,
        threadId: thread,
        createdAt: NOW,
        payload: {},
        ...fields,
      } as unknown as ProviderRuntimeEvent);

    const sessionOf = (thread: string) => {
      const session = sessions.get(thread);
      if (session === undefined || !session.alive) {
        return Effect.fail(
          new ScriptedError("ProviderAdapterSessionClosedError", "The session is closed."),
        );
      }
      return Effect.succeed(session);
    };

    const providerSession = (session: Session): ProviderSession =>
      ({
        provider: driver,
        status: session.open === null ? "ready" : "running",
        runtimeMode: "full-access",
        threadId: session.thread as ThreadId,
        resumeCursor: { thread: session.thread },
        ...(session.model === undefined ? {} : { model: session.model }),
        createdAt: NOW,
        updatedAt: NOW,
      }) as ProviderSession;

    /** The turn ends; a send that held it returns. */
    const endTurn = (session: Session, payload: Record<string, unknown>) =>
      Effect.gen(function* () {
        const open = session.open;
        if (open === null) return;
        session.open = null;
        yield* emit("turn.completed", session.thread, { turnId: open, payload });
        if (session.held !== null) {
          yield* Deferred.succeed(session.held, void 0);
          session.held = null;
        }
      });

    /** The session dies: a held send fails with these words. */
    const die = (session: Session, words: string) =>
      Effect.gen(function* () {
        session.alive = false;
        session.open = null;
        if (session.held !== null) {
          yield* Deferred.fail(
            session.held,
            new ScriptedError("ProviderAdapterProcessError", words),
          );
          session.held = null;
        }
      });

    const service: ProviderServiceShape = {
      startSession: (threadId, input) =>
        Effect.gen(function* () {
          calls.push(`start ${threadId}`);
          starts.push(input);
          if (options.failStart !== undefined) {
            const words = options.failStart;
            options.failStart = undefined;
            return yield* Effect.fail(new ScriptedError("ProviderAdapterProcessError", words));
          }
          if (options.startHangs === true) {
            return yield* Effect.never.pipe(
              Effect.onInterrupt(() => Effect.sync(() => calls.push(`let-go ${threadId}`))),
            );
          }
          const session: Session = {
            thread: threadId,
            alive: true,
            open: null,
            turns: sessions.get(threadId)?.turns ?? 0,
            held: null,
            requests: new Map(),
            model: input.modelSelection?.model,
          };
          sessions.set(threadId, session);
          yield* emit("session.started", threadId);
          return providerSession(session);
        }) as never,
      sendTurn: (input) =>
        Effect.gen(function* () {
          calls.push(`send ${input.threadId}: ${input.input ?? ""}`);
          sends.push(input);
          if (options.holdNextSend === true) {
            options.holdNextSend = false;
            return yield* Effect.never;
          }
          if (options.recoverOnNextSend === true) {
            options.recoverOnNextSend = false;
            yield* emit("session.exited", input.threadId, { payload: { exitKind: "error" } });
            yield* emit("session.started", input.threadId);
          }
          if (options.slowSendMs !== undefined) yield* Effect.sleep(options.slowSendMs);
          const session = yield* sessionOf(input.threadId);
          if (session.open !== null && steers(driver)) {
            return { threadId: input.threadId, turnId: session.open as TurnId };
          }
          session.turns += 1;
          const turnId = `T${session.turns}`;
          session.open = turnId;
          yield* emit("turn.started", session.thread, { turnId });
          if (holdsTurn(driver)) {
            const held = yield* Deferred.make<void, Error>();
            session.held = held;
            yield* Deferred.await(held);
          }
          return {
            threadId: input.threadId,
            turnId: turnId as TurnId,
          } satisfies ProviderTurnStartResult;
        }) as never,
      interruptTurn: (input) =>
        Effect.gen(function* () {
          calls.push(`interrupt ${input.threadId} ${input.turnId ?? ""}`);
          if (options.interruptHangs === true) return yield* Effect.never;
          const session = yield* sessionOf(input.threadId);
          const open = session.open;
          if (open === null || options.ignoreInterrupt === true) return;
          // Codex interrupts a named turn only: with none, turn/interrupt returns and does nothing.
          if (driver === "codex" && input.turnId === undefined) return;
          switch (driver) {
            case "claudeAgent":
              // A Stop kills the CLI: the turn ends interrupted and the session exits with it.
              yield* endTurn(session, { state: "interrupted", errorMessage: "Session stopped." });
              yield* die(session, "Session stopped.");
              yield* emit("session.exited", session.thread, { payload: { exitKind: "graceful" } });
              return;
            case "codex":
              return yield* endTurn(session, { state: "interrupted" });
            case "opencode":
              session.open = null;
              yield* emit("turn.aborted", session.thread, {
                turnId: open,
                payload: { reason: "Interrupted by user." },
              });
              return;
            default:
              return yield* endTurn(session, { state: "cancelled", stopReason: "cancelled" });
          }
        }) as never,
      respondToRequest: (input) =>
        Effect.gen(function* () {
          calls.push(`approve ${input.requestId} ${input.decision}`);
          const session = yield* sessionOf(input.threadId);
          if (!session.requests.delete(input.requestId)) {
            return yield* Effect.fail(
              new ScriptedError("ProviderAdapterRequestError", "No such request."),
            );
          }
          yield* emit("request.resolved", session.thread, {
            requestId: input.requestId,
            payload: { requestType: "command_execution_approval", decision: input.decision },
          });
        }) as never,
      respondToUserInput: (input) =>
        Effect.gen(function* () {
          const pictures = Object.entries(input.attachmentsByQuestionId ?? {}).flatMap(
            ([question, attached]) => attached.map((file) => `${question}: ${file.name}`),
          );
          calls.push(
            pictures.length === 0
              ? `answer ${input.requestId}`
              : `answer ${input.requestId} with ${pictures.join(", ")}`,
          );
          const session = yield* sessionOf(input.threadId);
          if (!session.requests.delete(input.requestId)) {
            return yield* Effect.fail(
              new ScriptedError("ProviderAdapterRequestError", "No such request."),
            );
          }
          yield* emit("user-input.resolved", session.thread, {
            requestId: input.requestId,
            payload: { answers: input.answers },
          });
        }) as never,
      stopSession: (input) =>
        Effect.gen(function* () {
          calls.push(`stop ${input.threadId}`);
          const session = sessions.get(input.threadId);
          if (session === undefined || !session.alive) return;
          if (driver === "claudeAgent") {
            yield* endTurn(session, { state: "interrupted", errorMessage: "Session stopped." });
            yield* die(session, "Session stopped.");
            yield* emit("session.exited", session.thread, { payload: { exitKind: "graceful" } });
            return;
          }
          yield* die(session, "Session stopped.");
        }) as never,
      listSessions: () =>
        Effect.sync(() =>
          [...sessions.values()].filter((session) => session.alive).map(providerSession),
        ),
      streamEvents: Stream.fromPubSub(pubsub),
      compactThread: () => Effect.die("not scripted"),
      // As the adapters declare them: Claude applies effort to a live session, the rest per turn.
      getCapabilities: () =>
        Effect.succeed({
          sessionModelSwitch: "in-session",
          ...(driver === "claudeAgent" ? { inSessionModelOptions: ["effort"] } : {}),
        }) as never,
      // An instance named `<driver>` or `<driver>:<name>` runs that driver; `<driver>:<name>~<key>`
      // resumes by `key` (default: the driver's).
      getInstanceInfo: (instanceId) => {
        const [named, key] = String(instanceId).split("~");
        const kind = named!.split(":")[0]!;
        return Object.hasOwn(NAMES, kind)
          ? (Effect.succeed({
              instanceId,
              driverKind: kind,
              displayName: undefined,
              enabled: true,
              continuationIdentity: { driverKind: kind, continuationKey: key ?? kind },
            }) as never)
          : (Effect.fail(
              new ScriptedError("ProviderUnsupportedError", "no such instance"),
            ) as never);
      },
      assertConversationRollbackSupported: () => Effect.die("not scripted"),
      rollbackConversation: () => Effect.die("not scripted"),
      uploadFeedback: () => Effect.die("not scripted"),
    };

    const live = (thread: string) => {
      const session = sessions.get(thread);
      if (session === undefined) throw new Error(`no session on ${thread}`);
      return session;
    };

    /** The agent, played by the test: each acts on the thread's session and its open turn. */
    const agent = {
      /** A reply in words: one text item, streamed in two parts. */
      say: (thread: string, text: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          const itemId = `m${++items}`;
          const turnId = session.open ?? undefined;
          const at = turnId === undefined ? {} : { turnId };
          yield* emit("item.started", thread, {
            ...at,
            itemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
          });
          const half = Math.ceil(text.length / 2);
          for (const delta of [text.slice(0, half), text.slice(half)]) {
            if (delta === "") continue;
            yield* emit("content.delta", thread, {
              ...at,
              itemId,
              payload: { streamKind: "assistant_text", delta },
            });
          }
          yield* emit("item.completed", thread, {
            ...at,
            itemId,
            payload: { itemType: "assistant_message", status: "completed" },
          });
        }),
      /** Text streamed into an item that stays open. */
      stream: (thread: string, itemId: string, delta: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          yield* emit("content.delta", thread, {
            ...(session.open === null ? {} : { turnId: session.open }),
            itemId,
            payload: { streamKind: "assistant_text", delta },
          });
        }),
      /** A command starts running (ACP calls first show as an update). */
      call: (thread: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          const itemId = `c${++items}`;
          yield* emit(holdsTurn(driver) ? "item.updated" : "item.started", thread, {
            turnId: session.open,
            itemId,
            payload: { itemType: "command_execution", status: "inProgress", title: "Command run" },
          });
          return itemId;
        }),
      /** The agent writes a file: a call that starts and completes with its own record. */
      write: (thread: string, path: string, content: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          const itemId = `c${++items}`;
          const payload = { itemType: "file_change", title: `Write ${path}` };
          yield* emit("item.started", thread, {
            turnId: session.open,
            itemId,
            payload: { ...payload, status: "inProgress" },
          });
          yield* emit("item.completed", thread, {
            turnId: session.open,
            itemId,
            payload: {
              ...payload,
              status: "completed",
              data: { toolName: "Write", input: { file_path: path, content } },
            },
          });
          return itemId;
        }),
      /**
       * The agent calls a Zerops tool, which returns `text` (Claude's shape of the call); `line`
       * is the input line Claude's adapter gives it.
       */
      zerops: (
        thread: string,
        tool: string,
        input: Record<string, unknown>,
        line: string,
        text: string,
      ) =>
        Effect.gen(function* () {
          const session = live(thread);
          const itemId = `c${++items}`;
          const toolName = `mcp__zerops__${tool}`;
          const payload = {
            itemType: "mcp_tool_call",
            title: "MCP tool call",
            detail: `${toolName}: ${line}`,
          };
          yield* emit("item.started", thread, {
            turnId: session.open,
            itemId,
            payload: { ...payload, status: "inProgress", data: { toolName, input } },
          });
          yield* emit("item.completed", thread, {
            turnId: session.open,
            itemId,
            payload: {
              ...payload,
              status: "completed",
              data: {
                toolName,
                input,
                result: { type: "tool_result", content: [{ type: "text", text }] },
              },
            },
          });
          return itemId;
        }),
      finish: (thread: string) => endTurn(live(thread), { state: "completed" }),
      /** The agent's process dies mid-turn, each driver as its adapter reports it. */
      crash: (thread: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          const words = `${NAMES[driver]} stopped unexpectedly.`;
          const turnId = session.open;
          switch (driver) {
            case "claudeAgent":
              yield* emit("runtime.error", thread, {
                turnId,
                payload: { message: words, class: "process_exit" },
              });
              yield* endTurn(session, { state: "failed", errorMessage: words });
              yield* die(session, words);
              yield* emit("session.exited", thread, { payload: { exitKind: "graceful" } });
              return;
            case "codex":
              yield* die(session, words);
              yield* emit("session.exited", thread);
              return;
            case "opencode":
              yield* emit("runtime.error", thread, {
                turnId,
                payload: { message: words, class: "process_exit" },
              });
              yield* die(session, words);
              yield* emit("session.exited", thread, { payload: { exitKind: "error" } });
              return;
            case "cursor":
            case "grok": {
              session.open = null;
              yield* emit("turn.completed", thread, {
                turnId,
                payload: { state: "failed", errorMessage: words, terminalReason: "process_exit" },
              });
              yield* emit("session.exited", thread, { payload: { exitKind: "error" } });
              yield* die(session, words);
              return;
            }
            case "antigravity":
              yield* emit("session.exited", thread, { payload: { exitKind: "error" } });
              yield* die(session, words);
              return;
          }
        }),
      /** The agent asks: an approval or a question (one asked by message, too). Returns its id. */
      ask: (thread: string, kind: "approval" | "question" | "message-question") =>
        Effect.gen(function* () {
          const session = live(thread);
          const requestId = `req-${++requests}`;
          session.requests.set(requestId, kind === "approval" ? "approval" : "question");
          if (kind === "approval") {
            yield* emit("request.opened", thread, {
              turnId: session.open,
              requestId,
              payload: { requestType: "command_execution_approval", detail: "rm -rf dist" },
            });
          } else {
            // A question asked by message (Codex's async one): the agent does not wait on it.
            yield* emit("user-input.requested", thread, {
              turnId: session.open,
              requestId,
              payload:
                kind === "message-question"
                  ? {
                      responseMode: "message",
                      questions: [
                        {
                          id: "0",
                          header: "Question",
                          question: "Which package manager?",
                          options: [],
                          allowCustomAnswer: true,
                          multiSelect: false,
                        },
                      ],
                    }
                  : { questions: [] },
            });
          }
          return requestId;
        }),
      /**
       * The usage window refuses: Claude parks the turn (a reset it believes, or none it can name);
       * the others end it, typed where their protocol can type it.
       */
      limit: (thread: string, resetsAt: string | null) =>
        Effect.gen(function* () {
          const session = live(thread);
          const words = `${NAMES[driver]} usage limit reached.`;
          if (driver === "claudeAgent") {
            yield* emit("account.rate-limits.updated", thread, {
              payload: {
                limits: { windows: [] },
                ...(resetsAt === null
                  ? { refused: true }
                  : { blocked: { window: "five_hour", resetsAt } }),
              },
            });
            return;
          }
          if (driver === "codex" || driver === "opencode") {
            yield* emit("runtime.error", thread, {
              turnId: session.open,
              payload: { message: words, class: "usage_limit" },
            });
          }
          yield* endTurn(session, {
            state: "failed",
            errorMessage: words,
            ...(driver === "cursor" || driver === "antigravity"
              ? {}
              : { terminalReason: "usage_limit" }),
          });
        }),
      /** Background work the agent starts in its turn (a shell). Returns its id. */
      startWork: (thread: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          const taskId = `t${++tasks}`;
          yield* emit("task.started", thread, {
            turnId: session.open,
            payload: { taskId, taskType: "local_bash", description: "Watch the build" },
          });
          return taskId;
        }),
      endWork: (thread: string, taskId: string) =>
        emit("task.completed", thread, { payload: { taskId, status: "completed" } }),
      /** Claude hands the model a background result in a turn it opens itself. */
      selfTurn: (thread: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          session.turns += 1;
          const turnId = `T${session.turns}`;
          session.open = turnId;
          yield* emit("turn.started", thread, {
            turnId,
            raw: {
              source: "claude.sdk.message",
              method: "claude/synthetic-turn-start",
              payload: {},
            },
          });
        }),
      /** ProviderService re-created the session on its own, as a call that met a dead one does. */
      recover: (thread: string) =>
        Effect.gen(function* () {
          const session = live(thread);
          session.alive = true;
          yield* emit("session.started", thread);
        }),
      /** A Codex helper's own thread: no conversation owns it. */
      foreign: (thread: string) => emit("turn.started", thread, { turnId: "X" }),
    };

    return { service, agent, calls, starts, sends, sessions, options };
  });

export type ScriptedProvider = Effect.Success<ReturnType<typeof makeScriptedProvider>>;

/** The scripted service and the real SPI bus over it. */
export const scriptedProviderLayer = (provider: ScriptedProvider) =>
  ProviderRuntimeEventBusLive.pipe(
    Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
  );
