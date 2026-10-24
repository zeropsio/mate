import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as PairingGrantStore from "./PairingGrantStore.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";

import * as ServerSecretStore from "./ServerSecretStore.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import * as SessionStore from "./SessionStore.ts";
import { awaitSessionEnd } from "./sessionLifetime.ts";
import { layer as ZeropsIdentityStatusLayer } from "../zerops/ZeropsIdentityStatus.ts";
import { snapshotOnlyReader, ZeropsMateKey } from "../zerops/ZeropsMateKey.ts";
import { layer as ZeropsMembershipWatchLayer } from "../zerops/ZeropsMembershipWatch.ts";
import { layer as ZeropsOrgReadLayer } from "../zerops/ZeropsOrgRead.ts";
import { ZeropsMateAccessList, layer as accessListLayer } from "../zerops/ZeropsMateAccessList.ts";
import { ZeropsSessionAdmissionLive } from "../zerops/zeropsFeedsLayer.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import type * as PtyAdapter from "../terminal/PtyAdapter.ts";
import { layer as terminalsEndWithSessionLayer } from "../terminal/terminalsEndWithSession.ts";

/** Pinned so dev-mode cookie tests can assert the port-scoped name. */
const TEST_SERVER_PORT = 13_773;

const makeServerConfigLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        zeropsFixtures: undefined,
        ...overrides,
        // Keep the test server deterministic even when the default test layer
        // changes its development port.
        port: TEST_SERVER_PORT,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-server-test-" })));

const makeEnvironmentAuthLayer = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeServerConfigLayer(overrides)),
  );

/** The auth boundary inside a Zerops Mate, its admission read from HQ's access list. */
const makeAdmissionAuthLayer = () =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(ZeropsSessionAdmissionLive),
    Layer.provideMerge(accessListLayer),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(makeServerConfigLayer({ zerops: zeropsTestEnvironment })),
  );

/** HQ's full list, opening the project for `open` and listing `listed`. */
const accessFrame = (
  version: number,
  open: ReadonlyArray<string>,
  listed: ReadonlyArray<string> = [],
) =>
  ({
    type: "access",
    version,
    viewAt: "2026-10-24T10:00:00.000Z",
    full: true,
    members: [
      ...open.map((userId) => ({ userId, role: "ADMIN", visibility: "open" }) as const),
      ...listed.map((userId) => ({ userId, role: "READ_ONLY", visibility: "listed" }) as const),
    ],
  }) as const;

