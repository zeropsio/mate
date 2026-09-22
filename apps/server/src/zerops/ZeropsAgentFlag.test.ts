import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import {
  authTypeFlagKey,
  clearSignedIn,
  markSignedIn,
  oauthFlagKey,
  planClearSignedIn,
  planMarkSignedIn,
  readServiceEnvRows,
  type ServiceEnvRow,
} from "./ZeropsAgentFlag.ts";

describe("oauthFlagKey / authTypeFlagKey", () => {
  it("names the per-agent suffixes", () => {
    assert.strictEqual(oauthFlagKey("claude-code"), "ZCP_AGENT_OAUTH_CLAUDE_CODE");
    assert.strictEqual(oauthFlagKey("codex"), "ZCP_AGENT_OAUTH_CODEX");
    assert.strictEqual(authTypeFlagKey("claude-code"), "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE");
    assert.strictEqual(authTypeFlagKey("codex"), "ZCP_AGENT_AUTH_TYPE_CODEX");
  });
});

const row = (over: Partial<ServiceEnvRow>): ServiceEnvRow => ({
  id: "row-id",
  key: "SOME_KEY",
  content: "value",
  sensitive: false,
  ...over,
});

describe("planMarkSignedIn", () => {
  it("creates when the flag row is absent", () => {
    assert.deepStrictEqual(planMarkSignedIn([], "claude-code"), { action: "create" });
  });

  it('no-ops when the row is already non-sensitive "true"', () => {
    const env = [row({ key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true", sensitive: false })];
    assert.deepStrictEqual(planMarkSignedIn(env, "claude-code"), { action: "noop" });
  });

  it("recreates when the row carries the wrong value", () => {
    const env = [
      row({ id: "old", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "false", sensitive: false }),
    ];
    assert.deepStrictEqual(planMarkSignedIn(env, "claude-code"), {
      action: "recreate",
      deleteId: "old",
    });
  });

  it("recreates when the row is SENSITIVE, even with the right value", () => {
    const env = [
      row({ id: "old", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true", sensitive: true }),
    ];
    assert.deepStrictEqual(planMarkSignedIn(env, "claude-code"), {
      action: "recreate",
      deleteId: "old",
    });
  });

  it("only ever looks at the requested agent's own key", () => {
    const env = [row({ key: "ZCP_AGENT_OAUTH_CODEX", content: "true", sensitive: false })];
    assert.deepStrictEqual(planMarkSignedIn(env, "claude-code"), { action: "create" });
  });
});

describe("planClearSignedIn", () => {
  it("deletes nothing when neither row exists", () => {
    assert.deepStrictEqual(planClearSignedIn([], "claude-code"), {
      deleteOAuthId: undefined,
      deleteAuthTypeId: undefined,
    });
  });

  it("deletes the oauth row when present", () => {
    const env = [row({ id: "oauth-1", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE" })];
    assert.deepStrictEqual(planClearSignedIn(env, "claude-code"), {
      deleteOAuthId: "oauth-1",
      deleteAuthTypeId: undefined,
    });
  });

  it('deletes the auth-type row only when its content is "oauth"', () => {
    const env = [row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE", content: "oauth" })];
    assert.deepStrictEqual(planClearSignedIn(env, "claude-code"), {
      deleteOAuthId: undefined,
      deleteAuthTypeId: "type-1",
    });
  });

  it("leaves a token-typed auth-type row alone", () => {
    const env = [row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CLAUDE_CODE", content: "token" })];
    assert.deepStrictEqual(planClearSignedIn(env, "claude-code"), {
      deleteOAuthId: undefined,
      deleteAuthTypeId: undefined,
    });
  });

  it("deletes both rows together", () => {
    const env = [
      row({ id: "oauth-1", key: "ZCP_AGENT_OAUTH_CODEX" }),
      row({ id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CODEX", content: "oauth" }),
    ];
    assert.deepStrictEqual(planClearSignedIn(env, "codex"), {
      deleteOAuthId: "oauth-1",
      deleteAuthTypeId: "type-1",
    });
  });
});

describe("readServiceEnvRows", () => {
  it("reads well-formed rows", () => {
    assert.deepStrictEqual(
      readServiceEnvRows({
        items: [{ id: "1", key: "K", content: "v", sensitive: false, type: "USER_DATA" }],
      }),
      [{ id: "1", key: "K", content: "v", sensitive: false }],
    );
  });

  for (const [name, body] of [
    ["not an object", "nope"],
    ["missing items", {}],
    ["items not an array", { items: {} }],
  ] as const) {
    it(`answers undefined when the body is ${name}`, () => {
      assert.isUndefined(readServiceEnvRows(body));
    });
  }

  it("drops a malformed entry without poisoning the rest", () => {
    assert.deepStrictEqual(
      readServiceEnvRows({
        items: [
          { id: "1", key: "K", content: "v", sensitive: false },
          { id: "2", key: "BAD" },
          "not an object",
        ],
      }),
      [{ id: "1", key: "K", content: "v", sensitive: false }],
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const SERVICE_ID = "Nq49woUlTBeFYdP0jg4DQA";
const MATE_KEY = "the-mates-own-zerops-key";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  allowedOrigins: [],
  apiToken: MATE_KEY,
})!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const httpLayer = (route: (request: SeenRequest) => Response) => {
  const seen: Array<SeenRequest> = [];
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
          const seenRequest: SeenRequest = {
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            body,
          };
          seen.push(seenRequest);
          return HttpClientResponse.fromWeb(request, route(seenRequest));
        }),
      ),
    ),
    Layer.succeed(
      ZeropsMateKeyModule.ZeropsMateKey,
      ZeropsMateKeyModule.snapshotOnlyReader(MATE_KEY),
    ),
  );
  return { layer, seen } as const;
};

describe("markSignedIn", () => {
  it.effect("creates the row when it is absent", () => {
    const { layer, seen } = httpLayer((request) => {
      if (request.method === "GET") return json({ items: [] });
      return json({ id: "process-1" });
    });
    return markSignedIn({ environment, serviceId: SERVICE_ID, agentId: "claude-code" }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          assert.deepStrictEqual(result, {
            key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
            changed: true,
            migrated: false,
          });
          assert.deepStrictEqual(
            seen.map((entry) => entry.method),
            ["GET", "POST"],
          );
          assert.deepStrictEqual(seen[1]?.body, {
            key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
            content: "true",
            sensitive: false,
          });
          assert.strictEqual(seen[1]?.url.endsWith(`/service-stack/${SERVICE_ID}/user-data`), true);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect('does nothing when the row already reads non-sensitive "true"', () => {
    const { layer, seen } = httpLayer(() =>
      json({
        items: [{ id: "row-1", key: "ZCP_AGENT_OAUTH_CODEX", content: "true", sensitive: false }],
      }),
    );
    return markSignedIn({ environment, serviceId: SERVICE_ID, agentId: "codex" }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          assert.deepStrictEqual(result, {
            key: "ZCP_AGENT_OAUTH_CODEX",
            changed: false,
            migrated: false,
          });
          assert.deepStrictEqual(
            seen.map((entry) => entry.method),
            ["GET"],
          );
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("deletes then recreates a SENSITIVE row", () => {
    const { layer, seen } = httpLayer((request) => {
      if (request.method === "GET") {
        return json({
          items: [
            { id: "row-1", key: "ZCP_AGENT_OAUTH_CLAUDE_CODE", content: "true", sensitive: true },
          ],
        });
      }
      return json({ id: "process-1" });
    });
    return markSignedIn({ environment, serviceId: SERVICE_ID, agentId: "claude-code" }).pipe(
      Effect.tap((result) =>
        Effect.sync(() => {
          assert.deepStrictEqual(result, {
            key: "ZCP_AGENT_OAUTH_CLAUDE_CODE",
            changed: true,
            migrated: true,
          });
          assert.deepStrictEqual(
            seen.map((entry) => entry.method),
            ["GET", "DELETE", "POST"],
          );
          assert.strictEqual(seen[1]?.url.endsWith("/user-data/row-1"), true);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails when this container's own service id is unavailable", () => {
    const { layer } = httpLayer(() => {
      throw new Error("unreachable: no HTTP call is made without a service id");
    });
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        markSignedIn({ environment, serviceId: undefined, agentId: "claude-code" }),
      );
      assert.strictEqual(error._tag, "ZeropsAgentFlagError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("fails when the service's own environment cannot be read", () => {
    const { layer } = httpLayer(() => json({ message: "down" }, 500));
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        markSignedIn({ environment, serviceId: SERVICE_ID, agentId: "claude-code" }),
      );
      assert.strictEqual(error._tag, "ZeropsAgentFlagError");
    }).pipe(Effect.provide(layer));
  });
});

describe("clearSignedIn", () => {
  it.effect("is a no-op when neither row exists", () => {
    const { layer, seen } = httpLayer(() => json({ items: [] }));
    return clearSignedIn({ environment, serviceId: SERVICE_ID, agentId: "claude-code" }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          assert.deepStrictEqual(
            seen.map((entry) => entry.method),
            ["GET"],
          );
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("deletes the oauth row and an oauth-typed auth-type row together", () => {
    const { layer, seen } = httpLayer((request) => {
      if (request.method === "GET") {
        return json({
          items: [
            { id: "oauth-1", key: "ZCP_AGENT_OAUTH_CODEX", content: "true", sensitive: false },
            { id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CODEX", content: "oauth", sensitive: false },
          ],
        });
      }
      return json({});
    });
    return clearSignedIn({ environment, serviceId: SERVICE_ID, agentId: "codex" }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          const deletes = seen
            .filter((entry) => entry.method === "DELETE")
            .map((entry) => entry.url);
          assert.strictEqual(deletes.length, 2);
          assert.isTrue(deletes.some((url) => url.endsWith("/user-data/oauth-1")));
          assert.isTrue(deletes.some((url) => url.endsWith("/user-data/type-1")));
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("leaves a token-typed auth-type row alone", () => {
    const { layer, seen } = httpLayer((request) => {
      if (request.method === "GET") {
        return json({
          items: [
            { id: "type-1", key: "ZCP_AGENT_AUTH_TYPE_CODEX", content: "token", sensitive: false },
          ],
        });
      }
      return json({});
    });
    return clearSignedIn({ environment, serviceId: SERVICE_ID, agentId: "codex" }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          assert.deepStrictEqual(
            seen.map((entry) => entry.method),
            ["GET"],
          );
        }),
      ),
      Effect.provide(layer),
    );
  });
});
