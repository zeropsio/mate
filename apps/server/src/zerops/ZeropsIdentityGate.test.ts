import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  mintZeropsPairingCredential,
  mintZeropsThrowawayPairingCredential,
  zeropsGrantScopes,
} from "./ZeropsIdentityGate.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const USER_ID = "8yLPr0kbTA6MZKfMLBQe0A";
const TOKEN = "a-zerops-access-token";
const MEMBERSHIP_TTL_SECONDS = 120;

const MATE_KEY = "the-mates-own-zerops-key";
const TOKEN_ID = "tok-throwaway";
const API_NOW = "Tue, 16 Sep 2026 10:00:00 GMT";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: MEMBERSHIP_TTL_SECONDS,
  apiToken: MATE_KEY,
})!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const httpClientLayer = (route: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url))),
    ),
  );

const memberRoute = (url: string) =>
  url.endsWith(`/project/${PROJECT_ID}`)
    ? json({ id: PROJECT_ID, clientId: CLIENT_ID })
    : url.endsWith("/user/info")
      ? json({
          id: USER_ID,
          clientUserList: [{ id: "cu-1", clientId: CLIENT_ID, userId: USER_ID, roleCode: "OWNER" }],
        })
      : json({ message: "unexpected route" }, 500);

const forbiddenRoute = () => json({ error: { code: "insufficientPermissions" } }, 403);

const makeLayer = (route: (url: string) => Response) =>
  EnvironmentAuth.layer.pipe(
    Layer.provide(SqlitePersistenceMemory),
    Layer.provide(ServerSecretStore.layer),
    Layer.provide(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return {
            ...config,
            zeropsFixtures: undefined,
            zerops: environment,
          } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-zerops-gate-test-" })),
      ),
    ),
    Layer.provideMerge(httpClientLayer(route)),
  );

const requestMetadata = {
  deviceType: "desktop" as const,
  os: "macOS",
  browser: "Chrome",
};

it.layer(NodeServices.layer)("mintZeropsPairingCredential", (it) => {
  it.effect("mints a grant whose subject is the Zerops user id", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* mintZeropsPairingCredential({ environment, token: TOKEN });

      assert.isAbove(issued.credential.length, 0);
      assert.strictEqual(issued.label, "Zerops OWNER");

      const links = yield* serverAuth.listPairingLinks({ excludeSubjects: [] });
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0]!.subject, `zerops-user:${USER_ID}`);
      assert.deepStrictEqual([...links[0]!.scopes], [...zeropsGrantScopes]);
    }).pipe(Effect.provide(makeLayer(memberRoute))),
  );

  it.effect("issues a short-lived grant — a pairing credential, not a session", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const now = yield* DateTime.now;
      const issued = yield* mintZeropsPairingCredential({ environment, token: TOKEN });
      const lifetimeMs = issued.expiresAt.epochMilliseconds - now.epochMilliseconds;

      assert.isAtMost(lifetimeMs, Duration.toMillis(Duration.minutes(5)));
      assert.isAbove(lifetimeMs, 0);
      void serverAuth;
    }).pipe(Effect.provide(makeLayer(memberRoute))),
  );

  it.effect("exchanges into a session whose subject is the user and whose life is the window", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* mintZeropsPairingCredential({ environment, token: TOKEN });
      const now = yield* DateTime.now;
      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
      );

      // The membership window IS the session lifetime: the client re-mints with
      // its Zerops token, and that re-mint is the real membership check.
      assert.isAtMost(access.expires_in, MEMBERSHIP_TTL_SECONDS);
      assert.isAbove(access.expires_in, MEMBERSHIP_TTL_SECONDS - 30);

      const sessions = yield* serverAuth.listSessions();
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0]!.subject, `zerops-user:${USER_ID}`);
      void now;
    }).pipe(Effect.provide(makeLayer(memberRoute))),
  );

  it.effect("refuses a non-member and leaves no grant behind", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const error = yield* Effect.flip(mintZeropsPairingCredential({ environment, token: TOKEN }));

      assert.strictEqual(error._tag, "ZeropsNotAMemberError");
      const links = yield* serverAuth.listPairingLinks({ excludeSubjects: [] });
      assert.strictEqual(links.length, 0);
    }).pipe(Effect.provide(makeLayer(forbiddenRoute))),
  );

  it.effect("refuses an invalid token and leaves no grant behind", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const error = yield* Effect.flip(mintZeropsPairingCredential({ environment, token: TOKEN }));

      assert.strictEqual(error._tag, "ZeropsInvalidTokenError");
      const links = yield* serverAuth.listPairingLinks({ excludeSubjects: [] });
      assert.strictEqual(links.length, 0);
    }).pipe(Effect.provide(makeLayer(() => json({ error: { code: "notAuthorized" } }, 401)))),
  );

  it.effect("binds the grant to a DPoP key when the caller proves one", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* mintZeropsPairingCredential({
        environment,
        token: TOKEN,
        proofKeyThumbprint: "a-jwk-thumbprint",
      });

      // A grant bound to a proof key cannot be redeemed without it.
      const error = yield* Effect.flip(
        serverAuth.exchangeBootstrapCredentialForAccessToken(
          issued.credential,
          undefined,
          requestMetadata,
        ),
      );
      assert.strictEqual(error._tag, "ServerAuthInvalidCredentialError");
    }).pipe(Effect.provide(makeLayer(memberRoute))),
  );
});

