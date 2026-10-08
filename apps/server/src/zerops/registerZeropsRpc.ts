/**
 * Registers the Zerops feed RPCs (`zerops.lifecycle.get`,
 * `zerops.agentLogin.start`/`cancel`/`submitCode`/`signOut`,
 * `zerops.login.add`/`remove`, `subscribeZeropsLifecycle`,
 * `subscribeZeropsAgentAuth`) — pulled out of the
 * giant `WsRpcGroup.of({...})` literal in `ws.ts` so the zone owns its own
 * RPC wiring (audit C4). Same handlers, same instrumentation, same scopes —
 * `auth/RpcAuthorization.ts` still owns the scope table, unchanged. S8b adds
 * its stream and input RPC here when it lands.
 */
import {
  AuthExecOperateScope,
  WS_METHODS,
  EnvironmentAuthorizationError,
  ZeropsAgentLoginError,
  ZeropsMateUpdateError,
  type WsRpcGroup,
  type ZeropsAgentId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";

import type { ZeropsSetup } from "./ZeropsSetup.ts";
import type { ZeropsCli } from "./ZeropsCli.ts";
import type { ZeropsMateUpdate } from "./ZeropsMateUpdate.ts";
import * as ZeropsAgentAuth from "./ZeropsAgentAuth.ts";
import * as ZeropsAgentLoginModule from "./ZeropsAgentLogin.ts";
import * as ZeropsBrowserStreamModule from "./ZeropsBrowserStream.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import type * as ZeropsGitRemoteProbeModule from "./ZeropsGitRemoteProbe.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import * as ZeropsLoginsModule from "./ZeropsLogins.ts";
import type * as ZeropsMateAttentionModule from "./ZeropsMateAttention.ts";
import type * as ZeropsSignOutModule from "./ZeropsSignOut.ts";

type ZeropsRpcTag =
  | typeof WS_METHODS.zeropsStandUpRetry
  | typeof WS_METHODS.zeropsLifecycleGet
  | typeof WS_METHODS.zeropsAgentAuthCheck
  | typeof WS_METHODS.zeropsAgentLoginStart
  | typeof WS_METHODS.zeropsAgentLoginCancel
  | typeof WS_METHODS.zeropsAgentLoginSubmitCode
  | typeof WS_METHODS.zeropsAgentLoginSignOut
  | typeof WS_METHODS.zeropsLoginAdd
  | typeof WS_METHODS.zeropsLoginRemove
  | typeof WS_METHODS.subscribeZeropsLifecycle
  | typeof WS_METHODS.subscribeZeropsAgentAuth
  | typeof WS_METHODS.subscribeZeropsHealth
  | typeof WS_METHODS.subscribeZeropsAttention
  | typeof WS_METHODS.subscribeZeropsBrowserStream
  | typeof WS_METHODS.zeropsBrowserInput
  | typeof WS_METHODS.zeropsMateUpdate
  | typeof WS_METHODS.zeropsMateCheckUpdate
  | typeof WS_METHODS.zeropsDataConsoleCall
  | typeof WS_METHODS.zeropsGitProbeRemote
  | typeof WS_METHODS.subscribeZeropsDataConsole;

type ZeropsRpc = Extract<RpcGroup.Rpcs<typeof WsRpcGroup>, { readonly _tag: ZeropsRpcTag }>;

/**
 * The handler function types `WsRpcGroup.of({...})` expects for exactly
 * these five tags. `Rpc.ToHandlerFn`'s own `Services` parameter defaults to
 * `any`; every collaborator here is already a resolved service (no `R` left
 * to satisfy), so it is pinned to `never` instead — an `any` requirements
 * channel is a type error in this codebase (`effect(anyInRequirementsChannel)`).
 */
export type ZeropsRpcHandlers = {
  readonly [Current in ZeropsRpc as Current["_tag"]]: Rpc.ToHandlerFn<Current, never>;
};

export interface RegisterZeropsRpcDeps {
  readonly zeropsSetup?: ZeropsSetup["Service"] | undefined;
  readonly zeropsLifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"];
  readonly zeropsAgentAuth: ZeropsAgentAuth.ZeropsAgentAuth["Service"];
  readonly zeropsAgentLogin: ZeropsAgentLoginModule.ZeropsAgentLogin["Service"];
  readonly zeropsSignOut: ZeropsSignOutModule.ZeropsSignOut["Service"];
  readonly zeropsLogins: ZeropsLoginsModule.ZeropsLogins["Service"];
  /** The Mate's attention, the same instance the link to HQ sends up. */
  readonly zeropsMateAttention: ZeropsMateAttentionModule.ZeropsMateAttention["Service"];
  readonly zeropsBrowserStream: ZeropsBrowserStreamModule.ZeropsBrowserStream["Service"];
  readonly zeropsCli: ZeropsCli["Service"];
  readonly zeropsMateUpdate: ZeropsMateUpdate["Service"];
  /** Whether this server is running inside a Zerops project (spec-mate.md §2.9 MU-2). */
  readonly isZeropsEnvironment: boolean;
  /** This server's own version, read before `zcp mate update` runs. */
  readonly serverVersion: string;
  readonly zeropsDataConsole: ZeropsDataConsoleModule.ZeropsDataConsole["Service"];
  readonly zeropsGitRemoteProbe: ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe["Service"];
  /**
   * The connecting session's subject — the Zerops user id the door put on the
   * grant. Taken from the authenticated session in `ws.ts`, never from RPC
   * input: a client that could name its own subject could claim to be anyone.
   */
  readonly subject: string;
  /** `ws.ts`'s own scope-checked, metrics/trace-instrumented wrapper — same one every other RPC in the router goes through. */
  readonly observeRpcEffect: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
  readonly observeRpcStream: <A, E, R>(
    method: string,
    stream: Stream.Stream<A, E, R>,
    traceAttributes?: Readonly<Record<string, unknown>>,
  ) => Stream.Stream<A, E | EnvironmentAuthorizationError, R>;
}

/** `ProcessTimeoutError`'s message (processRunner.ts) always contains this phrase. */
const TIMEOUT_MESSAGE_MARKER = "timed out";

/**
 * `zerops.mate.update`'s handler (spec-mate.md §2.9 MU-2): offered only
 * inside a Zerops project with `zcp` on PATH — the RPC not being offered at
 * all, or the caller lacking `exec:operate`, surfaces as
 * {@link EnvironmentAuthorizationError}. `zcp` itself failing to run or
 * answer — a missing binary, a spawn failure, a timeout — is a different
 * cause and surfaces as {@link ZeropsMateUpdateError} instead, never
 * reported as an authorization problem. A failed `zcp mate update` (a
 * non-zero exit with parseable JSON) is neither of these: it reaches the
 * caller as a normal success carrying that JSON.
 */
export const runZeropsMateUpdate = (
  deps: Pick<
    RegisterZeropsRpcDeps,
    "zeropsCli" | "zeropsMateUpdate" | "isZeropsEnvironment" | "serverVersion"
  >,
) =>
  Effect.gen(function* () {
    if (!deps.isZeropsEnvironment) {
      return yield* new EnvironmentAuthorizationError({
        message: "zerops.mate.update is only available inside a Zerops project.",
        requiredScope: AuthExecOperateScope,
      });
    }
    const serverVersion = deps.serverVersion;
    const result = yield* deps.zeropsCli.mateUpdate().pipe(
      Effect.catchTags({
        ZeropsCliNotFound: () =>
          new ZeropsMateUpdateError({
            reason: "zcp-not-found",
            message: "zcp is not available in this environment.",
          }),
        ZeropsCliFailed: (error) =>
          new ZeropsMateUpdateError({
            reason: error.message.includes(TIMEOUT_MESSAGE_MARKER) ? "timed-out" : "zcp-failed",
            message: error.message,
          }),
      }),
    );
    if (result.action === "updated") {
      yield* deps.zeropsMateUpdate.refresh;
    }
    return { ...result, serverVersion };
  });

/**
 * `zerops.mate.checkUpdate`'s handler (spec-mate.md §2.9, "on demand"): the
 * same offered-only-inside-a-Zerops-project gate as
 * {@link runZeropsMateUpdate}, but a read — it re-reads the manifest via
 * {@link ZeropsMateUpdate}'s `check` and never runs `zcp mate update`
 * itself. `undefined` (MU-3, nothing to report) maps to `null`, never
 * fabricated.
 */
export const runZeropsMateCheckUpdate = (
  deps: Pick<RegisterZeropsRpcDeps, "zeropsMateUpdate" | "isZeropsEnvironment">,
) =>
  Effect.gen(function* () {
    if (!deps.isZeropsEnvironment) {
      return yield* new EnvironmentAuthorizationError({
        message: "zerops.mate.checkUpdate is only available inside a Zerops project.",
        requiredScope: AuthExecOperateScope,
      });
    }
    const result = yield* deps.zeropsMateUpdate.check;
    return result ?? null;
  });

/**
 * What a login-targeted `zerops.agentLogin.start` signs in: the login beyond
 * the defaults under `loginId`, an account of `agentId` — never an API key,
 * which has nothing to sign in, and never another agent's login.
 */
export const resolveLoginTarget = (
  zeropsLogins: Pick<ZeropsLoginsModule.ZeropsLogins["Service"], "resolve">,
  agentId: ZeropsAgentId,
  loginId: string,
) =>
  Effect.gen(function* () {
    const login = yield* zeropsLogins.resolve(loginId);
    if (login === undefined || login.agent !== agentId) {
      return yield* new ZeropsAgentLoginError({
        reason: "unknown-login",
        detail: "No such login of this agent on this project.",
      });
    }
    if (login.kind === "apiKey") {
      return yield* new ZeropsAgentLoginError({
        reason: "invalid-login",
        detail: "An API key login has nothing to sign in.",
      });
    }
    return { id: login.id, env: ZeropsLoginsModule.mateLoginEnvironment(login) };
  });

/** An operator asks once; the feed carries the resulting verification/registration receipt. */
export const runAgentAuthCheck = (
  deps: {
    readonly zeropsAgentAuth: Pick<
      ZeropsAgentAuth.ZeropsAgentAuth["Service"],
      "latest" | "recheckNow"
    >;
    readonly zeropsLogins: Pick<
      ZeropsLoginsModule.ZeropsLogins["Service"],
      "latest" | "resolve" | "recheckNow"
    >;
    readonly subject: string;
  },
  input: { readonly agentId: ZeropsAgentId; readonly loginId?: string | undefined },
) =>
  Effect.gen(function* () {
    const userId = deps.subject.startsWith("zerops-user:")
      ? deps.subject.slice("zerops-user:".length)
      : deps.subject;
    let signer: string | undefined;
    if (input.loginId === undefined) {
      const snapshot = yield* deps.zeropsAgentAuth.latest;
      const agent = snapshot.agents.find((row) => row.agentId === input.agentId);
      if (!snapshot.available || agent === undefined) {
        return yield* new ZeropsAgentLoginError({
          reason: "unavailable",
          detail: "This environment cannot check this login.",
        });
      }
      signer = agent.authorizedBy?.subject;
    } else {
      yield* resolveLoginTarget(deps.zeropsLogins, input.agentId, input.loginId);
      signer = (yield* deps.zeropsLogins.latest).find(
        (row) => row.id === input.loginId,
      )?.signedInBy;
    }
    if (signer !== undefined && signer !== userId) {
      return yield* new ZeropsAgentLoginError({
        reason: "invalid-login",
        detail: "Only the member who signed this login in can check or register it again.",
      });
    }
    yield* input.loginId === undefined
      ? deps.zeropsAgentAuth.recheckNow(input.agentId)
      : deps.zeropsLogins.recheckNow(input.loginId);
  });

/** Registers the Zerops feed RPCs. Called once from `ws.ts`. */
export const registerZeropsRpc = (deps: RegisterZeropsRpcDeps): ZeropsRpcHandlers => {
  const {
    zeropsLifecycle,
    zeropsAgentAuth,
    zeropsAgentLogin,
    zeropsSignOut,
    zeropsLogins,
    zeropsBrowserStream,
    zeropsMateAttention,
    zeropsDataConsole,
    zeropsGitRemoteProbe,
    subject,
    observeRpcEffect,
    observeRpcStream,
  } = deps;

  return {
    [WS_METHODS.zeropsStandUpRetry]: () =>
      observeRpcEffect(
        WS_METHODS.zeropsStandUpRetry,
        deps.zeropsSetup?.retry(subject) ?? Effect.succeed(false),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.zeropsLifecycleGet]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsLifecycleGet, zeropsLifecycle.get(input.threadId), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsAgentAuthCheck]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsAgentAuthCheck, runAgentAuthCheck(deps, input), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsAgentLoginStart]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsAgentLoginStart,
        input.loginId === undefined
          ? zeropsAgentLogin.start(input.agentId, input.threadId, subject)
          : resolveLoginTarget(zeropsLogins, input.agentId, input.loginId).pipe(
              Effect.flatMap((login) =>
                zeropsAgentLogin.start(input.agentId, input.threadId, subject, login),
              ),
            ),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.zeropsAgentLoginCancel]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsAgentLoginCancel,
        zeropsAgentLogin.cancel(input.agentId, input.loginId),
        { "rpc.aggregate": "zerops" },
      ),
    // The code rides only into the login terminal: no span attribute or log
    // line here names it.
    [WS_METHODS.zeropsAgentLoginSubmitCode]: (input) =>
      observeRpcEffect(
        WS_METHODS.zeropsAgentLoginSubmitCode,
        zeropsAgentLogin.submitCode(input.agentId, input.code, input.loginId),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.zeropsAgentLoginSignOut]: (input) => {
      const loginId = input.loginId;
      return observeRpcEffect(
        WS_METHODS.zeropsAgentLoginSignOut,
        zeropsSignOut.signOut(loginId === undefined ? { agentId: input.agentId } : { loginId }),
        { "rpc.aggregate": "zerops" },
      );
    },
    // The API key rides only into the settings' secret store: no span
    // attribute or log line here names it.
    [WS_METHODS.zeropsLoginAdd]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsLoginAdd, zeropsLogins.add(input, subject), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsLoginRemove]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsLoginRemove, zeropsSignOut.remove(input.id), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.subscribeZeropsLifecycle]: (input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsLifecycle,
        Stream.unwrap(
          Effect.map(zeropsLifecycle.subscribe(input.threadId), ({ latest, changes }) =>
            Stream.concat(Stream.make(latest), changes),
          ),
        ),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.subscribeZeropsAgentAuth]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsAgentAuth,
        // Merges `ZeropsAgentAuth`'s snapshot with `ZeropsAgentLogin`'s
        // per-login state (S7 follow-up F8) and `ZeropsLogins`' logins beyond
        // the defaults into the ONE stream the client reads. Subscribing to
        // all three FIRST (each returning its own value-at-subscribe-time
        // bundled with a live change stream — the same subscribe-before-
        // snapshot race the feeds' own `subscribe` already guards against)
        // avoids a gap between reading an initial value and starting to
        // listen; a later change from ANY source re-reads every feed's
        // `latest` fresh rather than trusting a stale captured value, since a
        // `Stream.merge`'d change only tells us SOMETHING moved, not which.
        Stream.unwrap(
          Effect.gen(function* () {
            const authSub = yield* zeropsAgentAuth.subscribe;
            const loginSub = yield* zeropsAgentLogin.subscribe;
            const extrasSub = yield* zeropsLogins.subscribe;
            const recombine = Effect.all([
              zeropsAgentAuth.latest,
              zeropsLogins.latest,
              zeropsAgentLogin.latest,
            ]).pipe(
              Effect.map(([snapshot, extras, logins]) =>
                ZeropsAgentLoginModule.combineAgentAuth(snapshot, extras, logins),
              ),
            );
            const initial = ZeropsAgentLoginModule.combineAgentAuth(
              authSub.latest,
              extrasSub.latest,
              loginSub.latest,
            );
            const changes = Stream.mergeAll(
              [
                Stream.map(authSub.changes, () => undefined),
                Stream.map(loginSub.changes, () => undefined),
                Stream.map(extrasSub.changes, () => undefined),
              ],
              { concurrency: "unbounded" },
            ).pipe(Stream.mapEffect(() => recombine));
            return Stream.concat(Stream.make(initial), changes);
          }),
        ),
        { "rpc.aggregate": "zerops" },
      ),
    [WS_METHODS.subscribeZeropsHealth]: (_input) =>
      observeRpcStream(WS_METHODS.subscribeZeropsHealth, zeropsMateAttention.healthChanges, {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.subscribeZeropsAttention]: (_input) =>
      observeRpcStream(WS_METHODS.subscribeZeropsAttention, zeropsMateAttention.changes, {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.subscribeZeropsBrowserStream]: (input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsBrowserStream,
        Stream.unwrap(zeropsBrowserStream.subscribe).pipe(
          Stream.filter((event) => input.callFrames === true || event.type !== "call-result"),
        ),
        {
          "rpc.aggregate": "zerops",
        },
      ),
    [WS_METHODS.zeropsBrowserInput]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsBrowserInput, zeropsBrowserStream.sendInput(input), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsMateUpdate]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsMateUpdate, runZeropsMateUpdate(deps), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsMateCheckUpdate]: (_input) =>
      observeRpcEffect(WS_METHODS.zeropsMateCheckUpdate, runZeropsMateCheckUpdate(deps), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsDataConsoleCall]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsDataConsoleCall, zeropsDataConsole.call(input), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.zeropsGitProbeRemote]: (input) =>
      observeRpcEffect(WS_METHODS.zeropsGitProbeRemote, zeropsGitRemoteProbe.probe(input), {
        "rpc.aggregate": "zerops",
      }),
    [WS_METHODS.subscribeZeropsDataConsole]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeZeropsDataConsole,
        Stream.unwrap(zeropsDataConsole.subscribe),
        {
          "rpc.aggregate": "zerops",
        },
      ),
  } satisfies ZeropsRpcHandlers;
};
