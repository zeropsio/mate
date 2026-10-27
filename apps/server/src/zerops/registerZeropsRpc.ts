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
  type CrewProposalInput,
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
import * as ZeropsMacStreamModule from "./ZeropsMacStream.ts";
import { zeropsUserIdOf } from "./zeropsSubject.ts";
import * as ZeropsDataConsoleModule from "./ZeropsDataConsole.ts";
import type * as ZeropsCrewProposalsModule from "./ZeropsCrewProposals.ts";
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
  | typeof WS_METHODS.subscribeZeropsMacStream
  | typeof WS_METHODS.zeropsMacInput
  | typeof WS_METHODS.zeropsMacForget
  | typeof WS_METHODS.zeropsMateUpdate
  | typeof WS_METHODS.zeropsMateCheckUpdate
  | typeof WS_METHODS.zeropsDataConsoleCall
  | typeof WS_METHODS.zeropsGitProbeRemote
  | typeof WS_METHODS.zeropsCrewPropose
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
  readonly zeropsMacStream: ZeropsMacStreamModule.ZeropsMacStream["Service"];
  readonly zeropsCli: ZeropsCli["Service"];
  readonly zeropsMateUpdate: ZeropsMateUpdate["Service"];
  /** Whether this server is running inside a Zerops project (spec-mate.md §2.9 MU-2). */
  readonly isZeropsEnvironment: boolean;
  /** This server's own version, read before `zcp mate update` runs. */
  readonly serverVersion: string;
  /** This server's boot: every answer to Update names it, so a reboot is judged against it. */
  readonly bootId?: string | undefined;
  readonly zeropsDataConsole: ZeropsDataConsoleModule.ZeropsDataConsole["Service"];
  readonly zeropsGitRemoteProbe: ZeropsGitRemoteProbeModule.ZeropsGitRemoteProbe["Service"];
  /** *Let Fen suggest a crew*: a roster from the goal, on the Mate's own agent. */
  readonly zeropsCrewProposals: ZeropsCrewProposalsModule.ZeropsCrewProposals["Service"];
  /**
   * The connecting session's subject — the Zerops user id the door put on the
   * grant. Taken from the authenticated session in `ws.ts`, never from RPC
   * input: a client that could name its own subject could claim to be anyone.
   */
  readonly subject: string;
  /**
   * `ws.ts`'s update admission: while a Mate update waits, a call that changes something is
   * refused (or, for a continuation, let through) so the update starts once work is done.
   */
  readonly admit: <A, E, R>(
    method: string,
    effect: Effect.Effect<A, E, R>,
    updateContinuation?: boolean,
  ) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;
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
    "zeropsCli" | "zeropsMateUpdate" | "isZeropsEnvironment" | "serverVersion" | "bootId"
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
    // Every answer names the boot that gave it, so the client judges a reboot against it.
    const boot = deps.bootId === undefined ? {} : { bootId: deps.bootId };
    // Only a container restart gets this Mate current: the same verb restarts it once idle, and
    // the answer says so, whatever the client read before it pressed.
    if ((yield* deps.zeropsMateUpdate.current)?.restart?.needed === true) {
      const start = yield* deps.zeropsMateUpdate.restart;
      return start.started
        ? {
            action: "none" as const,
            restarted: false,
            started: true,
            restartAttempt: start.attempt,
            restartTarget: start.target,
            ...boot,
            serverVersion,
          }
        : {
            action: "none" as const,
            restarted: false,
            error: start.reason,
            ...boot,
            serverVersion,
          };
    }
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
    return { ...result, ...boot, serverVersion };
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

/**
 * A personal login acts for its person alone (D6, `ZeropsProjectSigners`): the member this server
 * saw sign it in alone checks it, registers it again, signs it out or removes it, and the member
 * who started a sign-in still running on it alone cancels it or enters its code. A login nobody
 * signed in through Mate — a project token, no record — names nobody, and stays every member's.
 */
const refuseOthers = (subject: string, person: string | undefined, detail: string) =>
  person !== undefined && person !== zeropsUserIdOf(subject)
    ? Effect.fail(new ZeropsAgentLoginError({ reason: "invalid-login", detail }))
    : Effect.void;

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
    yield* refuseOthers(
      deps.subject,
      signer,
      "Only the member who signed this login in can check or register it again.",
    );
    yield* input.loginId === undefined
      ? deps.zeropsAgentAuth.recheckNow(input.agentId)
      : deps.zeropsLogins.recheckNow(input.loginId);
  });