const makeCookieRequest = (
  cookieName: string,
  sessionToken: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {
      [cookieName]: sessionToken,
    },
    headers: {},
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const makeBearerRequest = (
  token: string,
): Parameters<EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]>[0] =>
  ({
    cookies: {},
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as Parameters<
    EnvironmentAuth.EnvironmentAuth["Service"]["authenticateHttpRequest"]
  >[0];

const SESSION_MAX_AGE_SECONDS = 900;

const zeropsTestEnvironment = resolveZeropsEnvironment({
  projectId: "TEST000000000000000023",
  apiHost: undefined,
  sessionMaxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
  ipAddress: "192.168.1.23",
};

it.layer(NodeServices.layer)("EnvironmentAuth.layer", (it) => {
  it.effect("classifies invalid bootstrap credential failures for the HTTP boundary", () =>
    Effect.sync(() => {
      const error = EnvironmentAuth.toBootstrapExchangeError(
        new PairingGrantStore.UnknownBootstrapCredentialError({}),
      );

      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }),
  );

  it.effect("maps unexpected bootstrap failures to 500", () =>
    Effect.sync(() => {
      const cause = new PairingGrantStore.BootstrapCredentialConsumeError({
        cause: new Error("sqlite is unavailable"),
      });
      const error = EnvironmentAuth.toBootstrapExchangeError(cause);

      expect(error._tag).toBe("ServerAuthBootstrapCredentialValidationError");
      expect(error.message).toBe("Failed to validate bootstrap credential.");
      if (error._tag === "ServerAuthBootstrapCredentialValidationError") {
        expect(error.cause).toBe(cause);
      }
    }),
  );

  it.effect("ignores session cookies for HTTP and websocket auth inside Zerops", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const sessions = yield* SessionStore.SessionStore;
      const issued = yield* serverAuth.issueSession();
      const request = makeCookieRequest(sessions.cookieName, issued.token);

      const [httpResult, websocketResult] = yield* Effect.all([
        serverAuth.authenticateHttpRequest(request).pipe(Effect.result),
        serverAuth.authenticateWebSocketUpgrade(request).pipe(Effect.result),
      ]);

      expect(httpResult._tag).toBe("Failure");
      expect(websocketResult._tag).toBe("Failure");
      if (httpResult._tag === "Failure") {
        expect(httpResult.failure._tag).toBe("ServerAuthMissingCredentialError");
      }
      if (websocketResult._tag === "Failure") {
        expect(websocketResult.failure._tag).toBe("ServerAuthMissingCredentialError");
      }
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("does not exchange ordinary pairing grants for administrative access tokens", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.createPairingLink();

      const error = yield* serverAuth
        .exchangeBootstrapCredentialForAccessToken(
          pairingCredential.credential,
          ["orchestration:read", "access:write"],
          requestMetadata,
        )
        .pipe(Effect.flip);

      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("inherits the identity grant scopes when token exchange omits scope", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const pairingCredential = yield* serverAuth.createPairingLink({
        method: "zerops-throwaway",
        subject: "zerops-user:test",
        scopes: ["orchestration:read"],
      });

      const token = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        pairingCredential.credential,
        undefined,
        requestMetadata,
      );

      expect(token.scope).toBe("orchestration:read");
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("caps a session from the identity door at the membership window", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* serverAuth.createPairingLink({
        method: "zerops-throwaway",
        subject: "zerops-user:a-zerops-user-id",
      });
      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
      );

      // The window IS this session's lifetime: the holder has a Zerops token
      // and re-mints with it, and that re-mint is the real membership check.
      expect(access.expires_in).toBeLessThanOrEqual(SESSION_MAX_AGE_SECONDS);
      expect(access.expires_in).toBeGreaterThan(SESSION_MAX_AGE_SECONDS - 30);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("caps a DPoP session from the identity door at the window, not the hour", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* serverAuth.createPairingLink({
        method: "zerops-throwaway",
        subject: "zerops-user:a-zerops-user-id",
        proofKeyThumbprint: "a-jwk-thumbprint",
      });
      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
        { proofKeyThumbprint: "a-jwk-thumbprint" },
      );

      expect(access.token_type).toBe("DPoP");
      expect(access.expires_in).toBeLessThanOrEqual(SESSION_MAX_AGE_SECONDS);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );

  it.effect("revokes every session belonging to one subject and leaves the rest", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      // Two devices for the same Zerops user, one for somebody else.
      const laptop = yield* serverAuth.issueSession({ subject: "zerops-user-a", label: "laptop" });
      const phone = yield* serverAuth.issueSession({ subject: "zerops-user-a", label: "phone" });
      const other = yield* serverAuth.issueSession({ subject: "zerops-user-b", label: "other" });

      const revoked = yield* serverAuth.revokeBySubject("zerops-user-a");
      expect(revoked).toBe(2);

      const remaining = yield* serverAuth.listSessions();
      expect(remaining.map((session) => session.sessionId)).toEqual([other.sessionId]);

      // The revoked credentials stop authenticating, not just stop being listed.
      for (const session of [laptop, phone]) {
        const error = yield* Effect.flip(
          serverAuth.authenticateHttpRequest(makeBearerRequest(session.token)),
        );
        expect(error._tag).toBe("ServerAuthInvalidCredentialError");
      }
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("revoking an unknown subject is a no-op, not an error", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      yield* serverAuth.issueSession({ subject: "zerops-user-a" });

      expect(yield* serverAuth.revokeBySubject("nobody")).toBe(0);
      expect((yield* serverAuth.listSessions()).length).toBe(1);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );

  it.effect("counts each session once, however often the subject is revoked", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      yield* serverAuth.issueSession({ subject: "zerops-user-a" });

      expect(yield* serverAuth.revokeBySubject("zerops-user-a")).toBe(1);
      expect(yield* serverAuth.revokeBySubject("zerops-user-a")).toBe(0);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer())),
  );
});

it.layer(NodeServices.layer)("current admission for existing sessions", (it) => {
  it.effect(
    "an existing session opens only while HQ's access list opens the project for its person",
    () =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const list = yield* ZeropsMateAccessList;
        const session = yield* auth.issueSession({ subject: "zerops-user:owner" });
        const opens = () =>
          auth
            .authenticateHttpRequest(makeBearerRequest(session.token))
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
        const admitted = [yield* opens()];
        yield* list.heard(accessFrame(1, ["owner"]));
        admitted.push(yield* opens());
        yield* list.heard(accessFrame(2, [], ["owner"]));
        admitted.push(yield* opens());
        yield* list.heard(accessFrame(3, ["owner"]));
        yield* list.heard({ type: "access", version: 4, full: true, refused: true, members: [] });
        admitted.push(yield* opens());
        expect(admitted).toEqual([false, true, false, false]);
      }).pipe(Effect.provide(makeAdmissionAuthLayer())),
  );
});

// F1 (permission audit): an open bearer session outlived the person's org role. HQ's next list
// after the change ends it at once.
const DEMOTED_PROJECT = "TEST000000000000000023";
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const beaListedAs = (roleCode: string) => ({
  clientUserList: [
    { id: "cu-owner", userId: "owner", roleCode: "OWNER", status: "ACTIVE" },
    { id: "cu-bea", userId: "bea", roleCode, status: "ACTIVE" },
  ],
});
const demotions = [
  { case: "lowered to Developer: HQ's next list leaves her out", to: "NO_ACCESS" },
  { case: "lowered to Read only: HQ's next list only lists her", to: "READ_ONLY" },
] as const;

/** A Zerops Mate whose platform lists Bea as Admin, for the door's own read. */
const makeDemotionScene = () => {
  const zerops = { members: beaListedAs("ADMIN") };
  const platform = Layer.mergeAll(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            request.url.endsWith("/user/list")
              ? jsonResponse(zerops.members)
              : jsonResponse({ id: DEMOTED_PROJECT, clientId: "org", userRoles: [] }),
          ),
        ),
      ),
    ),
    Layer.succeed(ZeropsMateKey, snapshotOnlyReader("the-mates-own-zerops-key")),
    ZeropsIdentityStatusLayer,
  );
  const layer = ZeropsMembershipWatchLayer.pipe(
    Layer.provideMerge(
      EnvironmentAuth.layer.pipe(
        Layer.provide(ZeropsSessionAdmissionLive),
        Layer.provideMerge(accessListLayer),
        Layer.provideMerge(ZeropsOrgReadLayer),
        Layer.provideMerge(platform),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provide(ServerSecretStore.layer),
      ),
    ),
    Layer.provide(makeServerConfigLayer({ zerops: zeropsTestEnvironment })),
  );
  return { layer };
};

