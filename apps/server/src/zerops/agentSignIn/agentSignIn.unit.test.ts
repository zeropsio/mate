import { assert, expect, it } from "@effect/vitest";
import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
  type SpiEvent,
  type ZeropsAgentAuth,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import {
  parseClaudeAuthStatus,
  verifyAgentAuth,
  type AgentAuthProbeOutcome,
  type AgentAuthProbeSpawn,
} from "../ZeropsAgentAuthVerify.ts";
import {
  markSignedIn,
  planClearSignedIn,
  planMarkSignedIn,
  ZeropsAgentFlagError,
  type ServiceEnvRow,
} from "../ZeropsAgentFlag.ts";
import { resolveZeropsEnvironment } from "../ZeropsEnvironment.ts";
import type { MateLogin } from "../ZeropsLogins.ts";
import * as ZeropsMateKeyModule from "../ZeropsMateKey.ts";
import {
  make,
  type SignOutTarget,
  stopSessionsOnEngine,
  type ZeropsSignOutOptions,
} from "../ZeropsSignOut.ts";
import { overlayZeropsAgentAuth } from "../zeropsAgentProviderOverlay.ts";
import { turnAuthFailureAgent } from "../zeropsTurnAuthFailure.ts";

/** A refusal's `reason`, or `undefined` when the call succeeded. */
const refusalReason = <A, E extends { readonly reason: string }>(result: Result.Result<A, E>) =>
  Result.isFailure(result) ? result.failure.reason : undefined;

/** A fake Zerops API's view of a request body. */
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

// witness: apps/server/src/zerops/ZeropsAgentAuthVerify.ts |   if (typeof loggedIn !== "boolean") { →   if (loggedIn === undefined) {
it("ZS1: Claude's own status check counts as signed in only for a JSON object whose `loggedIn` is true and as signed out only for false; empty, unparsable, array or non-boolean output is unknown, and surrounding whitespace is ignored", () => {
  for (const [stdout, expected] of [
    ['{"loggedIn":true,"authMethod":"claude.ai"}', "authenticated"],
    ['{"loggedIn":false,"authMethod":"none"}', "unauthenticated"],
    ["", "unknown"],
    ["not json at all", "unknown"],
    ['{"authMethod":"claude.ai"}', "unknown"],
    ['{"loggedIn":"yes"}', "unknown"],
    ["[1,2,3]", "unknown"],
    ['\n  {"loggedIn":true}  \n', "authenticated"],
  ] as const) {
    expect(parseClaudeAuthStatus(stdout)).toBe(expected);
  }
});

