/**
 * ZeropsSignOut — the one sign-out of a login on this Mate, by its key: an
 * agent's own login (`claude-code`, `codex`) or a login beyond the two
 * (`ZeropsLogins`, crew mode's *Runs on*, PRD §2.3). `zerops.agentLogin.signOut`
 * runs it for whoever asks; offboarding (`ZeropsOffboarding`) runs it for every
 * login of a person this project no longer opens for (X4). Both mean the same:
 * the login works for nobody afterwards.
 *
 * Steps, in order:
 *  a. refuse what has no sign-in of a person to end: an agent authorized by a
 *     project token (it belongs to the project, as `ZeropsProjectSigners`'
 *     D6 reasoning has it), an API-key login (it is removed instead), a login
 *     this project does not have, and as a login an agent's own (it is signed
 *     out as the agent, never removed);
 *  b. cancel the login's running server-driven login session
 *     (`ZeropsAgentLogin.cancel`);
 *  c. stop every live provider session running on it — required, not
 *     optional: measured live 2026-09-22 on project 111111, a running turn
 *     keeps working after its credential file is replaced (the provider holds
 *     its token in memory). Each stop is `thread.session.stop` through
 *     orchestration, then waited on until the session reads stopped, at most
 *     {@link SESSION_STOP_WAIT_TIMEOUT}: the dispatch returns once the command
 *     is persisted, while the provider behind it may still be alive, and could
 *     still rewrite the credential the next step logs out;
 *  d. run the CLI's own logout in the login's home (`claude auth logout` /
 *     `codex logout`, idempotent); if it fails, or the credential is still
 *     there afterwards, remove the file;
 *  e. an agent's own login: `ZeropsAgentAuth.invalidatePendingMark`, so a probe
 *     already in flight cannot re-mark the platform flag, then
 *     `ZeropsAgentFlag.clearSignedIn` deletes it;
 *  f. re-check the login, so every reader sees it signed out now.
 *
 * Every step after (a) is best-effort: logged, never thrown, so one that
 * stumbles (a login session that will not cancel, a stop that errors, a logout
 * that fails, a flag the API will not delete) leaves no stale state standing
 * behind it.
 *
 * The record of who signed the login in (`zeropsSignIns`) is left alone: the
 * login walker's credential watch lets it go with the credential, a record
 * without a credential names nobody, and the next sign-in replaces it.
 *
 * @module ZeropsSignOut
 */
import {
  agentIdForProviderInstance,
  CommandId,
  defaultInstanceIdForDriver,
  type OrchestrationThreadShell,
  ProviderDriverKind,
  type ThreadId,
  ZeropsAgentLoginError,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as NodeOS from "node:os";

import { ServerConfig } from "../config.ts";
import { MateEngine, type MateEngineService } from "../engine/MateEngine.ts";
import type { OrchestrationDispatchError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import { ZeropsAgentFlag } from "./ZeropsAgentFlag.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  mateLoginCredentialPath,
  mateLoginEnvironment,
  type MateLogin,
  ZeropsLogins,
} from "./ZeropsLogins.ts";
import { LOGIN_DRIVER_KIND } from "./zeropsLoginIds.ts";

/** A login to sign out: an agent's own, or one beyond the two by its id. */
export type SignOutTarget = { readonly agentId: ZeropsAgentId } | { readonly loginId: string };

/** Where each agent CLI keeps its own login's credential, under the home directory. */
export const AGENT_CREDENTIAL_SEGMENTS: Readonly<Record<ZeropsAgentId, ReadonlyArray<string>>> = {
  "claude-code": [".claude", ".credentials.json"],
  codex: [".codex", "auth.json"],
};

/** One argv invocation per agent — never a shell string. */
const LOGOUT_COMMAND: Readonly<
  Record<ZeropsAgentId, { readonly command: string; readonly args: ReadonlyArray<string> }>
> = {
  "claude-code": { command: "claude", args: ["auth", "logout"] },
  codex: { command: "codex", args: ["logout"] },
};

/** Generous for a local CLI logout: no network round trip, and both exit fast when signed out. */
const LOGOUT_TIMEOUT = Duration.seconds(15);
const LOGOUT_MAX_OUTPUT_BYTES = 16 * 1024;

const SESSION_STOP_POLL_INTERVAL = Duration.millis(250);
/** How long a stopped session is waited on before the sign-out moves on. */
export const SESSION_STOP_WAIT_TIMEOUT = Duration.seconds(10);

/** The two default instances' ids — an agent's own logins, never removed. */
const DEFAULT_LOGIN_IDS: ReadonlySet<string> = new Set(
  Object.values(LOGIN_DRIVER_KIND).map((driver) =>
    defaultInstanceIdForDriver(ProviderDriverKind.make(driver)),
  ),
);

/** A login's home for its CLI: the agent's own login runs in the default one. */
export interface LoginHome {
  readonly agent: ZeropsAgentId;
  /** The login's own home; none for an agent's own login. */
  readonly home: string | undefined;
}

/**
 * Which of `threads`' live sessions run on `target` — by the session's own
 * instance, falling back to the thread's selection only when the session names
 * none (older or partial snapshots): a thread can be repointed at another
 * agent while a session of the previous one is still live, and that is the one
 * to stop. An agent's own login is its default instance
 * (`agentIdForProviderInstance`); a thread with no session, or one already
 * stopped, has nothing to stop.
 */
export const threadsToStop = (
  threads: ReadonlyArray<Pick<OrchestrationThreadShell, "id" | "modelSelection" | "session">>,
  target: SignOutTarget,
): ReadonlyArray<ThreadId> =>
  threads
    .filter((thread) => thread.session !== null && thread.session.status !== "stopped")
    .filter((thread) => {
      const instanceId = thread.session?.providerInstanceId ?? thread.modelSelection.instanceId;
      return "agentId" in target
        ? agentIdForProviderInstance(instanceId) === target.agentId
        : instanceId === target.loginId;
    })
    .map((thread) => thread.id);

/**
 * Polls `isLive` until it answers `false`, or `timeout` elapses — whichever
 * comes first. Never fails: a sign-out goes on even when a session cannot be
 * confirmed stopped in time.
 */
export const waitUntilNotLive = (
  isLive: Effect.Effect<boolean>,
  options: { readonly pollInterval: Duration.Duration; readonly timeout: Duration.Duration },
): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (yield* isLive) {
      yield* Effect.sleep(options.pollInterval);
    }
  }).pipe(Effect.timeout(options.timeout), Effect.ignore);

