/**
 * ZeropsAgentSignOut — `zerops.agentLogin.signOut`: any client (web, later
 * mobile) can sign an agent out of this Mate, everywhere it is reachable.
 *
 * Steps, in order:
 *  a. refuse a token-authorized agent — an API key belongs to the project,
 *     not to a person, so there is nobody's sign-in to end (mirrors
 *     `ZeropsProjectSigners.turnRefusal`'s own D6 reasoning).
 *  b. cancel that agent's running server-driven login session, if any
 *     (`ZeropsAgentLogin.cancel`).
 *  c. stop that agent's live provider sessions, via the caller-supplied
 *     `stopAgentSessions` (see below) — required, not optional: measured
 *     live 2026-09-22 on project 111111, a running turn keeps working after
 *     its credential file is replaced (the provider holds its token in
 *     memory), so a sign-out that skipped this would leave the agent
 *     running on a session nothing else can see.
 *  d. run the CLI's own logout (`claude auth logout` / `codex logout`,
 *     idempotent — exits 0 even when not logged in); if it fails, or the
 *     credential file is still there afterwards, remove the file.
 *  e. `ZeropsAgentFlag.clearSignedIn` — deletes the platform flag row(s).
 *  f. `ZeropsAgentAuth.recheckNow` — a prompt re-evaluation. The credential
 *     watcher (from step d's file removal) and the env-store watcher (from
 *     step e's flag deletion, which the platform's live env store reflects
 *     within seconds) already reset the `markedOAuth` latch on their own —
 *     see `ZeropsAgentAuth.ts`'s `recomputeEnvStore` (S7 follow-up F2) — so
 *     a later sign-in writes the flag again without any extra code here.
 *
 * ## Why `stopAgentSessions` is a parameter, not a dependency this module resolves
 *
 * `apps/server/src/zerops/**` never imports `ProviderService`
 * (`server.ts`'s own `RuntimeDependenciesLive` doc comment, D3 SPI plan) and
 * this module does not touch `apps/server/src/provider/**` either. Stopping
 * a live session instead goes through the ORCHESTRATION layer — dispatching
 * `thread.session.stop` the same way a client's own archive/settle cleanup
 * does (`ws.ts`) — and that dispatch path (`normalizeDispatchCommand`,
 * the per-connection `dispatchNormalizedCommand`, `ProjectionSnapshotQuery`)
 * only exists inside `ws.ts`'s own per-connection scope, never as a
 * standalone service this layer could construct at boot. So `signOut` takes
 * `stopAgentSessions` as a caller-supplied thunk instead: `ws.ts` builds it
 * (using {@link threadsToStopForAgent}, the pure "which threads" selection
 * below, plus `agentIdForProviderInstance` from `@t3tools/contracts` — the
 * SAME helper the D6 turn-refusal gate in `ws.ts` already uses) and hands it
 * to `registerZeropsRpc.ts`'s handler, which passes it into this call.
 *
 * Every step but (a) is best-effort: once step (a) has cleared, sign-out
 * must make progress even when a downstream step fails (a login session
 * that refuses to cancel, a session-stop dispatch that errors, a CLI logout
 * that errors, a flag delete that cannot reach the API) — never leaving
 * stale state standing because one step stumbled. Every failure is logged,
 * never thrown; only step (a)'s refusal fails the RPC itself.
 *
 * Deliberately does NOT touch the D6 signer tag (`mate:signer:*`): the
 * Mate's own key cannot write project tags (`ZeropsProjectSigners.ts`'s own
 * module header), a stale tag is harmless (ownership reads "none" without a
 * credential), and the next sign-in's client replaces it.
 *
 * @module ZeropsAgentSignOut
 */