// witness: apps/server/src/zerops/ZeropsAgentAuthVerify.ts | outcome.timedOut || outcome.reason ? "unknown" → outcome.reason ? "unknown"
it.effect(
  "ZS2: A Claude login check runs `claude auth status` once as an argument list, and one that timed out is unknown with a reason even when its output says signed in",
  () =>
    Effect.gen(function* () {
      for (const [answer, expected] of [
        [
          { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: "", code: 0 },
          { status: "authenticated", reasoned: false },
        ],
        [
          { stdout: '{"loggedIn":true}', stderr: "", code: 0, timedOut: true },
          { status: "unknown", reasoned: true },
        ],
      ] as const satisfies ReadonlyArray<
        readonly [AgentAuthProbeOutcome, { status: string; reasoned: boolean }]
      >) {
        const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
        const spawn: AgentAuthProbeSpawn = (command, args) => {
          calls.push({ command, args });
          return Effect.succeed(answer);
        };
        const result = yield* verifyAgentAuth("claude-code", {
          spawn,
          codexAccount: Effect.die("a Claude check asked Codex"),
        });
        expect(result.status).toBe(expected.status);
        expect(result.reason !== undefined).toBe(expected.reasoned);
        expect(calls).toEqual([{ command: "claude", args: ["auth", "status"] }]);
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsAgentFlag.ts |   if (!existing.sensitive && existing.content === "true") { →   if (existing.content === "true") {
it("ZS3: Marking an agent signed in creates its flag row when absent, leaves a readable row reading true, and replaces a row holding any other value or marked sensitive; another agent's row is never considered", () => {
  const row = (over: Partial<ServiceEnvRow>): ServiceEnvRow => ({
    id: "row-id",
    key: "SOME_KEY",
    content: "value",
    sensitive: false,
    ...over,
  });
  assert.deepStrictEqual(planMarkSignedIn([], "claude-code"), { action: "create" });
  assert.deepStrictEqual(
    planMarkSignedIn(
      [row({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true", sensitive: false })],
      "claude-code",
    ),
    { action: "noop" },
  );
  assert.deepStrictEqual(
    planMarkSignedIn(
      [row({ id: "old", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "false", sensitive: false })],
      "claude-code",
    ),
    { action: "recreate", deleteId: "old" },
  );
  assert.deepStrictEqual(
    planMarkSignedIn(
      [row({ id: "old", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true", sensitive: true })],
      "claude-code",
    ),
    { action: "recreate", deleteId: "old" },
  );
  assert.deepStrictEqual(
    planMarkSignedIn(
      [row({ key: "ZCP_AGENT_OAUTH_CODEX", content: "true", sensitive: false })],
      "claude-code",
    ),
    { action: "create" },
  );
});

// witness: apps/server/src/zerops/ZeropsAgentFlag.ts | authTypeRow.content === "oauth" ? authTypeRow.id : undefined → authTypeRow.content !== "" ? authTypeRow.id : undefined
it('ZS4: Signing an agent out deletes its signed-in row and its auth-type row only when that reads "oauth": a token\'s auth-type row stays', () => {
  const row = (over: Partial<ServiceEnvRow>): ServiceEnvRow => ({
    id: "row-id",
    key: "SOME_KEY",
    content: "value",
    sensitive: false,
    ...over,
  });
  assert.deepStrictEqual(planClearSignedIn([], "claude-code"), {
    deleteOAuthId: undefined,
    deleteAuthTypeId: undefined,
  });
  assert.deepStrictEqual(
    planClearSignedIn([row({ id: "oauth-1", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE" })], "claude-code"),
    { deleteOAuthId: "oauth-1", deleteAuthTypeId: undefined },
  );
  assert.deepStrictEqual(
    planClearSignedIn(
      [row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE", content: "oauth" })],
      "claude-code",
    ),
    { deleteOAuthId: undefined, deleteAuthTypeId: "type-1" },
  );
  assert.deepStrictEqual(
    planClearSignedIn(
      [row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE", content: "token" })],
      "claude-code",
    ),
    { deleteOAuthId: undefined, deleteAuthTypeId: undefined },
  );
  assert.deepStrictEqual(
    planClearSignedIn(
      [
        row({ id: "oauth-1", key: "ZCP_AGENT_OAUTH_CODEX" }),
        row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CODEX", content: "oauth" }),
      ],
      "codex",
    ),
    { deleteOAuthId: "oauth-1", deleteAuthTypeId: "type-1" },
  );
});

// witness: apps/server/src/zerops/ZeropsAgentFlag.ts | body: { key: input.key, content: input.content, sensitive: false }, → body: { key: input.key, content: input.content, sensitive: true },
it.effect(
  "ZS5: The signed-in flag is written on the Mate's own service as a readable (non-sensitive) row reading true",
  () =>
    Effect.gen(function* () {
      const SERVICE_ID = "Nq49woUlTBeFYdP0jg4DQA";
      const MATE_KEY = "the-mates-own-zerops-key";
      const environment = resolveZeropsEnvironment({
        projectId: "TEST000000000000000023",
        apiHost: undefined,
        apiToken: MATE_KEY,
      })!;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const seen: Array<{ readonly method: string; readonly url: string; readonly body: unknown }> =
        [];
      const layer = Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.sync(() => {
              let body: unknown;
              if (request.body._tag === "Uint8Array") {
                const text = request.body.text ?? new TextDecoder().decode(request.body.body);
                body = text.length > 0 ? decodeUnknownJson(text) : undefined;
              }
              seen.push({ method: request.method, url: request.url, body });
              const answer = request.url.includes("/process/")
                ? json({ status: "FINISHED" })
                : request.method === "GET"
                  ? json({ items: [] })
                  : json({ id: "process-1" });
              return HttpClientResponse.fromWeb(request, answer);
            }),
          ),
        ),
        Layer.succeed(
          ZeropsMateKeyModule.ZeropsMateKey,
          ZeropsMateKeyModule.snapshotOnlyReader(MATE_KEY),
        ),
      );
      yield* markSignedIn({
        environment,
        serviceId: SERVICE_ID,
        agentId: "claude-code",
        processes: Effect.succeed(Stream.never),
      }).pipe(Effect.provide(layer));
      assert.deepStrictEqual(
        seen.map((entry) => entry.method),
        ["GET", "POST", "GET"],
      );
      assert.deepStrictEqual(seen[1]?.body, {
        key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
        content: "true",
        sensitive: false,
      });
      assert.strictEqual(seen[1]?.url.endsWith(`/service-stack/${SERVICE_ID}/user-data`), true);
    }),
);

const TOKEN_AUTHORIZED_SNAPSHOT: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: false,
      flagToken: true,
      providerAuth: "authenticated",
      state: "authorized-token",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

const OAUTH_SNAPSHOT: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

/** An agent's sign-out over fakes that log each step as `[label, whose]`, in call order. */
const agentSignOutHarness = (input: {
  readonly snapshot?: ZeropsAgentAuthSnapshot;
  readonly cancelFails?: boolean;
  readonly stopSessionsFails?: boolean;
  readonly logoutSucceeds?: boolean;
  readonly credentialStillExists?: boolean;
  readonly clearSignedInFails?: boolean;
}) =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<readonly [string, string]>>([]);
    const record = (label: string, whose: string) =>
      Ref.update(log, (all) => [...all, [label, whose] as const]);
    const options: ZeropsSignOutOptions = {
      isZeropsEnvironment: true,
      zeropsAgentAuth: {
        latest: Effect.succeed(input.snapshot ?? OAUTH_SNAPSHOT),
        recheckNow: (agentId) => record("recheckNow", agentId),
        invalidatePendingMark: (agentId) => record("invalidatePendingMark", agentId),
      },
      zeropsAgentLogin: {
        cancel: (agentId) =>
          record("cancel", agentId).pipe(
            Effect.andThen(
              input.cancelFails
                ? Effect.fail({ _tag: "TerminalError", message: "boom" } as never)
                : Effect.void,
            ),
          ),
      },
      zeropsAgentFlag: {
        clearSignedIn: (agentId) =>
          record("clearSignedIn", agentId).pipe(
            Effect.andThen(
              input.clearSignedInFails
                ? Effect.fail(new ZeropsAgentFlagError({ reason: "down" }))
                : Effect.void,
            ),
          ),
      },
      zeropsLogins: {
        resolve: () => Effect.succeed(undefined as MateLogin | undefined),
        recheckNow: () => Effect.void,
        forget: () => Effect.void,
      },
      stopSessions: (target) =>
        record("stopSessions", "agentId" in target ? target.agentId : target.loginId).pipe(
          Effect.andThen(
            input.stopSessionsFails ? Effect.die(new Error("stop dispatch failed")) : Effect.void,
          ),
        ),
      runLogout: (login) =>
        record("runLogout", login.agent).pipe(Effect.as({ success: input.logoutSucceeds ?? true })),
      // An agent's own credential is named by its agent here, so a call names whose it was.
      agentCredentialPath: (agentId) => agentId,
      credentialExists: (path) =>
        record("credentialExists", path).pipe(Effect.as(input.credentialStillExists ?? false)),
      removeCredential: (path) => record("removeCredential", path),
    };
    const service = yield* make(options);
    const steps = Ref.get(log).pipe(Effect.map((all) => all.map(([label]) => label)));
    const called = (label: string) =>
      Ref.get(log).pipe(
        Effect.map((all) => all.filter(([step]) => step === label).map(([, whose]) => whose)),
      );
    return { service, steps, called };
  });

// witness: apps/server/src/zerops/ZeropsSignOut.ts | if (snapshot.agents.find((entry) => entry.agentId === agentId)?.flagToken) { → if (snapshot.agents.find((entry) => entry.agentId === agentId)?.flagOAuth) {
it.effect(
  "ZS6: An agent authorized by the project's token cannot be signed out, and the refusal cancels, stops, logs out and clears nothing",
  () =>
    Effect.gen(function* () {
      const { service, steps } = yield* agentSignOutHarness({
        snapshot: TOKEN_AUTHORIZED_SNAPSHOT,
      });
      const refused = yield* Effect.result(service.signOut({ agentId: "claude-code" }));
      assert.strictEqual(refusalReason(refused), "token-authorized");
      assert.deepStrictEqual(yield* steps, []);
    }),
);

// witness: apps/server/src/zerops/ZeropsSignOut.ts | const credentialLeft = logout.success ? yield* credentialExists(credential) : true; → const credentialLeft = logout.success ? yield* credentialExists(credential) : false;
it.effect(
  "ZS7: An agent's sign-out cancels its login, stops its sessions, runs its CLI logout, removes the credential file when the logout failed or left it, then invalidates the pending mark, clears the flag and rechecks, in that order, and a failing step never stops the next",
  () =>
    Effect.gen(function* () {
      const ordered = yield* agentSignOutHarness({
        logoutSucceeds: true,
        credentialStillExists: true,
      });
      yield* ordered.service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* ordered.steps, [
        "cancel",
        "stopSessions",
        "runLogout",
        "credentialExists",
        "removeCredential",
        "invalidatePendingMark",
        "clearSignedIn",
        "recheckNow",
      ]);
      assert.deepStrictEqual(yield* ordered.called("removeCredential"), ["claude-code"]);

      const gone = yield* agentSignOutHarness({
        logoutSucceeds: true,
        credentialStillExists: false,
      });
      yield* gone.service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* gone.called("credentialExists"), ["claude-code"]);
      assert.deepStrictEqual(yield* gone.called("removeCredential"), []);

      const failedLogout = yield* agentSignOutHarness({ logoutSucceeds: false });
      yield* failedLogout.service.signOut({ agentId: "claude-code" });
      assert.deepStrictEqual(yield* failedLogout.called("credentialExists"), []);
      assert.deepStrictEqual(yield* failedLogout.called("removeCredential"), ["claude-code"]);

      for (const [failing, reached] of [
        [{ cancelFails: true }, ["cancel", "stopSessions", "clearSignedIn", "recheckNow"]],
        [{ stopSessionsFails: true }, ["stopSessions", "runLogout", "clearSignedIn", "recheckNow"]],
        [{ clearSignedInFails: true }, ["clearSignedIn", "recheckNow"]],
      ] as const) {
        const harness = yield* agentSignOutHarness(failing);
        yield* harness.service.signOut({ agentId: "claude-code" });
        for (const step of reached) {
          assert.deepStrictEqual(yield* harness.called(step), ["claude-code"]);
        }
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsSignOut.ts |       if (DEFAULT_LOGIN_IDS.has(loginId)) { →       if (DEFAULT_LOGIN_IDS.has(loginId.toLowerCase())) {
it.effect(
  "ZS8: An API-key login is removed without a CLI but never signed out, an agent's own login cannot be removed, and an unknown login is refused",
  () =>
    Effect.gen(function* () {
      const WORK: MateLogin = {
        id: "claudeAgent-work",
        agent: "claude-code",
        kind: "subscription",
        label: "work",
        home: "/home/zerops/.mate/logins/claudeAgent-work",
        keyStored: false,
      };
      const KEY: MateLogin = {
        id: "claudeAgent-api-key",
        agent: "claude-code",
        kind: "apiKey",
        label: "",
        home: "/home/zerops/.mate/logins/claudeAgent-api-key",
        keyStored: true,
      };
      const order = yield* Ref.make<ReadonlyArray<string>>([]);
      const step = (label: string) => Ref.update(order, (all) => [...all, label]);
      const service = yield* make({
        isZeropsEnvironment: true,
        zeropsAgentAuth: {
          latest: Effect.succeed(OAUTH_SNAPSHOT),
          recheckNow: () => Effect.void,
          invalidatePendingMark: () => Effect.void,
        },
        zeropsAgentFlag: { clearSignedIn: () => Effect.void },
        agentCredentialPath: (agentId) => agentId,
        stopSessions: () => step("stop"),
        zeropsLogins: {
          resolve: (id) => Effect.succeed([WORK, KEY].find((login) => login.id === id)),
          recheckNow: (id) => step(`recheck:${id}`),
          forget: (id) => step(`forget:${id}`),
        },
        zeropsAgentLogin: {
          cancel: (agentId, loginId) => step(`cancel:${agentId}:${loginId}`),
        },
        runLogout: (login) => step(`logout:${login.home}`).pipe(Effect.as({ success: true })),
        credentialExists: (path) => step(`exists:${path}`).pipe(Effect.as(false)),
        removeCredential: (path) => step(`remove:${path}`),
      });

      const keySignOut = yield* Effect.result(service.signOut({ loginId: KEY.id }));
      assert.strictEqual(refusalReason(keySignOut), "invalid-login");
      assert.deepStrictEqual(yield* Ref.get(order), []);

      yield* service.remove(KEY.id);
      assert.deepStrictEqual(yield* Ref.get(order), ["stop", `forget:${KEY.id}`]);

      const unknown = yield* Effect.result(service.signOut({ loginId: "codex-gone" }));
      assert.strictEqual(refusalReason(unknown), "unknown-login");
      const own = yield* Effect.result(service.remove("claudeAgent"));
      assert.strictEqual(refusalReason(own), "default-login");
    }),
);

// witness: apps/server/src/zerops/ZeropsSignOut.ts | ? [...new Set([defaultInstanceIdForAgent(target.agentId), target.agentId])] → ? [defaultInstanceIdForAgent(target.agentId), target.agentId]
it.effect(
  "ZS9: A sign-out stops the sessions on each instance id the login is known by: an agent's default instance and its agent id, once when they are the same, and a further login's own id",
  () =>
    Effect.gen(function* () {
      for (const [target, expected] of [
        [{ agentId: "claude-code" }, ["claudeAgent", "claude-code"]],
        [{ agentId: "codex" }, ["codex"]],
        [{ loginId: "claudeAgent-work" }, ["claudeAgent-work"]],
      ] as const satisfies ReadonlyArray<readonly [SignOutTarget, ReadonlyArray<string>]>) {
        const calls: Array<{ instanceIds: ReadonlyArray<string>; cause: string }> = [];
        yield* stopSessionsOnEngine({
          stopSessionsOn: (instanceIds, cause) =>
            Effect.sync(() => void calls.push({ instanceIds, cause })),
        })(target);
        assert.deepStrictEqual(calls, [{ instanceIds: expected, cause: "sign-out" }]);
      }
    }),
);

// witness: apps/server/src/zerops/zeropsAgentProviderOverlay.ts | if (agent === undefined || !provider.enabled || !provider.installed) return provider; → if (agent === undefined || !provider.enabled) return provider;
it("ZS10: On Zerops the project's sign-in flag decides whether Claude Code or Codex can be picked: a signed-in agent is ready, keeping the driver's account details and a working agent's note, any other state cannot be picked and says why, and other drivers, an uninstalled driver and anything outside Zerops are left as the driver reports them", () => {
  const CODEX = ProviderDriverKind.make("codex");
  const CLAUDE = ProviderDriverKind.make("claudeAgent");
  const OPENCODE = ProviderDriverKind.make("opencode");
  const provider = (
    driver: ProviderDriverKind,
    overrides?: Partial<ServerProvider>,
  ): ServerProvider => ({
    instanceId: defaultInstanceIdForDriver(driver),
    driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-22T18:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  });
  // What the Codex driver reported for minutes after the sign-in, while the project's flag already said signed in.
  const STALE_CODEX = provider(CODEX, {
    status: "error",
    auth: { status: "unauthenticated" },
    message: "Codex CLI is not authenticated. Run `codex login` and try again.",
  });
  const agent = (
    agentId: ZeropsAgentAuth["agentId"],
    state: ZeropsAgentAuth["state"],
    providerAuth: ZeropsAgentAuth["providerAuth"] = "unknown",
  ): ZeropsAgentAuth => ({
    agentId,
    credPresent: state !== "not-authorized" && state !== "reconnect",
    flagOAuth: state === "authorized" || state === "reconnect",
    flagToken: state === "authorized-token",
    providerAuth,
    state,
  });
  const snapshot = (...agents: ReadonlyArray<ZeropsAgentAuth>): ZeropsAgentAuthSnapshot => ({
    available: true,
    agents,
  });
  const codexOf = (providers: ReadonlyArray<ServerProvider>) =>
    providers.find((entry) => entry.driver === CODEX);

  const signedIn = codexOf(
    overlayZeropsAgentAuth([STALE_CODEX], snapshot(agent("codex", "authorized"))),
  );
  expect(signedIn?.status).toBe("ready");
  expect(signedIn?.auth.status).toBe("authenticated");
  expect(signedIn?.message).toBeUndefined();

  const withAccount = codexOf(
    overlayZeropsAgentAuth(
      [
        provider(CODEX, {
          auth: { status: "authenticated", email: "dev@example.com" },
          message: "A newer Codex is available.",
        }),
      ],
      snapshot(agent("codex", "authorized")),
    ),
  );
  expect(withAccount?.auth).toEqual({ status: "authenticated", email: "dev@example.com" });
  expect(withAccount?.message).toBe("A newer Codex is available.");

  for (const [state, providerAuth, status] of [
    ["not-authorized", "unknown", "error"],
    ["reconnect", "unknown", "error"],
    ["authorized", "unauthenticated", "error"],
    ["local-only", "authenticated", "warning"],
  ] as const) {
    const codex = codexOf(
      overlayZeropsAgentAuth([provider(CODEX)], snapshot(agent("codex", state, providerAuth))),
    );
    expect(codex?.status).toBe(status);
    expect(codex?.message).toBeTypeOf("string");
  }

  const notInstalled = provider(CLAUDE, {
    installed: false,
    status: "error",
    message: "not found",
  });
  const opencode = provider(OPENCODE, { status: "warning" });
  expect(
    overlayZeropsAgentAuth(
      [notInstalled, opencode],
      snapshot(agent("claude-code", "authorized"), agent("codex", "authorized")),
    ),
  ).toEqual([notInstalled, opencode]);

  const outside = [STALE_CODEX];
  expect(overlayZeropsAgentAuth(outside, { available: false, agents: [] })).toBe(outside);
});

// witness: apps/server/src/zerops/zeropsTurnAuthFailure.ts | event.payload.message.trimStart().startsWith(opening), → event.payload.message.includes("could not authenticate") || event.payload.message.trimStart().startsWith(opening),
it("ZS11: A turn counts as failed for want of a login only when its error is Claude's own signed-out opening or Codex's unauthorized or 401 answer on that agent's own instance; a warning, another failure, a Git refusal or another driver's or custom instance's error does not", () => {
  const CLAUDE_SIGNED_OUT =
    "Claude could not authenticate. For subscription login, run `claude auth login` on this environment's machine, then start a new thread. For API-key authentication, check this instance's configured credentials.";
  const event = (input: {
    readonly type: string;
    readonly provider: string;
    readonly providerInstanceId?: string;
    readonly payload: unknown;
  }): SpiEvent =>
    ({
      eventId: "evt-1",
      threadId: "thread-1",
      createdAt: "2026-09-23T12:00:00Z",
      ...input,
    }) as SpiEvent;
  const codexError = (codexErrorInfo: unknown) => ({
    message: "codex failed",
    class: "provider_error",
    detail: { error: { message: "codex failed", codexErrorInfo }, willRetry: false },
  });

  for (const [input, expected] of [
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      "claude-code",
    ],
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: {
          message:
            "Claude's sign-in has expired. Sign Claude in again, then send a message to pick up where it left off.",
        },
      }),
      "claude-code",
    ],
    [
      event({ type: "runtime.error", provider: "codex", payload: codexError("unauthorized") }),
      "codex",
    ],
    [
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError({ responseStreamConnectionFailed: { httpStatusCode: 401 } }),
      }),
      "codex",
    ],
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        providerInstanceId: "claude-code",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      "claude-code",
    ],
    [
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError("usageLimitExceeded"),
      }),
      undefined,
    ],
    [
      event({
        type: "runtime.error",
        provider: "codex",
        payload: codexError({ httpConnectionFailed: { httpStatusCode: 503 } }),
      }),
      undefined,
    ],
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: { message: "Claude API is overloaded (529). Try again shortly." },
      }),
      undefined,
    ],
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        payload: { message: "mirror_error: Git could not authenticate with the remote." },
      }),
      undefined,
    ],
    [
      event({
        type: "runtime.warning",
        provider: "claudeAgent",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      undefined,
    ],
    [
      event({ type: "runtime.error", provider: "cursor", payload: { message: CLAUDE_SIGNED_OUT } }),
      undefined,
    ],
    [
      event({
        type: "runtime.error",
        provider: "claudeAgent",
        providerInstanceId: "claude-work",
        payload: { message: CLAUDE_SIGNED_OUT },
      }),
      undefined,
    ],
  ] as const) {
    expect(turnAuthFailureAgent(input)).toBe(expected);
  }
});
