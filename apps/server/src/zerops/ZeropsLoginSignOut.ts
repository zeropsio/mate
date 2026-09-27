/**
 * ZeropsLoginSignOut — signing out, and removing, a login beyond the two
 * defaults (crew mode's *Runs on*, PRD §2.3).
 *
 * The defaults sign out through `ZeropsAgentSignOut`, which also clears the
 * agent's platform flag. A login beyond them has no flag — the flag is its
 * agent's — so its sign-out is the rest of the same order, against its own
 * home: cancel its login session, stop the live sessions running on it (a
 * running turn keeps the token it holds, measured 2026-09-22), run the CLI's
 * own logout with that home, remove the credential if the logout left it,
 * and re-check the login. Every step is best-effort once the login is known.
 *
 * An API key has no sign-in to end: it is removed, which drops the key with
 * its instance. Removing an account signs it out first. Neither touches the
 * signer tag: this container's key cannot write tags, and a tag for a login
 * that no longer exists speaks for nobody.
 *
 * @module ZeropsLoginSignOut
 */
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ZeropsAgentLoginError,
  type OrchestrationThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import {
  mateLoginCredentialPath,
  mateLoginEnvironment,
  ZeropsLogins,
  type MateLogin,
} from "./ZeropsLogins.ts";
import { LOGIN_DRIVER_KIND } from "./zeropsLoginIds.ts";

/** The same CLI logouts `ZeropsAgentSignOut` runs, with the login's home in the environment. */
const LOGOUT_COMMAND: Readonly<
  Record<MateLogin["agent"], { readonly command: string; readonly args: ReadonlyArray<string> }>
> = {
  "claude-code": { command: "claude", args: ["auth", "logout"] },
  codex: { command: "codex", args: ["logout"] },
};

const LOGOUT_TIMEOUT = Duration.seconds(15);
const LOGOUT_MAX_OUTPUT_BYTES = 16 * 1024;

/** The two default instances' ids — `zerops.login.remove` refuses them. */
const DEFAULT_LOGIN_IDS: ReadonlySet<string> = new Set(
  Object.values(LOGIN_DRIVER_KIND).map((driver) =>
    defaultInstanceIdForDriver(ProviderDriverKind.make(driver)),
  ),
);

/**
 * Which of `threads`' live sessions run on the login `loginId` — by the
 * session's own instance, falling back to the thread's selection only when
 * the session names none, as `threadsToStopForAgent` does for an agent.
 */
export const threadsToStopForLogin = (
  threads: ReadonlyArray<Pick<OrchestrationThreadShell, "id" | "modelSelection" | "session">>,
  loginId: string,
): ReadonlyArray<ThreadId> =>
  threads
    .filter((thread) => thread.session !== null && thread.session.status !== "stopped")
    .filter(
      (thread) =>
        (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId) === loginId,
    )
    .map((thread) => thread.id);