/** HQ's next list after Bea is lowered: without her, or listing her only. */
const demote = (to: (typeof demotions)[number]["to"]) =>
  Effect.flatMap(ZeropsMateAccessList, (list) =>
    list.heard(to === "READ_ONLY" ? accessFrame(2, ["owner"], ["bea"]) : accessFrame(2, ["owner"])),
  );

/** HQ lists Bea as Admin, and she signs in through the door and holds a bearer session. */
const signInBea = Effect.fn("signInBea")(function* () {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  yield* (yield* ZeropsMateAccessList).heard(accessFrame(1, ["owner", "bea"]));
  yield* TestClock.adjust(Duration.zero);
  const issued = yield* auth.createPairingLink({
    method: "zerops-throwaway",
    subject: "zerops-user:bea",
  });
  const access = yield* auth.exchangeBootstrapCredentialForAccessToken(
    issued.credential,
    undefined,
    requestMetadata,
  );
  const session = yield* auth.authenticateHttpRequest(makeBearerRequest(access.access_token));
  return { access, session };
});

it.layer(NodeServices.layer)(
  "a person whose Zerops access ended loses their open session within 60 seconds",
  (it) => {
    it.effect.each(demotions)("$case", ({ to }) => {
      const { layer } = makeDemotionScene();
      return Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;

        // Bea signs in through the door and holds a bearer session and a live socket.
        const { access, session } = yield* signInBea();
        const ticket = yield* auth.issueWebSocketTicket(session);
        const socket = yield* auth.authenticateWebSocketUpgrade(
          HttpServerRequest.fromWeb(
            new Request(`http://localhost/ws?wsTicket=${encodeURIComponent(ticket.ticket)}`),
          ),
        );
        const live = yield* Effect.forkChild(
          awaitSessionEnd({
            sessionId: socket.sessionId,
            expiresAt: socket.expiresAt,
            changes: sessions.streamChanges,
          }),
        );
        const later = yield* auth.issueWebSocketTicket(session);
        // The live socket is listening before HQ's next list lands, as a connected one is.
        yield* TestClock.adjust(Duration.zero);

        yield* demote(to);
        yield* TestClock.adjust(Duration.seconds(60));

        const http = yield* auth
          .authenticateHttpRequest(makeBearerRequest(access.access_token))
          .pipe(Effect.result);
        const upgrade = yield* auth
          .authenticateWebSocketUpgrade(
            HttpServerRequest.fromWeb(
              new Request(`http://localhost/ws?wsTicket=${encodeURIComponent(later.ticket)}`),
            ),
          )
          .pipe(Effect.result);
        expect({
          http: http._tag,
          websocket: upgrade._tag,
          liveSocket: Option.fromNullishOr(live.pollUnsafe()).pipe(Option.flatMap(Exit.getSuccess)),
          sessions: (yield* auth.listSessions()).map((entry) => entry.subject),
        }).toEqual({
          http: "Failure",
          websocket: "Failure",
          liveSocket: Option.some("revoked"),
          sessions: [],
        });
      }).pipe(Effect.provide(layer));
    });
  },
);