/**
 * Step (c) over orchestration: every live session on `target` stopped, each
 * waited on until it reads stopped or the cap. Best-effort end to end: a
 * snapshot that cannot be read, or one stop that fails, is logged and skipped.
 */
export const stopSessionsVia =
  (orchestration: {
    readonly threads: Effect.Effect<ReadonlyArray<OrchestrationThreadShell>>;
    readonly isLive: (threadId: ThreadId) => Effect.Effect<boolean>;
    readonly stop: (threadId: ThreadId) => Effect.Effect<void, OrchestrationDispatchError>;
  }) =>
  (target: SignOutTarget): Effect.Effect<void> =>
    Effect.flatMap(orchestration.threads, (threads) =>
      Effect.forEach(
        threadsToStop(threads, target),
        (threadId) =>
          orchestration.stop(threadId).pipe(
            Effect.andThen(
              waitUntilNotLive(orchestration.isLive(threadId), {
                pollInterval: SESSION_STOP_POLL_INTERVAL,
                timeout: SESSION_STOP_WAIT_TIMEOUT,
              }),
            ),
            Effect.catchCause((cause) =>
              Effect.logWarning("zerops sign-out: could not stop a live session", {
                ...target,
                threadId,
                cause,
              }),
            ),
          ),
        { discard: true },
      ),
    );

/**
 * Step (c) when the Mate engine owns the conversation: the engine stops every
 * live session on the target's instances. An agent's own login is its default
 * instance, under either spelling a session may carry; any other login is its
 * own instance.
 */
export const stopSessionsOnEngine =
  (engine: Pick<MateEngineService, "stopSessionsOn">) =>
  (target: SignOutTarget): Effect.Effect<void> =>
    engine.stopSessionsOn(
      "agentId" in target
        ? [
            ...new Set([
              defaultInstanceIdForDriver(
                ProviderDriverKind.make(LOGIN_DRIVER_KIND[target.agentId]),
              ),
              target.agentId,
            ]),
          ]
        : [target.loginId],
      "sign-out",
    );