/**
 * A door that answers every read a throwaway check makes, with the caller's
 * org role as the one variable.
 */
const throwawayRoute =
  (orgRole: string) =>
  (url: string): Response => {
    if (url.endsWith(`/project/${PROJECT_ID}`))
      return json({ id: PROJECT_ID, clientId: CLIENT_ID });
    if (url.endsWith("/user/info")) return json({ id: TOKEN_ID });
    if (url.includes("/integration-token/")) {
      return new Response(
        JSON.stringify({
          id: TOKEN_ID,
          name: `mate-door:${PROJECT_ID}:a1b2c3`,
          created: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(API_NOW) - 5_000)),
          createdByUser: USER_ID,
          roleCode: "NO_ACCESS",
          projects: [],
          canCreateProjects: false,
        }),
        { status: 200, headers: { "content-type": "application/json", date: API_NOW } },
      );
    }
    if (url.endsWith("/user/list")) {
      return json({
        items: [
          {
            id: "cu-1",
            userId: USER_ID,
            roleCode: orgRole,
            status: "ACTIVE",
            canCreateProjects: false,
          },
        ],
      });
    }
    return json({ message: "unexpected route" }, 500);
  };

it.layer(NodeServices.layer)("mintZeropsThrowawayPairingCredential", (it) => {
  it.effect("names the throwaway door, the creator, and the full client scope set", () =>
    Effect.gen(function* () {
      const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
      const issued = yield* mintZeropsThrowawayPairingCredential({ environment, token: TOKEN });

      assert.strictEqual(issued.label, "Zerops OWNER");
      const links = yield* serverAuth.listPairingLinks({ excludeSubjects: [] });
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0]!.subject, `zerops-user:${USER_ID}`);
      // Role decides whether the door opens, never how far.
      assert.deepStrictEqual([...links[0]!.scopes], [...zeropsGrantScopes]);

      const access = yield* serverAuth.exchangeBootstrapCredentialForAccessToken(
        issued.credential,
        undefined,
        requestMetadata,
      );
      assert.isAbove(access.access_token.length, 0);
    }).pipe(Effect.provide(makeLayer(throwawayRoute("OWNER")))),
  );

  for (const [orgRole, outcome] of [
    ["OWNER", "open"],
    ["ADMIN", "open"],
    ["BASIC_USER", "open"],
    ["READ_ONLY", "ZeropsReadOnlyError"],
    ["NO_ACCESS", "ZeropsNotAMemberError"],
  ] as const) {
    it.effect(`a ${orgRole} caller: ${outcome}`, () =>
      Effect.gen(function* () {
        const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
        const attempt = mintZeropsThrowawayPairingCredential({ environment, token: TOKEN });
        if (outcome === "open") {
          const issued = yield* attempt;
          assert.strictEqual(issued.label, `Zerops ${orgRole}`);
        } else {
          const error = yield* Effect.flip(attempt);
          assert.strictEqual(error._tag, outcome);
          // A refusal issues nothing at all — not a narrower grant, nothing.
          const links = yield* serverAuth.listPairingLinks({ excludeSubjects: [] });
          assert.strictEqual(links.length, 0);
        }
      }).pipe(Effect.provide(makeLayer(throwawayRoute(orgRole)))),
    );
  }
});