type LoginActionDeps = {
  readonly subject: string;
  readonly zeropsAgentAuth: Pick<ZeropsAgentAuth.ZeropsAgentAuth["Service"], "latest">;
  readonly zeropsLogins: Pick<ZeropsLoginsModule.ZeropsLogins["Service"], "latest">;
  readonly zeropsAgentLogin: Pick<
    ZeropsAgentLoginModule.ZeropsAgentLogin["Service"],
    "latest" | "cancel" | "submitCode"
  >;
  readonly zeropsSignOut: ZeropsSignOutModule.ZeropsSignOut["Service"];
};

/** Who this server saw sign the login in: an agent's own from its row, another from its own. */
const signerOf = (deps: LoginActionDeps, agentId: ZeropsAgentId | undefined, loginId?: string) =>
  loginId === undefined
    ? deps.zeropsAgentAuth.latest.pipe(
        Effect.map(
          (snapshot) =>
            snapshot.agents.find((row) => row.agentId === agentId)?.authorizedBy?.subject,
        ),
      )
    : deps.zeropsLogins.latest.pipe(
        Effect.map((rows) => rows.find((row) => row.id === loginId)?.signedInBy),
      );

const FINISHED_SIGN_IN: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

/** Who started the sign-in still running on the login; none once it finished. */
const starterOf = (deps: LoginActionDeps, agentId: ZeropsAgentId, loginId?: string) =>
  deps.zeropsAgentLogin.latest.pipe(
    Effect.map((logins) => {
      const login = logins[loginId ?? agentId];
      return login === undefined || FINISHED_SIGN_IN.has(login.phase) ? undefined : login.startedBy;
    }),
  );

export const runAgentLoginCancel = (
  deps: LoginActionDeps,
  input: { readonly agentId: ZeropsAgentId; readonly loginId?: string | undefined },
) =>
  starterOf(deps, input.agentId, input.loginId).pipe(
    Effect.flatMap((starter) =>
      refuseOthers(
        deps.subject,
        starter,
        "Only the member who started this sign-in can cancel it.",
      ),
    ),
    Effect.andThen(deps.zeropsAgentLogin.cancel(input.agentId, input.loginId)),
  );

export const runAgentLoginSubmitCode = (
  deps: LoginActionDeps,
  input: {
    readonly agentId: ZeropsAgentId;
    readonly code: string;
    readonly loginId?: string | undefined;
  },
) =>
  starterOf(deps, input.agentId, input.loginId).pipe(
    Effect.flatMap((starter) =>
      refuseOthers(
        deps.subject,
        starter,
        "Only the member who started this sign-in can enter its code.",
      ),
    ),
    Effect.andThen(deps.zeropsAgentLogin.submitCode(input.agentId, input.code, input.loginId)),
  );

export const runAgentLoginSignOut = (
  deps: LoginActionDeps,
  input: { readonly agentId: ZeropsAgentId; readonly loginId?: string | undefined },
) =>
  signerOf(deps, input.agentId, input.loginId).pipe(
    Effect.flatMap((signer) =>
      refuseOthers(
        deps.subject,
        signer,
        "Only the member who signed this login in can sign it out.",
      ),
    ),
    Effect.andThen(
      deps.zeropsSignOut.signOut(
        input.loginId === undefined ? { agentId: input.agentId } : { loginId: input.loginId },
      ),
    ),
  );

export const runLoginRemove = (deps: LoginActionDeps, input: { readonly id: string }) =>
  signerOf(deps, undefined, input.id).pipe(
    Effect.flatMap((signer) =>
      refuseOthers(deps.subject, signer, "Only the member who signed this login in can remove it."),
    ),
    Effect.andThen(deps.zeropsSignOut.remove(input.id)),
  );

/**
 * `zerops.crew.propose`: a crew proposed from the goal, as the connecting
 * session — never as anyone the input names. It changes nothing, yet it
 * spends the Mate's agent, so it waits behind a pending update like any work.
 */
export const runCrewPropose = (
  deps: Pick<RegisterZeropsRpcDeps, "zeropsCrewProposals" | "subject" | "admit">,
  input: CrewProposalInput,
) =>
  deps.admit(WS_METHODS.zeropsCrewPropose, deps.zeropsCrewProposals.propose(input, deps.subject));

