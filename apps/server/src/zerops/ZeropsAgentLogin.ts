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
 * / `zeropsAgentLoginHandlers.ts`).
 *
 * Claude's code comes back the way the GUI dialog takes it: the person pastes
 * it into a field, and {@link ZeropsAgentLogin} `submitCode` types it into the
 * login terminal, then Enter. Pasting straight into the terminal pane works
 * just the same. The code is written to the PTY and nowhere else — never the
 * feed, a span or a log.
 *
 * Every `start` begins in a fresh terminal: the previous attempt's CLI may
 * still be running (a wrong code leaves Claude at "Press Enter to retry"), and
 * a login command typed into it would land in its prompt. The command is
 * written as `<login command>; exit`, so the terminal's process ends with the
 * CLI: an exit the walker has not already turned into `succeeded` or `failed`
 * fails the login with how it ended, instead of leaving it at `menu` or
 * `awaiting-browser` with nothing left to answer it.
 *
 * Each login gets at most one active session at a time (`start` on a login
 * with a session already running just re-attaches to it — same
 * `{terminalId}`, no second command spawned into the same shell). A finished
 * session (`succeeded` / `failed` / `cancelled`) is removed from the active
 * set, so a later `start` opens a fresh one.
 *
 * A login is an agent's default one, keyed by the agent id, or one beyond the
 * defaults (crew mode's *Runs on*, `ZeropsLogins`), keyed by its own id: the
 * same walker, in its own terminal, with its own home in the terminal's
 * environment (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). Its success asks its own
 * check, never its agent's.
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
import * as NodeOS from "node:os";

import type {
  TerminalAttachInput,
  TerminalCloseInput,
  TerminalError,
  TerminalOpenInput,
  TerminalWriteInput,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentId,
  ZeropsAgentLoginState,
  ZeropsLogin,
} from "@t3tools/contracts";
import { ZEROPS_AGENT_LOGIN_COMMANDS, ZeropsAgentLoginError } from "@t3tools/contracts";
import { latestSucceededSignIn } from "@t3tools/shared/zeropsAgentAuth";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
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
import { withLogins, ZeropsLogins } from "./ZeropsLogins.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
import { ZEROPS_AGENT_LOGIN_HANDLERS } from "./zeropsAgentLoginHandlers.ts";
import { stallLoginAction, stepLoginOutput } from "./zeropsAgentLoginWalker.ts";
import { fileSignInStore, signInsPath, type SignInStore } from "./zeropsSignIns.ts";

/** How long a burst of terminal output coalesces into one stall countdown — mirrors the GUI walker's `STALL_TIMEOUT_MS`. */
const STALL_TIMEOUT_MS = 1000;
/** Keeps a pathological non-terminating stream from growing the buffer without bound. */
const MAX_BUFFER_LENGTH = 8000;
const BUFFER_TRIM_KEEP = 4000;

/**
 * The gap between a submitted code and its Enter. The GUI dialog measured
 * that a terminal pipeline can drop an Enter arriving in the same chunk as
 * the code (frontend-legacy `SEND_CODE_NEWLINE_DELAY_MS`), and Claude's
 * prompt treats one chunk as a paste.
 */
const CODE_ENTER_DELAY = Duration.millis(100);

/** Phases in which a paste-code login's CLI is waiting at its code prompt — Claude prints the prompt right under the URL. */
const AWAITING_CODE_PHASES: ReadonlySet<ZeropsAgentLoginState["phase"]> = new Set([
  "awaiting-browser",
  "awaiting-code",
]);

/** The Zerops user id behind a session subject; any other subject is kept whole, and matches no Zerops user. */
const startedByOf = (subject: string): string =>
  subject.startsWith(ZEROPS_SUBJECT_PREFIX) ? subject.slice(ZEROPS_SUBJECT_PREFIX.length) : subject;

/** The sshfs-mounted project root every mate terminal defaults to — matches `AGENT_LOGIN_CWD` in the web's (now-deleted) direct-typing path. */
const AGENT_LOGIN_CWD = "/var/www";

/** Deterministic per-login terminal id (the agent id for a default login), distinct from the user's own `term-1` primary shell. */
export const loginTerminalId = (key: string): string => `agent-login-${key}`;

/**
 * A login beyond the two defaults (`ZeropsLogins`): its id, and what its CLI
 * runs with — the home that makes it that login.
 */
export interface LoginTarget {
  readonly id: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Login state by agent id for the default logins, and by login id for every other. */
export type ZeropsAgentLoginByAgent = Readonly<Record<string, ZeropsAgentLoginState | undefined>>;

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
 * The one snapshot `subscribeZeropsAgentAuth` publishes: the agent rows with
 * their default logins' walker state ({@link mergeAgentAuthLogin}), and every
 * login listed (`ZeropsLogins.withLogins`) — the defaults from those rows,
 * every other login with its own walker state, keyed by its id.
 */
export const combineAgentAuth = (
  snapshot: ZeropsAgentAuthSnapshot,
  extras: ReadonlyArray<ZeropsLogin>,
  logins: ZeropsAgentLoginByAgent,
): ZeropsAgentAuthSnapshot =>
  withLogins(
    mergeAgentAuthLogin(snapshot, logins),
    extras.map((row) => {
      const login = logins[row.id];
      return login === undefined ? row : { ...row, login };
    }),
  );

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
  a.startedBy === b.startedBy &&
  DateTime.Equivalence(a.startedAt, b.startedAt) &&
  a.lastSucceeded?.startedBy === b.lastSucceeded?.startedBy &&
  (a.lastSucceeded === undefined || b.lastSucceeded === undefined
    ? a.lastSucceeded === b.lastSucceeded
    : DateTime.Equivalence(a.lastSucceeded.startedAt, b.lastSucceeded.startedAt));

/**
 * `next`, carrying the latest attempt before it that succeeded (`lastSucceeded`) where it has not
 * succeeded itself: a sign-in started, cancelled or failed after another's success leaves that
 * success known until its record lands.
 */
export function withLatestSuccess(
  before: ZeropsAgentLoginState | undefined,
  next: ZeropsAgentLoginState,
): ZeropsAgentLoginState {
  const { lastSucceeded: _carried, ...attempt } = next;
  if (next.phase === "succeeded") return attempt;
  const success = latestSucceededSignIn(before);
  return success === undefined ? attempt : { ...attempt, lastSucceeded: success };
}

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
       * The subject of the session driving this login, taken from the
       * authenticated session — never from the client's input, which could
       * name anyone. Published as the login's `startedBy`, so that person's
       * client records the signer once it succeeds.
       */
      subject: string,
      /** Absent: the agent's default login. */
      login?: LoginTarget,
    ) => Effect.Effect<{ readonly terminalId: string }, TerminalError | ZeropsAgentLoginError>;
    readonly cancel: (
      agentId: ZeropsAgentId,
      loginId?: string,
    ) => Effect.Effect<void, TerminalError | ZeropsAgentLoginError>;
    /**
     * Types `code` into the login's terminal, then Enter. Fails with
     * `not-awaiting-code` unless a paste-code login (Claude) is at its prompt.
     */
    readonly submitCode: (
      agentId: ZeropsAgentId,
      code: string,
      loginId?: string,
    ) => Effect.Effect<void, TerminalError | ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsAgentLogin") {}

export interface ZeropsAgentLoginOptions {
  readonly terminalManager: Pick<
    TerminalManager["Service"],
    "open" | "write" | "attachStream" | "close"
  >;
  readonly zeropsAgentAuth: Pick<ZeropsAgentAuth["Service"], "recheckNow">;
  /** Re-checks a login beyond the defaults once it signs in; absent, only default logins run. */
  readonly zeropsLogins?: Pick<ZeropsLogins["Service"], "recheckNow">;
  readonly isZeropsEnvironment: boolean;
  /**
   * Who signed each login in last, kept across restarts (`zeropsSignIns`): read back at start,
   * written with every success. Absent, it lives only as long as the process.
   */
  readonly signIns?: SignInStore;
  /**
   * Whether each login holds a credential, by signer key, as the feeds read it: a login whose
   * credential goes takes its kept sign-in with it. Absent, nothing is cleared.
   */
  readonly credentialsHeld?: Stream.Stream<ReadonlyArray<readonly [string, boolean]>>;
}

interface FeedState {
  readonly logins: ZeropsAgentLoginByAgent;
}

interface ActiveSession {
  readonly agentId: ZeropsAgentId;
  readonly threadId: string;
  readonly terminalId: string;
  /** Identity marker — every deferred/background action checks this against the CURRENT map entry before acting (see the module header). */
  readonly token: symbol;
  readonly bufferRef: Ref.Ref<string>;
  readonly stallQueue: Queue.Queue<void>;
  readonly unsubscribeOutput: () => void;
  /** The Zerops user id of whoever started this login — see `ZeropsAgentLoginState.startedBy`. */
  readonly startedBy: string;
}

/** How a login process ended, for the message a failed login carries. */
const exitDetail = (ended: {
  readonly exitCode: number | null;
  readonly exitSignal: number | null;
}): string =>
  ended.exitCode !== null
    ? `exit code ${ended.exitCode}`
    : ended.exitSignal !== null
      ? `signal ${ended.exitSignal}`
      : "no exit status";

const appendAndTrim = (buffer: string, chunk: string): string => {
  const next = buffer + chunk;
  return next.length > MAX_BUFFER_LENGTH ? next.slice(-BUFFER_TRIM_KEEP) : next;
};

export const make = (options: ZeropsAgentLoginOptions) =>
  Effect.gen(function* () {
    const {
      terminalManager,
      zeropsAgentAuth,
      zeropsLogins,
      isZeropsEnvironment: enabled,
      signIns,
      credentialsHeld,
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
        submitCode: () => Effect.fail(unavailable),
      } satisfies ZeropsAgentLogin["Service"];
    }

    // A restart picks up who signed each login in last: the credential lives on, and so does
    // whose it is — the turn gate goes by it whatever the signer tag says.
    const kept = signIns === undefined ? {} : yield* signIns.load;
    const state = yield* Ref.make<FeedState>({
      logins: {
        ...EMPTY_LOGIN_BY_AGENT,
        ...Object.fromEntries(
          Object.entries(kept).flatMap(([key, record]) => {
            // An instant no `DateTime` holds is no sign-in: never a reason not to start.
            const startedAt = Option.getOrUndefined(DateTime.make(record.at));
            return startedAt === undefined
              ? []
              : [
                  [
                    key,
                    {
                      phase: "succeeded",
                      terminalId: loginTerminalId(key),
                      startedAt: DateTime.toUtc(startedAt),
                      startedBy: record.by,
                    } satisfies ZeropsAgentLoginState,
                  ] as const,
                ];
          }),
        ),
      },
    });
    // A login whose credential goes takes its kept sign-in with it: on the first reading
    // without one (a credential gone while the server was down), and when one is seen to go.
    // Not on a reading that never had one, which is every sign-in's own first moments.
    if (signIns !== undefined && credentialsHeld !== undefined) {
      const held = new Map<string, boolean>();
      yield* credentialsHeld.pipe(
        Stream.runForEach((rows) =>
          Effect.forEach(rows, ([key, now]) => {
            const before = held.get(key);
            held.set(key, now);
            return !now && before !== false ? signIns.clear(key) : Effect.void;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("zerops agent login: credential watch stopped", { cause }),
        ),
        Effect.forkScoped,
      );
    }
    // Plain Map, not a Ref — mirrors `ZeropsAgentAuth.ts`'s own
    // `providerCheckQueues`: session bookkeeping is fiber/queue handles,
    // never decoded/compared as data, so a Ref buys nothing here.
    const sessions = new Map<string, ActiveSession>();

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
    const setLoginState = (key: string, login: ZeropsAgentLoginState) =>
      Effect.gen(function* () {
        const before = (yield* Ref.get(state)).logins[key];
        const carried = withLatestSuccess(before, login);
        if (before !== undefined && loginStateEqual(before, carried)) {
          return;
        }
        yield* Ref.update(state, (current) => ({
          logins: { ...current.logins, [key]: carried },
        }));
        yield* publish;
      });

    /**
     * Puts a login back as it stood before an attempt that never started: the person who signed
     * it in last is what the gate goes by, and an attempt that failed to start changes nothing.
     */
    const restoreLoginState = (key: string, before: ZeropsAgentLoginState | undefined) =>
      Ref.update(state, (current) => ({
        logins: { ...current.logins, [key]: before },
      })).pipe(Effect.andThen(publish));

    /** Removes the session from the active map and stops its output listener — see the module header for why the stall fiber is left running. */
    const disposeSession = (key: string, token: symbol) => {
      const session = sessions.get(key);
      if (session !== undefined && session.token === token) {
        sessions.delete(key);
        session.unsubscribeOutput();
      }
    };

    const fireStall = (key: string, token: symbol): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessions.get(key);
        if (session === undefined || session.token !== token) {
          return;
        }
        const login = (yield* Ref.get(state)).logins[key];
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

    const handleOutputChunk = (key: string, token: symbol, chunk: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessions.get(key);
        if (session === undefined || session.token !== token) {
          return;
        }
        const buffer = appendAndTrim(yield* Ref.get(session.bufferRef), chunk);
        const before = (yield* Ref.get(state)).logins[key];
        const phase = before?.phase ?? "menu";
        const handler = ZEROPS_AGENT_LOGIN_HANDLERS[session.agentId];
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

        if (result.nextPhase === "succeeded" && signIns !== undefined) {
          // Kept before anything else hears of the success: whose the credential is outlives
          // this process (`zeropsSignIns`).
          yield* signIns.save(key, {
            by: session.startedBy,
            at: DateTime.toEpochMillis(before?.startedAt ?? (yield* DateTime.now)),
          });
        }

        if (result.nextPhase === "succeeded") {
          // The record of WHO signed in is a tag on the Mate's project, written
          // by the app as the person (D6, `ZeropsProjectSigners`): this
          // container's own key cannot write tags, which is the whole reason
          // the record moved off its disk. All this does is republish the
          // snapshot, which reads the tags afresh until the record names who
          // signed in. A login beyond the defaults is its own feed's to re-check.
          yield* key === session.agentId
            ? zeropsAgentAuth.recheckNow(session.agentId, session.startedBy)
            : (zeropsLogins?.recheckNow(key, session.startedBy) ?? Effect.void);
        }

        yield* setLoginState(key, {
          phase: result.nextPhase,
          url: result.url ?? before?.url,
          code: result.code ?? before?.code,
          message: result.message,
          terminalId: session.terminalId,
          startedAt: before?.startedAt ?? (yield* DateTime.now),
          startedBy: session.startedBy,
        });

        if (result.armStall) {
          yield* Queue.offer(session.stallQueue, undefined);
        }

        if (result.nextPhase === "succeeded" || result.nextPhase === "failed") {
          disposeSession(key, token);
        }
      });

    /**
     * The login's process ended while the walker still waited on it — it
     * crashed, was killed, or quit on a screen the walker did not recognize.
     * The login is over: nothing it printed later could move it on.
     */
    const handleExit = (
      key: string,
      token: symbol,
      ended: { readonly exitCode: number | null; readonly exitSignal: number | null },
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const session = sessions.get(key);
        if (session === undefined || session.token !== token) {
          return;
        }
        disposeSession(key, token);
        const before = (yield* Ref.get(state)).logins[key];
        yield* setLoginState(key, {
          phase: "failed",
          message: `The sign-in ended before it finished (${exitDetail(ended)}). Start it again.`,
          terminalId: session.terminalId,
          startedAt: before?.startedAt ?? (yield* DateTime.now),
          startedBy: session.startedBy,
        });
      });

    const attachTerminalListener = (
      key: string,
      token: symbol,
      threadId: string,
      terminalId: string,
    ) =>
      terminalManager.attachStream(
        { threadId, terminalId } satisfies TerminalAttachInput,
        (event) =>
          event.type === "output"
            ? handleOutputChunk(key, token, event.data)
            : event.type === "exited"
              ? handleExit(key, token, event)
              : Effect.void,
      );

    const start = (
      agentId: ZeropsAgentId,
      threadId: string,
      subject: string,
      login?: LoginTarget,
    ): Effect.Effect<{ readonly terminalId: string }, TerminalError | ZeropsAgentLoginError> =>
      Effect.gen(function* () {
        const key = login?.id ?? agentId;
        const existing = sessions.get(key);
        if (existing !== undefined) {
          return { terminalId: existing.terminalId };
        }

        const terminalId = loginTerminalId(key);
        const token = Symbol(key);
        const startedAt = yield* DateTime.now;
        const startedBy = startedByOf(subject);
        const before = (yield* Ref.get(state)).logins[key];

        yield* setLoginState(key, { phase: "starting", terminalId, startedAt, startedBy });

        const attempt = Effect.gen(function* () {
          // A fresh PTY and no replayed history — see the module header.
          yield* terminalManager
            .close({ threadId, terminalId, deleteHistory: true } satisfies TerminalCloseInput)
            .pipe(Effect.ignore);
          yield* terminalManager.open({
            threadId,
            terminalId,
            cwd: AGENT_LOGIN_CWD,
            ...(login === undefined ? {} : { env: login.env }),
          } satisfies TerminalOpenInput);
          // The shell exits with the CLI, so the terminal's own `exited`
          // event is the end of the login process, however it ended.
          yield* terminalManager.write({
            threadId,
            terminalId,
            data: `${ZEROPS_AGENT_LOGIN_COMMANDS[agentId]}; exit\r`,
          } satisfies TerminalWriteInput);

          const bufferRef = yield* Ref.make("");
          const stallQueue = yield* Queue.unbounded<void>();
          const unsubscribeOutput = yield* attachTerminalListener(key, token, threadId, terminalId);

          sessions.set(key, {
            agentId,
            threadId,
            terminalId,
            token,
            bufferRef,
            stallQueue,
            unsubscribeOutput,
            startedBy,
          });

          yield* Stream.fromQueue(stallQueue).pipe(
            Stream.debounce(Duration.millis(STALL_TIMEOUT_MS)),
            Stream.mapEffect(() => fireStall(key, token)),
            Stream.runDrain,
            Effect.catchCause(() => Effect.void),
            Effect.forkDetach,
          );

          yield* setLoginState(key, { phase: "menu", terminalId, startedAt, startedBy });
          // Arms the FIRST countdown too — mirrors the GUI walker sending
          // the command and immediately being subject to the stall timer.
          yield* Queue.offer(stallQueue, undefined);
        });

        yield* attempt.pipe(Effect.tapError(() => restoreLoginState(key, before)));

        return { terminalId };
      });

    const cancel = (
      agentId: ZeropsAgentId,
      loginId?: string,
    ): Effect.Effect<void, TerminalError | ZeropsAgentLoginError> =>
      Effect.gen(function* () {
        const key = loginId ?? agentId;
        const session = sessions.get(key);
        if (session === undefined) {
          return;
        }
        disposeSession(key, session.token);
        const startedAt = (yield* Ref.get(state)).logins[key]?.startedAt ?? (yield* DateTime.now);
        yield* setLoginState(key, {
          phase: "cancelled",
          terminalId: session.terminalId,
          startedAt,
          startedBy: session.startedBy,
        });
        yield* terminalManager
          .write({ threadId: session.threadId, terminalId: session.terminalId, data: "\x03" })
          .pipe(Effect.ignore);
        yield* terminalManager.close({
          threadId: session.threadId,
          terminalId: session.terminalId,
        } satisfies TerminalCloseInput);
      });

    const submitCode = (
      agentId: ZeropsAgentId,
      code: string,
      loginId?: string,
    ): Effect.Effect<void, TerminalError | ZeropsAgentLoginError> =>
      Effect.gen(function* () {
        const key = loginId ?? agentId;
        const session = sessions.get(key);
        const login = (yield* Ref.get(state)).logins[key];
        if (
          session === undefined ||
          login === undefined ||
          ZEROPS_AGENT_LOGIN_HANDLERS[agentId].flowMode !== "paste-code" ||
          !AWAITING_CODE_PHASES.has(login.phase)
        ) {
          return yield* new ZeropsAgentLoginError({
            reason: "not-awaiting-code",
            detail: "This sign-in is not waiting for a code. Start it again.",
          });
        }
        // What the CLI printed before the code — its prompt, an earlier
        // attempt's error — must not read as the answer to this one.
        yield* Ref.set(session.bufferRef, "");
        yield* setLoginState(key, { ...login, phase: "verifying-code", message: undefined });
        const target = { threadId: session.threadId, terminalId: session.terminalId };
        // Uninterruptible: a dropped connection between the two writes would
        // leave the code typed without its Enter and the login stuck here.
        yield* terminalManager.write({ ...target, data: code } satisfies TerminalWriteInput).pipe(
          Effect.andThen(Effect.sleep(CODE_ENTER_DELAY)),
          Effect.andThen(
            terminalManager.write({ ...target, data: "\r" } satisfies TerminalWriteInput),
          ),
          Effect.uninterruptible,
          // Back to the prompt only if nothing has moved the login on since.
          Effect.tapError(() =>
            Ref.get(state).pipe(
              Effect.flatMap((current) =>
                current.logins[key]?.phase === "verifying-code"
                  ? setLoginState(key, login)
                  : Effect.void,
              ),
            ),
          ),
        );
      });

    const latest = Ref.get(state).pipe(Effect.map((current) => current.logins));

    return {
      latest,
      changes: Stream.fromPubSub(changes),
      subscribe: subscribeBeforeSnapshot(changes, latest, subscribeMutex),
      start,
      cancel,
      submitCode,
    } satisfies ZeropsAgentLogin["Service"];
  });

