/**
 * Server-driven agent login sessions (S7 follow-up F8).
 *
 * The `ZeropsAgentAuthCard`'s "Sign in" button used to type the login
 * command straight into the user's own terminal and leave everything else
 * to the user reading the CLI's own output. This module replaces that: the
 * SERVER opens a dedicated terminal, writes the login command, and walks
 * the CLI's output itself — the same job the Zerops GUI's own
 * `zcp-agent-auth-dialog` walker does, ported to run here instead of in a
 * browser tab (`zeropsAgentLoginOutputParser.ts` / `zeropsAgentLoginWalker.ts`
 * / `zeropsAgentLoginHandlers.ts`). The client never types into the login
 * terminal on the user's behalf, and the server never sees a pasted auth
 * code as a field — once the CLI shows its "paste code here" prompt, the
 * user pastes directly into the terminal pane.
 *
 * Each agent gets at most one active session at a time (`start` on an agent
 * with a session already running just re-attaches to it — same
 * `{terminalId}`, no second command spawned into the same shell). A finished
 * session (`succeeded` / `failed` / `cancelled`) is removed from the active
 * set, so a later `start` opens a fresh one.
 *
 * ## Fiber lifecycle — a deliberate simplification
 *
 * Every active session forks one small `Stream.debounce`-driven "stall
 * timer" fiber (`Effect.forkDetach`) that presses Enter through an
 * unrecognized TUI screen after a second of silence, mirroring the GUI
 * walker's own `setTimeout`/`clearTimeout` stall timer. This codebase has a
 * documented scheduler issue in this pinned Effect build around
 * INTERRUPTING a `Stream.debounce`-driven fiber via a scope close or a
 * racing second fiber (`ZeropsAgentAuth.ts`'s own header comments). Rather
 * than risk that class of bug, a session's stall fiber is never explicitly
 * interrupted — `dispose` only removes the session from the active map and
 * unsubscribes its terminal-output listener. The stall fiber keeps running
 * in the background, but checks the session's identity `token` before
 * every action and becomes permanently inert once that token no longer
 * matches the active session (a fresh `start` for the same agent, or none
 * at all). For a user-initiated, occasional flow like signing in, the tiny
 * amount of retained memory across a very long server lifetime is an
 * accepted trade-off against a scheduler crash.
 */
