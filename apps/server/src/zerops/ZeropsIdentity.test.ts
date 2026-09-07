import { assert, describe, it } from "@effect/vitest";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { verifyProjectMembership } from "./ZeropsIdentity.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const USER_ID = "8yLPr0kbTA6MZKfMLBQe0A";
const TOKEN = "a-zerops-access-token";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: undefined,
})!;

interface StubbedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
}

const stub = (route: (url: string) => Response) => {
  const seen: Array<StubbedRequest> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      seen.push({
        url: request.url,
        authorization: request.headers.authorization,
      });
      return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
    }),
  );
  return { layer, seen } as const;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const USER_INFO_BODY = {
  id: USER_ID,
  clientUserList: [
    { id: "cu-other", clientId: "another-org", userId: USER_ID, roleCode: "MANAGER" },
    { id: "cu-1", clientId: CLIENT_ID, userId: USER_ID, roleCode: "OWNER" },
  ],
};

const memberRoute = (url: string) =>
  url.endsWith(`/project/${PROJECT_ID}`)
    ? json({ id: PROJECT_ID, clientId: CLIENT_ID, name: "z3-eval", status: "ACTIVE" })
    : url.endsWith("/user/info")
      ? json(USER_INFO_BODY)
      : json({ message: "unexpected route" }, 500);

describe("verifyProjectMembership", () => {
  for (const [orgRole, override, allowed] of [
    ["OWNER", undefined, true],
    ["ADMIN", undefined, true],
    ["BASIC_USER", undefined, true],
    ["READ_ONLY", undefined, false],
    ["NO_ACCESS", "BASIC_USER", true],
    ["OWNER", "READ_ONLY", false],
    ["ADMIN", "NO_ACCESS", false],
    ["OWNER", "UNKNOWN", false],
    ["UNKNOWN", undefined, false],
  ] as const) {
    it.effect(`AL-10 ${orgRole} with project override ${override} may operate: ${allowed}`, () => {
      const { layer } = stub((url) =>
        url.endsWith("/user/info")
          ? json({
              id: USER_ID,
              clientUserList: [
                { id: "cu-1", clientId: CLIENT_ID, userId: USER_ID, roleCode: orgRole },
              ],
            })
          : json({
              id: PROJECT_ID,
              clientId: CLIENT_ID,
              userRoles: override ? [{ clientUserId: "cu-1", roleCode: override }] : [],
            }),
      );
      const result = verifyProjectMembership({ environment, token: TOKEN });
      return Effect.gen(function* () {
        if (allowed) {
          const member = yield* result;
          assert.strictEqual(member.role, override ?? orgRole);
        } else {
          const error = yield* Effect.flip(result);
          assert.strictEqual(error._tag, "ZeropsNotAMemberError");
        }
      }).pipe(Effect.provide(layer));
    });
  }

  it.effect("returns the Zerops user id and the role for a member (200)", () => {
    const { layer, seen } = stub(memberRoute);
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.tap((member) =>
        Effect.sync(() => {
          assert.strictEqual(member.userId, USER_ID);
          assert.strictEqual(member.clientId, CLIENT_ID);
          assert.strictEqual(member.role, "OWNER");
          assert.deepStrictEqual(
            seen.map((request) => request.url),
            [
              `https://api.app-prg1.zerops.io/api/rest/public/project/${PROJECT_ID}`,
              "https://api.app-prg1.zerops.io/api/rest/public/user/info",
            ],
          );
          for (const request of seen) {
            assert.strictEqual(request.authorization, `Bearer ${TOKEN}`);
          }
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("AL-10 refuses membership in an unrelated organization", () => {
    // The caller sits in two orgs; only the entry whose clientId equals the
    // project's may decide the role (verified.md S0.1).
    const { layer } = stub((url) =>
      url.endsWith("/user/info")
        ? json({
            id: USER_ID,
            clientUserList: [
              { id: "cu-other", clientId: "another-org", userId: USER_ID, roleCode: "MANAGER" },
            ],
          })
        : memberRoute(url),
    );
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsNotAMemberError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails NotAMember on 403 insufficientPermissions and never asks /user/info", () => {
    const { layer, seen } = stub(() => json({ error: { code: "insufficientPermissions" } }, 403));
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          assert.strictEqual(error._tag, "ZeropsNotAMemberError");
          assert.strictEqual(seen.length, 1);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails InvalidToken on 401 notAuthorized", () => {
    const { layer } = stub(() => json({ error: { code: "notAuthorized" } }, 401));
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsInvalidTokenError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails ProjectNotFound on 400 projectNotFound — a misconfigured container", () => {
    const { layer } = stub(() => json({ error: { code: "projectNotFound" } }, 400));
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsProjectNotFoundError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails Unavailable on a 5xx", () => {
    const { layer } = stub(() => json({ message: "boom" }, 503));
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsApiUnavailableError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails Unavailable when the transport fails", () => {
    const layer = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die(new Error("connection refused"))),
    );
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsApiUnavailableError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("fails Unavailable when /user/info carries no usable user id", () => {
    const { layer } = stub((url) =>
      url.endsWith("/user/info") ? json({ clientUserList: [] }) : memberRoute(url),
    );
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsApiUnavailableError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("never puts the caller's token in a failure payload", () => {
    const { layer } = stub(() => json({ error: { code: "insufficientPermissions" } }, 403));
    return verifyProjectMembership({ environment, token: TOKEN }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => assert.notInclude(NodeUtil.inspect(error, { depth: 10 }), TOKEN)),
      ),
      Effect.provide(layer),
    );
  });
});