// Decision: removal ends every channel within one bound, terminals included.
it.layer(NodeServices.layer)("Terminals a removed person opened end with their session", (it) => {
  it.effect.each(demotions)("$case", ({ to }) => {
    const { layer } = makeDemotionScene();
    const signals: Array<string | undefined> = [];
    const typed: Array<string> = [];
    const pty: PtyAdapter.PtyAdapter["Service"] = {
      spawn: () =>
        Effect.succeed({
          pid: 4242,
          write: (data) => {
            typed.push(data);
          },
          resize: () => undefined,
          kill: (signal) => {
            signals.push(signal);
          },
          onData: () => () => undefined,
          onExit: () => () => undefined,
        }),
    };
    const terminals = Layer.effect(
      TerminalManager.TerminalManager,
      Effect.gen(function* () {
        const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
          prefix: "t3-revoked-terminals-",
        });
        return yield* TerminalManager.makeWithOptions({
          logsDir: dir,
          homeDir: dir,
          ptyAdapter: pty,
          processKillGraceMs: 1,
          subprocessInspector: () =>
            Effect.succeed({ hasRunningSubprocess: false, childCommand: null, processIds: [] }),
        });
      }),
    ).pipe(Layer.provide(ProcessRunner.layer));
    return Effect.gen(function* () {
      const manager = yield* TerminalManager.TerminalManager;
      const { session } = yield* signInBea();
      const terminal = { threadId: "thread-bea", terminalId: "default" };
      yield* manager.open({
        ...terminal,
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        openedBy: session.sessionId,
      });

      yield* demote(to);
      yield* TestClock.adjust(Duration.seconds(60));

      yield* manager.write({ ...terminal, data: "echo still here\r" }).pipe(Effect.ignore);
      expect({
        // An interactive shell ignores SIGTERM; a hangup or a kill ends it.
        shellEnded: signals.some((signal) => signal === "SIGHUP" || signal === "SIGKILL"),
        typedAfterRemoval: typed,
      }).toEqual({ shellEnded: true, typedAfterRemoval: [] });
    }).pipe(
      // A shell still open at teardown waits out its kill grace on the test clock: close it first
      // so a red run fails instead of hanging.
      Effect.ensuring(
        Effect.gen(function* () {
          const manager = yield* TerminalManager.TerminalManager;
          yield* manager.close({ threadId: "thread-bea" }).pipe(Effect.ignore);
        }),
      ),
      Effect.provide(
        terminalsEndWithSessionLayer.pipe(Layer.provideMerge(terminals), Layer.provideMerge(layer)),
      ),
    );
  });
});