import {
  agentIdForProviderInstance,
  ZeropsAgentLoginError,
  type OrchestrationThreadShell,
  type ThreadId,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as NodeOS from "node:os";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsAgentAuthModule from "./ZeropsAgentAuth.ts";
import { ZeropsAgentAuth } from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentFlagModule from "./ZeropsAgentFlag.ts";
import { ZeropsAgentFlag } from "./ZeropsAgentFlag.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import { ZeropsAgentLogin } from "./ZeropsAgentLogin.ts";
import { AGENT_CREDENTIAL_SEGMENTS } from "./ZeropsProjectSigners.ts";

/** Generous for a local CLI logout — no network round trip, both CLIs are idempotent and exit fast when already signed out. */
const LOGOUT_TIMEOUT = Duration.seconds(15);
const LOGOUT_MAX_OUTPUT_BYTES = 16 * 1024;

/** One argv invocation per agent — never a shell string (same shape `ZeropsAgentAuthVerify.ts` uses for its own probes). */
const LOGOUT_COMMAND: Readonly<
  Record<ZeropsAgentId, { readonly command: string; readonly args: ReadonlyArray<string> }>
> = {
  "claude-code": { command: "claude", args: ["auth", "logout"] },
  codex: { command: "codex", args: ["logout"] },
};

/**
 * Which of `threads`' live sessions belong to `agentId` — by the same
 * `agentIdForProviderInstance` vocabulary `ws.ts`'s own D6 turn-refusal
 * already uses, never a second, hand-rolled agent<->instance mapping. A
 * thread with no session, or one already `"stopped"`, has nothing to stop —
 * matching the exact liveness check `ws.ts`'s archive/settle cleanup already
 * uses for the same reason.
 *
 * Keyed on the SESSION's own `providerInstanceId`, not the thread's current
 * `modelSelection` — a thread can be repointed at a different agent while a
 * session from the previous provider instance is still live, and it is that
 * live session which must stop. Falls back to `modelSelection.instanceId`
 * only when the session itself carries none (older/partial snapshots).
 */
export const threadsToStopForAgent = (
  threads: ReadonlyArray<Pick<OrchestrationThreadShell, "id" | "modelSelection" | "session">>,
  agentId: ZeropsAgentId,
): ReadonlyArray<ThreadId> =>
  threads
    .filter((thread) => thread.session !== null && thread.session.status !== "stopped")
    .filter(
      (thread) =>
        agentIdForProviderInstance(
          thread.session?.providerInstanceId ?? thread.modelSelection.instanceId,
        ) === agentId,
    )
    .map((thread) => thread.id);

/**
 * Polls `isLive` until it answers `false`, or `timeout` elapses — whichever
 * comes first. Never fails: a timeout is swallowed, since sign-out must
 * always continue best-effort even when a session cannot be confirmed
 * stopped in time. `ws.ts`'s `stopAgentSessions` supplies the real `isLive`
 * (a live projection read) and the real interval/timeout; exported here so
 * this polling behavior has its own test, independent of orchestration I/O.
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

export class ZeropsAgentSignOut extends Context.Service<
  ZeropsAgentSignOut,
  {
    /**
     * `stopAgentSessions` is supplied by the caller (`registerZeropsRpc.ts`,
     * fed from `ws.ts`) — see the module header's "Why `stopAgentSessions`
     * is a parameter" section. Never fails: the caller catches its own
     * dispatch errors, since a session already gone, or a dispatch that
     * errors, must not fail the whole sign-out.
     */
    readonly signOut: (
      agentId: ZeropsAgentId,
      stopAgentSessions: () => Effect.Effect<void>,
    ) => Effect.Effect<void, ZeropsAgentLoginError>;
  }
>()("t3/zerops/ZeropsAgentSignOut") {}

export interface ZeropsAgentSignOutOptions {
  readonly zeropsAgentAuth: Pick<
    ZeropsAgentAuth["Service"],
    "latest" | "recheckNow" | "invalidatePendingMark"
  >;
  readonly zeropsAgentLogin: Pick<ZeropsAgentLogin["Service"], "cancel">;
  readonly zeropsAgentFlag: Pick<ZeropsAgentFlag["Service"], "clearSignedIn">;
  /** Runs the CLI's own logout once. `success: false` covers every failure mode — a non-zero exit, a spawn error, a timeout. */
  readonly runLogout: (agentId: ZeropsAgentId) => Effect.Effect<{ readonly success: boolean }>;
  readonly credentialExists: (agentId: ZeropsAgentId) => Effect.Effect<boolean>;
  readonly removeCredential: (agentId: ZeropsAgentId) => Effect.Effect<void>;
  readonly isZeropsEnvironment: boolean;
}

const logAndContinue = (label: string, agentId: ZeropsAgentId) => (cause: unknown) =>
  Effect.logWarning(`zerops agent sign-out: ${label}`, { agentId, cause });