/**
 * Whether each login holds a credential, by signer key, as far as it is known: the agents' own
 * by their credential file (read before the feed starts), the further logins by their own
 * checks' answers only — a row listed before its first check answers says nothing yet.
 */
export function credentialsHeldOf(
  agentAuth: Pick<ZeropsAgentAuth["Service"], "latest" | "changes">,
  logins: Pick<ZeropsLogins["Service"], "credentials">,
): Stream.Stream<ReadonlyArray<readonly [string, boolean]>> {
  const agents = Stream.concat(Stream.fromEffect(agentAuth.latest), agentAuth.changes).pipe(
    Stream.map((snapshot) =>
      snapshot.available
        ? snapshot.agents.map((agent) => [agent.agentId, agent.credPresent] as const)
        : [],
    ),
  );
  return Stream.merge(agents, logins.credentials);
}

export const layer = Layer.effect(
  ZeropsAgentLogin,
  Effect.gen(function* () {
    const terminalManager = yield* TerminalManager;
    const zeropsAgentAuth = yield* ZeropsAgentAuth;
    const zeropsLogins = yield* ZeropsLogins;
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    const signIns = yield* fileSignInStore(signInsPath(path, NodeOS.homedir()));
    return yield* make({
      terminalManager,
      zeropsAgentAuth,
      zeropsLogins,
      isZeropsEnvironment: isZeropsEnvironment(config),
      signIns,
      credentialsHeld: credentialsHeldOf(zeropsAgentAuth, zeropsLogins),
    });
  }),
);
