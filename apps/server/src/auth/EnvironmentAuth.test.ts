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
import { ZeropsOrgRead, layer as ZeropsOrgReadLayer } from "../zerops/ZeropsOrgRead.ts";
import {
  ACCESS_HOLDS,
  ZeropsProjectAccess,
  layer as projectAccessLayer,
} from "../zerops/ZeropsProjectAccess.ts";
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

const makeAdmissionAuthLayer = (platformAnswers = false) => {
  const access = projectAccessLayer.pipe(
    Layer.provide(
      Layer.succeed(ZeropsOrgRead, {
        project: () =>
          platformAnswers
            ? Effect.succeed({
                kind: "answered" as const,
                status: 200,
                body: { clientId: "org", userRoles: [], tagList: ["mate", "chief"] },
              })
            : Effect.die("Enrolled admission must not fall back to platform roles"),
        members: () =>
          platformAnswers
            ? Effect.succeed({
                kind: "answered" as const,
                status: 200,
                body: {
                  clientUserList: [
                    { id: "member", userId: "owner", roleCode: "OWNER", status: "ACTIVE" },
                  ],
                },
              })
            : Effect.die("Enrolled admission must not fall back to platform roles"),
        forgetAccess: () => Effect.void,
      }),
    ),
  );
  return EnvironmentAuth.layer.pipe(
    Layer.provide(ZeropsSessionAdmissionLive),
    Layer.provideMerge(access),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(
      makeServerConfigLayer({
        zerops: { ...zeropsTestEnvironment!, hqEnrollmentPath: "/test/hq/enrollment.json" },
      }),
    ),
  );
};

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
  it.effect("a Mate admits by today's rules while HQ has not classified it", () =>
    Effect.gen(function* () {
      const auth = yield* EnvironmentAuth.EnvironmentAuth;
      const access = yield* ZeropsProjectAccess;
      const session = yield* auth.issueSession({ subject: "zerops-user:owner" });
      for (const state of ["missing", "expired", "ordinary"] as const) {
        if (state !== "missing") {
          yield* access.relayed({
            ageMs: state === "expired" ? Duration.toMillis(ACCESS_HOLDS) + 1 : 0,
            chief: state === "ordinary" ? null : { userId: "another-person", ownerName: "Ada" },
            members:
              state === "ordinary" ? [{ userId: "owner", role: "OWNER", visibility: "open" }] : [],
          });
        }
        const ticket = yield* auth.issueWebSocketTicket(session);
        const http = yield* auth.authenticateHttpRequest(makeBearerRequest(session.token));
        const websocket = yield* auth.authenticateWebSocketUpgrade(
          HttpServerRequest.fromWeb(
            new Request(`http://localhost/ws?wsTicket=${encodeURIComponent(ticket.ticket)}`),
          ),
        );
        expect([http.subject, websocket.subject]).toEqual([
          "zerops-user:owner",
          "zerops-user:owner",
        ]);
      }
    }).pipe(Effect.provide(makeAdmissionAuthLayer(true))),
  );

  it.effect.each([
    ["another person's", "other", "current", false],
    ["the owner's", "owner", "current", true],
  ] as const)(
    "%s existing session opens its Chief only with current ownership",
    ([, person, , allowed]) =>
      Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const access = yield* ZeropsProjectAccess;
        const session = yield* auth.issueSession({ subject: `zerops-user:${person}` });
        // Mint the ticket before the current ownership verdict: restored credentials cannot bypass it.
        const ticket = yield* auth.issueWebSocketTicket(session);
        yield* access.relayed({
          ageMs: 0,
          chief: { userId: "owner", ownerName: "Ada" },
          members: [
            { userId: "owner", role: "OWNER", visibility: "open" },
            { userId: "other", role: "OWNER", visibility: "open" },
          ],
        });
        const http = yield* auth
          .authenticateHttpRequest(makeBearerRequest(session.token))
          .pipe(Effect.result);
        const websocket = yield* auth
          .authenticateWebSocketUpgrade(
            HttpServerRequest.fromWeb(
              new Request(`http://localhost/ws?wsTicket=${encodeURIComponent(ticket.ticket)}`),
            ),
          )
          .pipe(Effect.result);
        expect({ http: http._tag, websocket: websocket._tag }).toEqual({
          http: allowed ? "Success" : "Failure",
          websocket: allowed ? "Success" : "Failure",
        });
        if (http._tag === "Success") expect(http.success.subject).toBe("zerops-user:owner");
        if (websocket._tag === "Success")
          expect(websocket.success.subject).toBe("zerops-user:owner");
      }).pipe(Effect.provide(makeAdmissionAuthLayer())),
  );
});

// F1 (permission audit): an open bearer session outlived the person's org role. The bound is two
// re-checks: a member list or HQ relay read just before the change holds one, the next reads it.
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
  { case: "lowered to Developer while the Mate reads Zerops", to: "NO_ACCESS", hq: false },
  { case: "lowered to Read only while the Mate reads Zerops", to: "READ_ONLY", hq: false },
  { case: "lowered to Developer just after HQ relayed", to: "NO_ACCESS", hq: true },
  { case: "lowered to Read only just after HQ relayed", to: "READ_ONLY", hq: true },
];

/** A Zerops Mate whose platform lists Bea as Admin until a test lowers her. */
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
        Layer.provideMerge(projectAccessLayer),
        Layer.provideMerge(ZeropsOrgReadLayer),
        Layer.provideMerge(platform),
        Layer.provide(SqlitePersistenceMemory),
        Layer.provide(ServerSecretStore.layer),
      ),
    ),
    Layer.provide(makeServerConfigLayer({ zerops: zeropsTestEnvironment })),
  );
  return { zerops, layer };
};

/** Bea signs in through the door and holds a bearer session; with `hq`, HQ relayed her as Admin first. */
const signInBea = Effect.fn("signInBea")(function* (hq: boolean) {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  if (hq) {
    yield* (yield* ZeropsProjectAccess).relayed({
      ageMs: 0,
      members: [
        { userId: "owner", role: "OWNER", visibility: "open" },
        { userId: "bea", role: "ADMIN", visibility: "open" },
      ],
    });
  }
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
    it.effect.each(demotions)("$case", ({ to, hq }) => {
      const { zerops, layer } = makeDemotionScene();
      return Effect.gen(function* () {
        const auth = yield* EnvironmentAuth.EnvironmentAuth;
        const sessions = yield* SessionStore.SessionStore;

        // Bea signs in through the door and holds a bearer session and a live socket.
        const { access, session } = yield* signInBea(hq);
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

        zerops.members = beaListedAs(to);
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
  it.effect.each(demotions)("$case", ({ to, hq }) => {
    const { zerops, layer } = makeDemotionScene();
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
      const { session } = yield* signInBea(hq);
      const terminal = { threadId: "thread-bea", terminalId: "default" };
      yield* manager.open({
        ...terminal,
        cwd: process.cwd(),
        cols: 80,
        rows: 24,
        openedBy: session.sessionId,
      });

      zerops.members = beaListedAs(to);
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