export const make = (options: ZeropsAgentSignOutOptions) => {
  const unavailable = new ZeropsAgentLoginError({
    reason: "unavailable",
    detail: "This environment does not offer a server-driven sign-out.",
  });

  if (!options.isZeropsEnvironment) {
    return Effect.succeed(
      ZeropsAgentSignOut.of({
        signOut: () => Effect.fail(unavailable),
      }),
    );
  }

  const {
    zeropsAgentAuth,
    zeropsAgentLogin,
    zeropsAgentFlag,
    runLogout,
    credentialExists,
    removeCredential,
  } = options;

  const signOut = (
    agentId: ZeropsAgentId,
    stopAgentSessions: () => Effect.Effect<void>,
  ): Effect.Effect<void, ZeropsAgentLoginError> =>
    Effect.gen(function* () {
      const snapshot = yield* zeropsAgentAuth.latest;
      const agent = snapshot.agents.find((entry) => entry.agentId === agentId);
      if (agent?.flagToken) {
        return yield* new ZeropsAgentLoginError({
          reason: "token-authorized",
          detail:
            "This agent is authorized with a project token, which belongs to the project — there is nothing to sign out.",
        });
      }

      yield* zeropsAgentLogin
        .cancel(agentId)
        .pipe(Effect.catch(logAndContinue("could not cancel the login session", agentId)));

      // `catchCause`, not `catch`: this is the one step that dispatches
      // through orchestration for possibly several threads at once, so it
      // gets the extra defect-safety net the other (simpler) steps don't
      // need — a session-stop dispatch going wrong must still never lose
      // the platform-flag clear that follows.
      yield* stopAgentSessions().pipe(
        Effect.catchCause(logAndContinue("could not stop live provider sessions", agentId)),
      );

      const logoutOutcome = yield* runLogout(agentId).pipe(
        Effect.catch(() => Effect.succeed({ success: false })),
      );
      const credentialStillThere = logoutOutcome.success
        ? yield* credentialExists(agentId).pipe(Effect.catch(() => Effect.succeed(false)))
        : true;
      if (credentialStillThere) {
        yield* removeCredential(agentId).pipe(
          Effect.catch(logAndContinue("could not remove the credential file", agentId)),
        );
      }

      // BEFORE clearing the flag: a `checkProviderAuth` probe already in
      // flight when sign-out started must not re-mark the flag this step
      // is about to clear once that stale probe finally answers
      // "authenticated" — see `ZeropsAgentAuth.ts`'s own doc comment on
      // `invalidatePendingMark`.
      yield* zeropsAgentAuth.invalidatePendingMark(agentId);

      yield* zeropsAgentFlag
        .clearSignedIn(agentId)
        .pipe(Effect.catch(logAndContinue("could not clear the platform flag", agentId)));

      yield* zeropsAgentAuth.recheckNow(agentId);
    });

  return Effect.succeed(ZeropsAgentSignOut.of({ signOut }));
};

const spawnLogout =
  (processRunner: ProcessRunner.ProcessRunner["Service"], cwd: string) =>
  (agentId: ZeropsAgentId): Effect.Effect<{ readonly success: boolean }> => {
    const { command, args } = LOGOUT_COMMAND[agentId];
    return processRunner
      .run({
        command,
        args,
        cwd,
        timeout: LOGOUT_TIMEOUT,
        timeoutBehavior: "timedOutResult",
        maxOutputBytes: LOGOUT_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) => ({ success: result.code === 0 })),
        Effect.tapError((cause) =>
          Effect.logWarning("zerops agent sign-out: logout spawn failed", { agentId, cause }),
        ),
        Effect.orElseSucceed(() => ({ success: false })),
      );
  };

/**
 * Shares the SAME `ZeropsAgentAuth` / `ZeropsAgentLogin` / `ZeropsAgentFlag`
 * instances every other Zerops feed uses — this layer declares them as
 * REQUIREMENTS (no `Layer.provide` of its own for any of the three) so
 * `zeropsFeedsLayer.ts`'s single construction of each is what actually runs,
 * exactly like `ZeropsAgentLogin.layer` itself does for `ZeropsAgentAuth`
 * (see that module's own layer doc comment). Building a second, independent
 * copy here would cancel logins and re-check auth against a feed nothing
 * else reads.
 */
export const layer = Layer.effect(
  ZeropsAgentSignOut,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const zeropsAgentAuth = yield* ZeropsAgentAuthModule.ZeropsAgentAuth;
    const zeropsAgentLogin = yield* ZeropsAgentLoginModule.ZeropsAgentLogin;
    const zeropsAgentFlag = yield* ZeropsAgentFlagModule.ZeropsAgentFlag;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const homeDir = NodeOS.homedir();

    const credentialPath = (agentId: ZeropsAgentId) =>
      path.join(homeDir, ...AGENT_CREDENTIAL_SEGMENTS[agentId]);

    return yield* make({
      zeropsAgentAuth,
      zeropsAgentLogin,
      zeropsAgentFlag,
      runLogout: spawnLogout(processRunner, config.cwd),
      credentialExists: (agentId) =>
        fs.exists(credentialPath(agentId)).pipe(Effect.orElseSucceed(() => false)),
      removeCredential: (agentId) =>
        fs
          .remove(credentialPath(agentId), { force: true })
          .pipe(Effect.orElseSucceed(() => undefined)),
      isZeropsEnvironment: isZeropsEnvironment(config),
    });
  }),
).pipe(Layer.provide(ProcessRunner.layer));