export class ZeropsLoginSignOut extends Context.Service<
  ZeropsLoginSignOut,
  {
    /** `stopSessions` is `ws.ts`'s, as for `ZeropsAgentSignOut`: only it can dispatch the stops. */
    readonly signOut: (
      loginId: string,
      stopSessions: () => Effect.Effect<void>,
    ) => Effect.Effect<void, ZeropsAgentLoginError>;
    /** Signs the login out (an account), then forgets it: its instance, its key, its home. */
    readonly remove: (
      loginId: string,
      stopSessions: () => Effect.Effect<void>,
    ) => Effect.Effect<void, ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsLoginSignOut") {}

export interface ZeropsLoginSignOutOptions {
  readonly isZeropsEnvironment: boolean;
  readonly zeropsLogins: Pick<ZeropsLogins["Service"], "resolve" | "recheckNow" | "forget">;
  readonly zeropsAgentLogin: Pick<ZeropsAgentLogin["Service"], "cancel">;
  /** The CLI's own logout, with the login's home. `success: false` covers every failure. */
  readonly runLogout: (login: MateLogin) => Effect.Effect<{ readonly success: boolean }>;
  readonly credentialExists: (path: string) => Effect.Effect<boolean>;
  readonly removeCredential: (path: string) => Effect.Effect<void>;
}

const logAndContinue = (label: string, loginId: string) => (cause: unknown) =>
  Effect.logWarning(`zerops login sign-out: ${label}`, { loginId, cause });

const unavailableError = new ZeropsAgentLoginError({
  reason: "unavailable",
  detail: "This environment keeps no logins beyond the two default ones.",
});

/** The service where there is no Zerops project: nothing to sign out or remove. */
export const unavailable = ZeropsLoginSignOut.of({
  signOut: () => Effect.fail(unavailableError),
  remove: () => Effect.fail(unavailableError),
});

export const make = (options: ZeropsLoginSignOutOptions) => {
  if (!options.isZeropsEnvironment) return Effect.succeed(unavailable);
  const { zeropsLogins, zeropsAgentLogin, runLogout, credentialExists, removeCredential } = options;

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

  /** Everything after the login is known — best-effort, in order. */
  const endSignIn = (login: MateLogin, stopSessions: () => Effect.Effect<void>) =>
    Effect.gen(function* () {
      if (login.kind === "subscription") {
        yield* zeropsAgentLogin
          .cancel(login.agent, login.id)
          .pipe(Effect.catch(logAndContinue("could not cancel the login session", login.id)));
      }
      yield* stopSessions().pipe(
        Effect.catchCause(logAndContinue("could not stop live provider sessions", login.id)),
      );
      if (login.kind === "apiKey") return;
      const credential = mateLoginCredentialPath(login);
      const logout = yield* runLogout(login);
      const credentialLeft = logout.success ? yield* credentialExists(credential) : true;
      if (credentialLeft) yield* removeCredential(credential);
    });

  const signOut: ZeropsLoginSignOut["Service"]["signOut"] = (loginId, stopSessions) =>
    Effect.gen(function* () {
      const login = yield* known(loginId);
      if (login.kind === "apiKey") {
        return yield* new ZeropsAgentLoginError({
          reason: "invalid-login",
          detail: "An API key has no sign-in to end: remove the login instead.",
        });
      }
      yield* endSignIn(login, stopSessions);
      yield* zeropsLogins.recheckNow(login.id);
    });

  const remove: ZeropsLoginSignOut["Service"]["remove"] = (loginId, stopSessions) =>
    Effect.gen(function* () {
      const login = yield* known(loginId);
      yield* endSignIn(login, stopSessions);
      yield* zeropsLogins.forget(login.id);
    });

  return Effect.succeed(ZeropsLoginSignOut.of({ signOut, remove }));
};

export const layer = Layer.effect(
  ZeropsLoginSignOut,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;
    return yield* make({
      isZeropsEnvironment: isZeropsEnvironment(config),
      zeropsLogins: yield* ZeropsLogins,
      zeropsAgentLogin: yield* ZeropsAgentLogin,
      runLogout: (login) => {
        const { command, args } = LOGOUT_COMMAND[login.agent];
        return processRunner
          .run({
            command,
            args,
            cwd: config.cwd,
            env: { ...mateLoginEnvironment(login) },
            timeout: LOGOUT_TIMEOUT,
            timeoutBehavior: "timedOutResult",
            maxOutputBytes: LOGOUT_MAX_OUTPUT_BYTES,
            outputMode: "truncate",
          })
          .pipe(
            Effect.map((result) => ({ success: result.code === 0 })),
            Effect.tapError((cause) =>
              Effect.logWarning("zerops login sign-out: logout spawn failed", {
                loginId: login.id,
                cause,
              }),
            ),
            Effect.orElseSucceed(() => ({ success: false })),
          );
      },
      credentialExists: (path) => fs.exists(path).pipe(Effect.orElseSucceed(() => false)),
      removeCredential: (path) =>
        fs.remove(path, { force: true }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("zerops login sign-out: could not remove the credential", {
              path,
              cause,
            }),
          ),
        ),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