import type {
  TerminalAttachInput,
  TerminalCloseInput,
  TerminalError,
  TerminalOpenInput,
  TerminalWriteInput,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";
import { ZEROPS_AGENT_LOGIN_COMMANDS, ZeropsAgentLoginError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { TerminalManager } from "../terminal/Manager.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentAuthorizers from "./ZeropsAgentAuthorizers.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZEROPS_AGENT_LOGIN_HANDLERS } from "./zeropsAgentLoginHandlers.ts";
import { stallLoginAction, stepLoginOutput } from "./zeropsAgentLoginWalker.ts";

/** How long a burst of terminal output coalesces into one stall countdown — mirrors the GUI walker's `STALL_TIMEOUT_MS`. */
const STALL_TIMEOUT_MS = 1000;
/** Keeps a pathological non-terminating stream from growing the buffer without bound. */
const MAX_BUFFER_LENGTH = 8000;
const BUFFER_TRIM_KEEP = 4000;

/** The sshfs-mounted project root every mate terminal defaults to — matches `AGENT_LOGIN_CWD` in the web's (now-deleted) direct-typing path. */
const AGENT_LOGIN_CWD = "/var/www";

/** Deterministic per-agent terminal id, distinct from the user's own `term-1` primary shell. */
export const loginTerminalId = (agentId: ZeropsAgentId): string => `agent-login-${agentId}`;

export type ZeropsAgentLoginByAgent = Readonly<
  Record<ZeropsAgentId, ZeropsAgentLoginState | undefined>
>;

const EMPTY_LOGIN_BY_AGENT: ZeropsAgentLoginByAgent = {
  "claude-code": undefined,
  codex: undefined,
};

/**
 * Projects a `login` field onto each row of `snapshot` from `logins` — the
 * pure half of the merge `ws.ts` performs to combine `ZeropsAgentAuth`'s
 * feed with this module's, so the client keeps reading one
 * `subscribeZeropsAgentAuth` stream.
 */
export const mergeAgentAuthLogin = (
  snapshot: ZeropsAgentAuthSnapshot,
  logins: ZeropsAgentLoginByAgent,
): ZeropsAgentAuthSnapshot => ({
  ...snapshot,
  agents: snapshot.agents.map((agent) => ({ ...agent, login: logins[agent.agentId] })),
});

/**
 * Field-by-field equality for one agent's login state (S7 fix2 finding 2) —
 * every field the wire type carries: `phase`, `url`, `code`, `message`,
 * `terminalId`, `startedAt`. Mirrors `ZeropsAgentAuth.ts`'s own
 * `snapshotsEqual`/`agentAuthEqual` dedup pattern.
 */
export const loginStateEqual = (a: ZeropsAgentLoginState, b: ZeropsAgentLoginState): boolean =>
  a.phase === b.phase &&
  a.url === b.url &&
  a.code === b.code &&
  a.message === b.message &&
  a.terminalId === b.terminalId &&
  DateTime.Equivalence(a.startedAt, b.startedAt);

export class ZeropsAgentLogin extends Context.Service<
  ZeropsAgentLogin,
  {
    readonly latest: Effect.Effect<ZeropsAgentLoginByAgent>;
    readonly changes: Stream.Stream<ZeropsAgentLoginByAgent>;
    readonly subscribe: Effect.Effect<
      {
        readonly latest: ZeropsAgentLoginByAgent;
        readonly changes: Stream.Stream<ZeropsAgentLoginByAgent>;
      },
      never,
      Scope.Scope
    >;
    readonly start: (
      agentId: ZeropsAgentId,
      threadId: string,
      /**
       * The Zerops user id of the session driving this login, taken from the
       * authenticated session — never from the client's input, which could
       * name anyone. Recorded against the agent when the login succeeds so
       * mate can say whose subscription a turn spends (`agentOwnership.ts`).
       */
      subject: string,
    ) => Effect.Effect<{ readonly terminalId: string }, TerminalError | ZeropsAgentLoginError>;
    readonly cancel: (
      agentId: ZeropsAgentId,
    ) => Effect.Effect<void, TerminalError | ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsAgentLogin") {}

export interface ZeropsAgentLoginOptions {
  readonly terminalManager: Pick<
    TerminalManager["Service"],
    "open" | "write" | "attachStream" | "close"
  >;
  readonly zeropsAgentAuth: Pick<ZeropsAgentAuth["Service"], "recheckNow">;
  readonly isZeropsEnvironment: boolean;
  /**
   * Records who signed this agent in, once the login has actually succeeded.
   * Injected so this module stays testable without a filesystem; absent means
   * provenance is simply not recorded.
   */
  readonly recordAuthorizer?: (agentId: ZeropsAgentId, subject: string) => Effect.Effect<void>;
}

interface FeedState {
  readonly logins: ZeropsAgentLoginByAgent;
}

interface ActiveSession {
  readonly threadId: string;
  readonly terminalId: string;
  /** Identity marker — every deferred/background action checks this against the CURRENT map entry before acting (see the module header). */
  readonly token: symbol;
  readonly bufferRef: Ref.Ref<string>;
  readonly stallQueue: Queue.Queue<void>;
  readonly unsubscribeOutput: () => void;
  /** Who started this login — recorded if it succeeds. */
  readonly subject: string;
}

const appendAndTrim = (buffer: string, chunk: string): string => {
  const next = buffer + chunk;
  return next.length > MAX_BUFFER_LENGTH ? next.slice(-BUFFER_TRIM_KEEP) : next;
};

export const make = (options: ZeropsAgentLoginOptions) =>
  Effect.gen(function* () {
    const {
      terminalManager,
      zeropsAgentAuth,
      recordAuthorizer,
      isZeropsEnvironment: enabled,
    } = options;
    const changes = yield* PubSub.sliding<ZeropsAgentLoginByAgent>(4);
    const subscribeMutex = yield* Semaphore.make(1);

    if (!enabled) {
      const latest = Effect.succeed(EMPTY_LOGIN_BY_AGENT);
      const unavailable = new ZeropsAgentLoginError({
        reason: "unavailable",
        detail: "This environment does not offer a server-driven login.",
      });
      return {
        latest,
        changes: Stream.fromPubSub(changes),
        subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
        start: () => Effect.fail(unavailable),
        cancel: () => Effect.fail(unavailable),
      } satisfies ZeropsAgentLogin["Service"];
    }

    const state = yield* Ref.make<FeedState>({ logins: EMPTY_LOGIN_BY_AGENT });
    // Plain Map, not a Ref — mirrors `ZeropsAgentAuth.ts`'s own
    // `providerCheckQueues`: session bookkeeping is fiber/queue handles,
    // never decoded/compared as data, so a Ref buys nothing here.
    const sessions = new Map<ZeropsAgentId, ActiveSession>();

    const publish = Ref.get(state).pipe(
      Effect.flatMap((current) => PubSub.publish(changes, current.logins)),
      Effect.asVoid,
    );

    /**
     * Skips the update+publish when `login` is field-by-field identical to
     * what is already stored for this agent (S7 fix2 finding 2): a login
     * session in `menu`/`awaiting-browser` re-feeds an unrecognized TUI
     * screen's output on every PTY chunk — a live-observed redraw republished
     * 15 identical `menu` states in 4.5s. `handleOutputChunk` reconstructs a
     * full `ZeropsAgentLoginState` on every chunk regardless of whether the
     * walker actually found a transition, so the dedup has to live here,
     * not at the call site.
     */
    const setLoginState = (agentId: ZeropsAgentId, login: ZeropsAgentLoginState) =>
      Effect.gen(function* () {
        const before = (yield* Ref.get(state)).logins[agentId];
        if (before !== undefined && loginStateEqual(before, login)) {
          return;
        }
        yield* Ref.update(state, (current) => ({
          logins: { ...current.logins, [agentId]: login },
        }));
        yield* publish;
      });

    const clearLoginState = (agentId: ZeropsAgentId) =>
      Ref.update(state, (current) => ({
        logins: { ...current.logins, [agentId]: undefined },
      })).pipe(Effect.andThen(publish));

    /** Removes the session from the active map and stops its output listener — see the module header for why the stall fiber is left running. */
    const disposeSession = (agentId: ZeropsAgentId, token: symbol) => {
      const session = sessions.get(agentId);
      if (session !== undefined && session.token === token) {
        sessions.delete(agentId);
        session.unsubscribeOutput();
      }
    };

    const fireStall = (agentId: ZeropsAgentId, token: symbol): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessions.get(agentId);
        if (session === undefined || session.token !== token) {
          return;
        }
        const login = (yield* Ref.get(state)).logins[agentId];
        if (login === undefined) {
          return;
        }
        const action = stallLoginAction(login.phase);
        if (action.write === undefined) {
          return;
        }
        yield* terminalManager
          .write({ threadId: session.threadId, terminalId: session.terminalId, data: action.write })
          .pipe(Effect.ignore);
        if (action.clearBuffer) {
          yield* Ref.set(session.bufferRef, "");
        }
      });

    const handleOutputChunk = (
      agentId: ZeropsAgentId,
      token: symbol,
      chunk: string,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessions.get(agentId);
        if (session === undefined || session.token !== token) {
          return;
        }
        const buffer = appendAndTrim(yield* Ref.get(session.bufferRef), chunk);
        const before = (yield* Ref.get(state)).logins[agentId];
        const phase = before?.phase ?? "menu";
        const handler = ZEROPS_AGENT_LOGIN_HANDLERS[agentId];
        const result = stepLoginOutput({ phase, handler, buffer });

        yield* Ref.set(session.bufferRef, result.clearBuffer ? "" : buffer);

        if (result.write !== undefined) {
          yield* terminalManager
            .write({
              threadId: session.threadId,
              terminalId: session.terminalId,
              data: result.write,
            })
            .pipe(Effect.ignore);
        }

        if (result.nextPhase === "succeeded") {
          // Provenance before the recheck: the recheck is what republishes the
          // snapshot, so the record has to be on disk for that snapshot to
          // carry it.
          if (recordAuthorizer !== undefined) {
            yield* recordAuthorizer(agentId, session.subject);
          }
          yield* zeropsAgentAuth.recheckNow(agentId);
        }

        yield* setLoginState(agentId, {
          phase: result.nextPhase,
          url: result.url ?? before?.url,
          code: result.code ?? before?.code,
          message: result.message,
          terminalId: session.terminalId,
          startedAt: before?.startedAt ?? (yield* DateTime.now),
        });

        if (result.armStall) {
          yield* Queue.offer(session.stallQueue, undefined);
        }

        if (result.nextPhase === "succeeded" || result.nextPhase === "failed") {
          disposeSession(agentId, token);
        }
      });

    const attachTerminalListener = (
      agentId: ZeropsAgentId,
      token: symbol,
      threadId: string,
      terminalId: string,
    ) =>
      terminalManager.attachStream(
        { threadId, terminalId } satisfies TerminalAttachInput,
        (event) =>
          event.type === "output" ? handleOutputChunk(agentId, token, event.data) : Effect.void,
      );

    const start = (
      agentId: ZeropsAgentId,
      threadId: string,
      subject: string,
    ): Effect.Effect<{ readonly terminalId: string }, TerminalError | ZeropsAgentLoginError> =>
      Effect.gen(function* () {
        const existing = sessions.get(agentId);
        if (existing !== undefined) {
          return { terminalId: existing.terminalId };
        }

        const terminalId = loginTerminalId(agentId);
        const token = Symbol(agentId);
        const startedAt = yield* DateTime.now;

        yield* setLoginState(agentId, { phase: "starting", terminalId, startedAt });

        const attempt = Effect.gen(function* () {
          yield* terminalManager.open({
            threadId,
            terminalId,
            cwd: AGENT_LOGIN_CWD,
          } satisfies TerminalOpenInput);
          yield* terminalManager.write({
            threadId,
            terminalId,
            data: `${ZEROPS_AGENT_LOGIN_COMMANDS[agentId]}\r`,
          } satisfies TerminalWriteInput);

          const bufferRef = yield* Ref.make("");
          const stallQueue = yield* Queue.unbounded<void>();
          const unsubscribeOutput = yield* attachTerminalListener(
            agentId,
            token,
            threadId,
            terminalId,
          );

          sessions.set(agentId, {
            threadId,
            terminalId,
            token,
            bufferRef,
            stallQueue,
            unsubscribeOutput,
            subject,
          });

          yield* Stream.fromQueue(stallQueue).pipe(
            Stream.debounce(Duration.millis(STALL_TIMEOUT_MS)),
            Stream.mapEffect(() => fireStall(agentId, token)),
            Stream.runDrain,
            Effect.catchCause(() => Effect.void),
            Effect.forkDetach,
          );

          yield* setLoginState(agentId, { phase: "menu", terminalId, startedAt });
          // Arms the FIRST countdown too — mirrors the GUI walker sending
          // the command and immediately being subject to the stall timer.
          yield* Queue.offer(stallQueue, undefined);
        });

        yield* attempt.pipe(Effect.tapError(() => clearLoginState(agentId)));

        return { terminalId };
      });

    const cancel = (
      agentId: ZeropsAgentId,
    ): Effect.Effect<void, TerminalError | ZeropsAgentLoginError> =>
      Effect.gen(function* () {
        const session = sessions.get(agentId);
        if (session === undefined) {
          return;
        }
        disposeSession(agentId, session.token);
        const startedAt =
          (yield* Ref.get(state)).logins[agentId]?.startedAt ?? (yield* DateTime.now);
        yield* setLoginState(agentId, {
          phase: "cancelled",
          terminalId: session.terminalId,
          startedAt,
        });
        yield* terminalManager
          .write({ threadId: session.threadId, terminalId: session.terminalId, data: "\x03" })
          .pipe(Effect.ignore);
        yield* terminalManager.close({
          threadId: session.threadId,
          terminalId: session.terminalId,
        } satisfies TerminalCloseInput);
      });

    const latest = Ref.get(state).pipe(Effect.map((current) => current.logins));

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      start,
      cancel,
    } satisfies ZeropsAgentLogin["Service"];
  });

export const layer = Layer.effect(
  ZeropsAgentLogin,
  Effect.gen(function* () {
    const terminalManager = yield* TerminalManager;
    const zeropsAgentAuth = yield* ZeropsAgentAuth;
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const authorizersPath = path.join(
      config.stateDir,
      ZeropsAgentAuthorizers.ZEROPS_AGENT_AUTHORIZERS_FILE,
    );
    return yield* make({
      terminalManager,
      zeropsAgentAuth,
      isZeropsEnvironment: isZeropsEnvironment(config),
      recordAuthorizer: (agentId, subject) =>
        ZeropsAgentAuthorizers.recordAuthorizer(fs, authorizersPath, agentId, subject),
    });
  }),
);