export class ZeropsSignOut extends Context.Service<
  ZeropsSignOut,
  {
    /** Signs `target` out everywhere it reaches; fails only with step (a)'s refusal. */
    readonly signOut: (target: SignOutTarget) => Effect.Effect<void, ZeropsAgentLoginError>;
    /** Signs a login beyond the defaults out (an account), then forgets it: its instance, its key, its home. */
    readonly remove: (loginId: string) => Effect.Effect<void, ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsSignOut") {}

export interface ZeropsSignOutOptions {
  readonly isZeropsEnvironment: boolean;
  readonly zeropsAgentAuth: Pick<
    ZeropsAgentAuth["Service"],
    "latest" | "recheckNow" | "invalidatePendingMark"
  >;
  readonly zeropsAgentLogin: Pick<ZeropsAgentLogin["Service"], "cancel">;
  readonly zeropsAgentFlag: Pick<ZeropsAgentFlag["Service"], "clearSignedIn">;
  readonly zeropsLogins: Pick<ZeropsLogins["Service"], "resolve" | "recheckNow" | "forget">;
  /** Step (c): every live session on the target stopped (`stopSessionsVia`). */
  readonly stopSessions: (target: SignOutTarget) => Effect.Effect<void>;
  /** The CLI's own logout once, in the login's home. `success: false` covers every failure. */
  readonly runLogout: (login: LoginHome) => Effect.Effect<{ readonly success: boolean }>;
  /** Where an agent's own login keeps its credential. */
  readonly agentCredentialPath: (agentId: ZeropsAgentId) => string;
  readonly credentialExists: (path: string) => Effect.Effect<boolean>;
  readonly removeCredential: (path: string) => Effect.Effect<void, PlatformError.PlatformError>;
}

const logAndContinue = (label: string, target: SignOutTarget) => (cause: unknown) =>
  Effect.logWarning(`zerops sign-out: ${label}`, { ...target, cause });

const unavailableError = new ZeropsAgentLoginError({
  reason: "unavailable",
  detail: "This environment does not offer a server-driven sign-out.",
});

/** The service where there is no Zerops project: nothing to sign out or remove. */
export const unavailable = ZeropsSignOut.of({
  signOut: () => Effect.fail(unavailableError),
  remove: () => Effect.fail(unavailableError),
});

export const make = (options: ZeropsSignOutOptions) => {
  if (!options.isZeropsEnvironment) return Effect.succeed(unavailable);
  const {
    zeropsAgentAuth,
    zeropsAgentLogin,
    zeropsAgentFlag,
    zeropsLogins,
    stopSessions,
    runLogout,
    agentCredentialPath,
    credentialExists,
    removeCredential,
  } = options;

  /** Steps (c) and (d): its sessions stopped, its CLI logged out, a credential left removed. */
  const endSessionsAndLogOut = (target: SignOutTarget, login: LoginHome, credential: string) =>
    Effect.gen(function* () {
      // `catchCause`: the one step that dispatches through orchestration, for possibly several
      // threads at once — a stop going wrong must still never lose the steps after it.
      yield* stopSessions(target).pipe(
        Effect.catchCause(logAndContinue("could not stop live provider sessions", target)),
      );
      const logout = yield* runLogout(login);
      const credentialLeft = logout.success ? yield* credentialExists(credential) : true;
      if (credentialLeft) {
        yield* removeCredential(credential).pipe(
          Effect.catch(logAndContinue("could not remove the credential file", target)),
        );
      }
    });

  const signOutAgent = (agentId: ZeropsAgentId) =>
    Effect.gen(function* () {
      const target = { agentId };
      const snapshot = yield* zeropsAgentAuth.latest;
      if (snapshot.agents.find((entry) => entry.agentId === agentId)?.flagToken) {
        return yield* new ZeropsAgentLoginError({
          reason: "token-authorized",
          detail:
            "This agent is authorized with a project token, which belongs to the project — there is nothing to sign out.",
        });
      }
      yield* zeropsAgentLogin
        .cancel(agentId)
        .pipe(Effect.catch(logAndContinue("could not cancel the login session", target)));
      yield* endSessionsAndLogOut(
        target,
        { agent: agentId, home: undefined },
        agentCredentialPath(agentId),
      );
      // BEFORE clearing the flag: a probe in flight when sign-out started must not re-mark the
      // flag this step is about to clear once it finally answers "authenticated".
      yield* zeropsAgentAuth.invalidatePendingMark(agentId);
      yield* zeropsAgentFlag
        .clearSignedIn(agentId)
        .pipe(Effect.catch(logAndContinue("could not clear the platform flag", target)));
      yield* zeropsAgentAuth.recheckNow(agentId);
    });

  /** A login beyond the defaults, known to this project. */
  const known = (loginId: string) =>
    Effect.gen(function* () {
      if (DEFAULT_LOGIN_IDS.has(loginId)) {
        return yield* new ZeropsAgentLoginError({
          reason: "default-login",
          detail: "This is the agent's own login: sign it out, it cannot be removed.",
        });
      }
      const login = yield* zeropsLogins.resolve(loginId);
      if (login === undefined) {
        return yield* new ZeropsAgentLoginError({
          reason: "unknown-login",
          detail: "No such login on this project.",
        });
      }
      return login;
    });

  /** Steps (b)–(d) for a login beyond the defaults; an API key has only sessions to stop. */
  const endLogin = (login: MateLogin) =>
    Effect.gen(function* () {
      const target = { loginId: login.id };
      if (login.kind === "subscription") {
        yield* zeropsAgentLogin
          .cancel(login.agent, login.id)
          .pipe(Effect.catch(logAndContinue("could not cancel the login session", target)));
      }
      if (login.kind === "apiKey") {
        yield* stopSessions(target).pipe(
          Effect.catchCause(logAndContinue("could not stop live provider sessions", target)),
        );
        return;
      }
      yield* endSessionsAndLogOut(
        target,
        { agent: login.agent, home: login.home },
        mateLoginCredentialPath(login),
      );
    });

  const signOut: ZeropsSignOut["Service"]["signOut"] = (target) =>
    "agentId" in target
      ? signOutAgent(target.agentId)
      : Effect.gen(function* () {
          const login = yield* known(target.loginId);
          if (login.kind === "apiKey") {
            return yield* new ZeropsAgentLoginError({
              reason: "invalid-login",
              detail: "An API key has no sign-in to end: remove the login instead.",
            });
          }
          yield* endLogin(login);
          yield* zeropsLogins.recheckNow(login.id);
        });

  const remove: ZeropsSignOut["Service"]["remove"] = (loginId) =>
    Effect.gen(function* () {
      const login = yield* known(loginId);
      yield* endLogin(login);
      yield* zeropsLogins.forget(login.id);
    });

  return Effect.succeed(ZeropsSignOut.of({ signOut, remove }));
};

/**
 * Shares the SAME `ZeropsAgentAuth` / `ZeropsAgentLogin` / `ZeropsAgentFlag` /
 * `ZeropsLogins` instances every other Zerops feed uses: they are
 * requirements here, never provided by this layer, so `zeropsFeedsLayer.ts`'s
 * one construction of each is what runs. A second copy would cancel logins and
 * re-check auth against a feed nothing else reads.
 */
export const layer = Layer.effect(
  ZeropsSignOut,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const orchestration = yield* OrchestrationEngineService;
    const crypto = yield* Crypto.Crypto;
    const projection = yield* ProjectionSnapshotQuery;
    const homeDir = NodeOS.homedir();

    const engine = yield* MateEngine;
    const stopSessions = engine.live
      ? stopSessionsOnEngine(engine)
      : stopSessionsVia({
          threads: projection.getShellSnapshot().pipe(
            Effect.map((shell) => shell.threads),
            Effect.catchCause((cause) =>
              Effect.logWarning("zerops sign-out: could not read the shell snapshot", {
                cause,
              }).pipe(Effect.as([])),
            ),
          ),
          isLive: (threadId) =>
            projection.getThreadShellById(threadId).pipe(
              Effect.map(
                Option.match({
                  onNone: () => false,
                  onSome: (thread) =>
                    thread.session !== null && thread.session.status !== "stopped",
                }),
              ),
              Effect.catchCause(() => Effect.succeed(false)),
            ),
          stop: (threadId) =>
            Effect.gen(function* () {
              const createdAt = DateTime.formatIso(yield* DateTime.now);
              yield* orchestration.dispatch({
                type: "thread.session.stop",
                commandId: CommandId.make(
                  `server:sign-out:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`,
                ),
                threadId,
                createdAt,
              });
            }),
        });

    return yield* make({
      isZeropsEnvironment: isZeropsEnvironment(config),
      zeropsAgentAuth: yield* ZeropsAgentAuth,
      zeropsAgentLogin: yield* ZeropsAgentLogin,
      zeropsAgentFlag: yield* ZeropsAgentFlag,
      zeropsLogins: yield* ZeropsLogins,
      stopSessions,
      runLogout: (login) => {
        const { command, args } = LOGOUT_COMMAND[login.agent];
        return processRunner
          .run({
            command,
            args,
            cwd: config.cwd,
            ...(login.home === undefined
              ? {}
              : { env: { ...mateLoginEnvironment({ agent: login.agent, home: login.home }) } }),
            timeout: LOGOUT_TIMEOUT,
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: LOGOUT_MAX_OUTPUT_BYTES,
            outputMode: "truncate",
          })
          .pipe(
            Effect.map((result) => ({ success: result.code === 0 })),
            Effect.tapError((cause) =>
              Effect.logWarning("zerops sign-out: logout spawn failed", { ...login, cause }),
            ),
            Effect.orElseSucceed(() => ({ success: false })),
          );
      },
      agentCredentialPath: (agentId) => path.join(homeDir, ...AGENT_CREDENTIAL_SEGMENTS[agentId]),
      credentialExists: (file) => fs.exists(file).pipe(Effect.orElseSucceed(() => false)),
      removeCredential: (file) => fs.remove(file, { force: true }),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