it.layer(NodeServices.layer)("a refused session credential", (it) => {
  // A client tells a session that merely reached the end of its life (its door mints the next)
  // from every other refusal by this flag; the HTTP boundary sends it as the 401's `expired`.
  it.effect.each([
    {
      case: "a session past its deadline",
      present: (auth: EnvironmentAuth.EnvironmentAuth["Service"]) =>
        auth
          .issueSession({ subject: "zerops-user:a-zerops-user-id", ttl: Duration.zero })
          .pipe(Effect.map((issued) => issued.token)),
      expired: true,
    },
    {
      case: "a revoked session",
      present: (auth: EnvironmentAuth.EnvironmentAuth["Service"]) =>
        Effect.gen(function* () {
          const issued = yield* auth.issueSession({ subject: "zerops-user:a-zerops-user-id" });
          yield* auth.revokeSession(issued.sessionId);
          return issued.token;
        }),
      expired: false,
    },
    {
      case: "a token this server never signed",
      present: () => Effect.succeed(["eyJ2IjoxfQ", "not-a-signature"].join(".")),
      expired: false,
    },
  ])("says whether $case expired: $expired", ({ present, expired }) =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const token = yield* present(serverAuth);
      const error = yield* Effect.flip(
        serverAuth.authenticateHttpRequest(makeBearerRequest(token)),
      );

      expect(error._tag).toBe("ServerAuthInvalidCredentialError");
      expect(
        EnvironmentAuth.isServerAuthCredentialError(error) &&
          EnvironmentAuth.serverAuthCredentialExpired(error),
      ).toBe(expired);
    }).pipe(Effect.provide(makeEnvironmentAuthLayer({ zerops: zeropsTestEnvironment }))),
  );
});

describe("rejectedCredentialAnnotations", () => {
  // The log line names the session a refused credential belonged to, and when it ended, so the
  // client that keeps presenting it can be found (its row names the client); never the token.
  const sessionId = AuthSessionId.make("0b3c1d2e-0000-4000-8000-000000000001");
  const endedAt = DateTime.makeUnsafe("2026-09-28T06:49:18.000Z");
  it.each([
    {
      case: "an expired session",
      cause: new SessionStore.SessionTokenExpiredError({
        sessionId,
        expiresAt: endedAt,
        observedAt: DateTime.makeUnsafe("2026-09-29T07:07:50.000Z"),
      }),
      annotations: {
        reason: "Session token expired.",
        sessionId,
        expiredAt: "2026-09-28T06:49:18.000Z",
      },
    },
    {
      case: "a revoked session",
      cause: new SessionStore.SessionTokenRevokedError({ sessionId, revokedAt: endedAt }),
      annotations: {
        reason: "Session token revoked.",
        sessionId,
        revokedAt: "2026-09-28T06:49:18.000Z",
      },
    },
    {
      case: "a session this server does not know",
      cause: new SessionStore.UnknownSessionTokenError({ sessionId }),
      annotations: { reason: "Unknown session token.", sessionId },
    },
    {
      case: "a token with a forged signature",
      cause: new SessionStore.InvalidSessionTokenSignatureError({}),
      annotations: { reason: "Invalid session token signature." },
    },
  ])("names $case", ({ cause, annotations }) => {
    expect(EnvironmentAuth.rejectedCredentialAnnotations(cause)).toEqual(annotations);
  });
});