/** Registers the Zerops feed RPCs. Called once from `ws.ts`. */
export const registerZeropsRpc = (deps: RegisterZeropsRpcDeps): ZeropsRpcHandlers => {
  const {
    zeropsLifecycle,
    zeropsAgentAuth,
    zeropsAgentLogin,
    zeropsSignOut,
    zeropsLogins,
    zeropsBrowserStream,
    zeropsMacStream,
    zeropsMateAttention,
    zeropsDataConsole,
    zeropsGitRemoteProbe,
    subject,
    admit,
  } = deps;

  return {
    [WS_METHODS.zeropsStandUpRetry]: () =>
      admit(
        WS_METHODS.zeropsStandUpRetry,
        deps.zeropsSetup?.retry(subject) ?? Effect.succeed(false),
      ),
    [WS_METHODS.zeropsLifecycleGet]: (input) => zeropsLifecycle.get(input.threadId),
    [WS_METHODS.zeropsAgentAuthCheck]: (input) =>
      admit(WS_METHODS.zeropsAgentAuthCheck, runAgentAuthCheck(deps, input)),
    [WS_METHODS.zeropsAgentLoginStart]: (input) =>
      admit(
        WS_METHODS.zeropsAgentLoginStart,
        input.loginId === undefined
          ? zeropsAgentLogin.start(input.agentId, input.threadId, subject)
          : resolveLoginTarget(zeropsLogins, input.agentId, input.loginId).pipe(
              Effect.flatMap((login) =>
                zeropsAgentLogin.start(input.agentId, input.threadId, subject, login),
              ),
            ),
      ),
    [WS_METHODS.zeropsAgentLoginCancel]: (input) =>
      admit(WS_METHODS.zeropsAgentLoginCancel, runAgentLoginCancel(deps, input)),
    // The code rides only into the login terminal: no span attribute or log
    // line here names it.
    [WS_METHODS.zeropsAgentLoginSubmitCode]: (input) =>
      admit(WS_METHODS.zeropsAgentLoginSubmitCode, runAgentLoginSubmitCode(deps, input)),
    [WS_METHODS.zeropsAgentLoginSignOut]: (input) =>
      admit(WS_METHODS.zeropsAgentLoginSignOut, runAgentLoginSignOut(deps, input)),
    // The API key rides only into the settings' secret store: no span
    // attribute or log line here names it.
    [WS_METHODS.zeropsLoginAdd]: (input) =>
      admit(WS_METHODS.zeropsLoginAdd, zeropsLogins.add(input, subject)),
    [WS_METHODS.zeropsLoginRemove]: (input) =>
      admit(WS_METHODS.zeropsLoginRemove, runLoginRemove(deps, input)),
    [WS_METHODS.subscribeZeropsLifecycle]: (input) =>
      Stream.unwrap(
        Effect.map(zeropsLifecycle.subscribe(input.threadId), ({ latest, changes }) =>
          Stream.concat(Stream.make(latest), changes),
        ),
      ),
    [WS_METHODS.subscribeZeropsAgentAuth]: (_input) =>
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
    [WS_METHODS.subscribeZeropsHealth]: (_input) => zeropsMateAttention.healthChanges,
    [WS_METHODS.subscribeZeropsAttention]: (_input) => zeropsMateAttention.changes,
    [WS_METHODS.subscribeZeropsBrowserStream]: (input) =>
      Stream.unwrap(zeropsBrowserStream.subscribe).pipe(
        Stream.filter((event) => input.callFrames === true || event.type !== "call-result"),
      ),
    [WS_METHODS.subscribeZeropsMacStream]: (_input) => Stream.unwrap(zeropsMacStream.subscribe),
    [WS_METHODS.zeropsMacInput]: (input) =>
      admit(WS_METHODS.zeropsMacInput, zeropsMacStream.sendInput(input)),
    [WS_METHODS.zeropsMacForget]: () => admit(WS_METHODS.zeropsMacForget, zeropsMacStream.forget),
    [WS_METHODS.zeropsMateUpdate]: (_input) =>
      admit(WS_METHODS.zeropsMateUpdate, runZeropsMateUpdate(deps)),
    [WS_METHODS.zeropsMateCheckUpdate]: (_input) => runZeropsMateCheckUpdate(deps),
    [WS_METHODS.zeropsDataConsoleCall]: (input) => zeropsDataConsole.call(input),
    [WS_METHODS.zeropsGitProbeRemote]: (input) => zeropsGitRemoteProbe.probe(input),
    [WS_METHODS.zeropsCrewPropose]: (input) => runCrewPropose(deps, input),
    [WS_METHODS.subscribeZeropsDataConsole]: (_input) => Stream.unwrap(zeropsDataConsole.subscribe),
  } satisfies ZeropsRpcHandlers;
};
