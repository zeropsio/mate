import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { DOOR_THROWAWAY_MAX_AGE_MS, verifyThrowawayCaller } from "./ZeropsThrowawayIdentity.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const USER_ID = "8yLPr0kbTA6MZKfMLBQe0A";
const CLIENT_USER_ID = "cu-1";
const TOKEN_ID = "tok-throwaway";
/** The Mate's own key. Never the caller's, and never sent to the caller. */
const MATE_KEY = "the-mates-own-zerops-key";
const PRESENTED = "the-presented-throwaway";

const API_NOW = "Tue, 16 Sep 2026 10:00:00 GMT";
const API_NOW_MS = Date.parse(API_NOW);
const isoAt = (epochMs: number) => DateTime.formatIso(DateTime.makeUnsafe(epochMs));
const FRESH = isoAt(API_NOW_MS - 10_000);

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  allowedOrigins: [],
  apiToken: MATE_KEY,
})!;

interface SeenRequest {
  readonly url: string;
  readonly authorization: string | undefined;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const stub = (route: (url: string, token: string | undefined) => Response) => {
  const seen: Array<SeenRequest> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      const authorization = request.headers.authorization;
      seen.push({ url: request.url, authorization });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          route(request.url, authorization?.replace("Bearer ", "")),
        ),
      );
    }),
  );
  return { layer, seen } as const;
};

interface Scene {
  readonly project?: unknown;
  readonly projectStatus?: number;
  readonly userInfo?: unknown;
  readonly userInfoStatus?: number;
  readonly tokenRecord?: unknown;
  readonly tokenStatus?: number;
  readonly date?: string | null;
  readonly members?: unknown;
  readonly memberStatus?: number;
}

const TOKEN_RECORD = {
  id: TOKEN_ID,
  name: `mate-door:${PROJECT_ID}:a1b2c3`,
  created: FRESH,
  createdByUser: USER_ID,
  roleCode: "NO_ACCESS",
  projects: [],
  canCreateProjects: false,
};

const MEMBERS = {
  clientUserList: [
    {
      id: "cu-other",
      userId: "another-person",
      roleCode: "OWNER",
      status: "ACTIVE",
      canCreateProjects: true,
    },
    {
      id: CLIENT_USER_ID,
      userId: USER_ID,
      roleCode: "BASIC_USER",
      status: "ACTIVE",
      canCreateProjects: true,
    },
  ],
};

const scene = (overrides: Scene = {}) =>
  stub((url) => {
    if (url.endsWith(`/project/${PROJECT_ID}`)) {
      return json(
        overrides.project ?? { id: PROJECT_ID, clientId: CLIENT_ID },
        overrides.projectStatus ?? 200,
      );
    }
    if (url.endsWith("/user/info")) {
      return json(overrides.userInfo ?? { id: TOKEN_ID }, overrides.userInfoStatus ?? 200);
    }
    if (url.includes("/integration-token/")) {
      const date = overrides.date === undefined ? API_NOW : overrides.date;
      return json(
        overrides.tokenRecord ?? TOKEN_RECORD,
        overrides.tokenStatus ?? 200,
        date === null ? {} : { date },
      );
    }
    if (url.endsWith("/user/list")) {
      return json(overrides.members ?? MEMBERS, overrides.memberStatus ?? 200);
    }
    return json({ message: "unexpected route" }, 500);
  });

describe("verifyThrowawayCaller", () => {
  it.effect("admits the throwaway's creator and names them", () => {
    const { layer, seen } = scene();
    return verifyThrowawayCaller({ environment, token: PRESENTED }).pipe(
      Effect.tap((caller) =>
        Effect.sync(() => {
          assert.strictEqual(caller.userId, USER_ID);
          assert.strictEqual(caller.clientId, CLIENT_ID);
          assert.strictEqual(caller.role, "BASIC_USER");
          // Which credential each read used matters more than the reads
          // themselves: the caller's token never asks about anyone but
          // itself, and the Mate's key never leaves for anything else.
          assert.deepStrictEqual(
            seen.map((request) => [
              request.url.replace("https://api.app-prg1.zerops.io/api/rest/public", ""),
              request.authorization === `Bearer ${MATE_KEY}` ? "mate" : "caller",
            ]),
            [
              [`/project/${PROJECT_ID}`, "mate"],
              ["/user/info", "caller"],
              [`/client/${CLIENT_ID}/integration-token/${TOKEN_ID}`, "caller"],
              [`/client/${CLIENT_ID}/user/list`, "mate"],
            ],
          );
        }),
      ),
      Effect.provide(layer),
    );
  });

  // Every way a credential can fail to be this Mate's throwaway, and the rule
  // each one breaks. A refusal is never an admission and never an outage.
  for (const [name, overrides, rule] of [
    [
      "a personal token, which /user/info answers for but the token list does not",
      { userInfo: { id: USER_ID }, tokenStatus: 404 },
      "wrong_org",
    ],
    ["a token of another org", { tokenStatus: 403 }, "wrong_org"],
    ["a /user/info that names nobody", { userInfo: {} }, "token_dead"],
    ["a token /user/info refuses", { userInfoStatus: 403 }, "token_dead"],
    [
      "an integration token with ADMIN at the org",
      { tokenRecord: { ...TOKEN_RECORD, roleCode: "ADMIN" } },
      "has_rights",
    ],
    [
      "an integration token with BASIC_USER at the org",
      { tokenRecord: { ...TOKEN_RECORD, roleCode: "BASIC_USER" } },
      "has_rights",
    ],
    [
      "a token holding a project grant",
      {
        tokenRecord: { ...TOKEN_RECORD, projects: [{ projectId: PROJECT_ID, roleCode: "ADMIN" }] },
      },
      "has_rights",
    ],
    [
      "a token carrying can-create-projects — the shape a Mate's delegation mints",
      { tokenRecord: { ...TOKEN_RECORD, canCreateProjects: true } },
      "has_rights",
    ],
    [
      "a token carrying a finance flag",
      { tokenRecord: { ...TOKEN_RECORD, hasFinances: true } },
      "has_rights",
    ],
    [
      "a throwaway named for another Mate",
      { tokenRecord: { ...TOKEN_RECORD, name: "mate-door:some-other-project:a1b2c3" } },
      "wrong_name",
    ],
    [
      "a throwaway named for a Gitea sign-in",
      { tokenRecord: { ...TOKEN_RECORD, name: "gitea-signin:git.example.com:a1b2c3" } },
      "wrong_name",
    ],
    [
      "a stale throwaway, by the API's clock",
      {
        tokenRecord: {
          ...TOKEN_RECORD,
          created: isoAt(API_NOW_MS - DOOR_THROWAWAY_MAX_AGE_MS - 1_000),
        },
      },
      "stale",
    ],
    [
      "a throwaway whose created stamp does not parse",
      { tokenRecord: { ...TOKEN_RECORD, created: "the other day" } },
      "stale",
    ],
    ["a creator the member list does not know", { members: { clientUserList: [] } }, "not_member"],
    [
      "a creator who is invited but not active",
      {
        members: {
          clientUserList: [
            {
              id: CLIENT_USER_ID,
              userId: USER_ID,
              roleCode: "BASIC_USER",
              status: "INVITED",
              canCreateProjects: false,
            },
          ],
        },
      },
      "not_member",
    ],
    ["a token nobody made", { tokenRecord: { ...TOKEN_RECORD, createdByUser: "" } }, "not_member"],
  ] as const) {
    it.effect(`refuses ${name} (${rule})`, () => {
      const { layer } = scene(overrides);
      return Effect.flip(verifyThrowawayCaller({ environment, token: PRESENTED })).pipe(
        Effect.tap((error) =>
          Effect.sync(() => {
            assert.strictEqual(error._tag, "ZeropsThrowawayRefusedError");
            assert.strictEqual((error as { readonly rule?: string }).rule, rule);
          }),
        ),
        Effect.provide(layer),
      );
    });
  }

  for (const [orgRole, override, outcome] of [
    ["OWNER", undefined, "open"],
    ["ADMIN", undefined, "open"],
    ["BASIC_USER", undefined, "open"],
    ["READ_ONLY", undefined, "ZeropsReadOnlyError"],
    ["NO_ACCESS", undefined, "ZeropsNotAMemberError"],
    ["NO_ACCESS", "OWNER", "open"],
    ["READ_ONLY", "BASIC_USER", "open"],
    ["OWNER", "READ_ONLY", "ZeropsReadOnlyError"],
    ["OWNER", "NO_ACCESS", "ZeropsNotAMemberError"],
    // A role the platform grew and this build has never heard of shuts the
    // door rather than opening it.
    ["OWNER", "SUPERVISOR", "ZeropsNotAMemberError"],
    ["SUPERVISOR", undefined, "ZeropsNotAMemberError"],
  ] as const) {
    it.effect(`${orgRole} with project override ${String(override)} → ${outcome}`, () => {
      const { layer } = scene({
        project: {
          id: PROJECT_ID,
          clientId: CLIENT_ID,
          userRoles:
            override === undefined ? [] : [{ clientUserId: CLIENT_USER_ID, roleCode: override }],
        },
        members: {
          clientUserList: [
            {
              id: CLIENT_USER_ID,
              userId: USER_ID,
              roleCode: orgRole,
              status: "ACTIVE",
              canCreateProjects: false,
            },
          ],
        },
      });
      const check = verifyThrowawayCaller({ environment, token: PRESENTED });
      return Effect.gen(function* () {
        if (outcome === "open") {
          const caller = yield* check;
          assert.strictEqual(caller.userId, USER_ID);
          assert.strictEqual(caller.role, override ?? orgRole);
        } else {
          const error = yield* Effect.flip(check);
          assert.strictEqual(error._tag, outcome);
        }
      }).pipe(Effect.provide(layer));
    });
  }

  it.effect("grants the same scopes to every role that opens the door", () => {
    // The role decides whether the door opens, never how far: there is no
    // cut-down scope set, because `orchestration:read` alone already opens the
    // Data Console, `/var/www` reads and the browser stream.
    const { layer } = scene({
      members: {
        clientUserList: [
          {
            id: CLIENT_USER_ID,
            userId: USER_ID,
            roleCode: "OWNER",
            status: "ACTIVE",
            canCreateProjects: true,
          },
        ],
      },
    });
    return verifyThrowawayCaller({ environment, token: PRESENTED }).pipe(
      Effect.tap((caller) => Effect.sync(() => assert.strictEqual(caller.role, "OWNER"))),
      Effect.provide(layer),
    );
  });

  // A read that fails is never an admission — and never a refusal either, or a
  // platform blip would look like a colleague being thrown out.
  for (const [name, overrides] of [
    ["the member list cannot be read", { memberStatus: 500 }],
    ["the token record cannot be read", { tokenStatus: 500 }],
    ["our own project cannot be read", { projectStatus: 500 }],
    ["the caller's own read fails", { userInfoStatus: 500 }],
    ["the API sends no Date header to judge the age by", { date: null }],
    ["the token record is not an object", { tokenRecord: "a string" }],
    ["the member list is neither a page nor an array", { members: { members: [] } }],
  ] as const) {
    it.effect(`answers unavailable, not admitted, when ${name}`, () => {
      const { layer } = scene(overrides);
      return Effect.flip(verifyThrowawayCaller({ environment, token: PRESENTED })).pipe(
        Effect.tap((error) =>
          Effect.sync(() => assert.strictEqual(error._tag, "ZeropsApiUnavailableError")),
        ),
        Effect.provide(layer),
      );
    });
  }

  it.effect("answers unavailable when this Mate has no key of its own", () => {
    const { layer, seen } = scene();
    const keyless = resolveZeropsEnvironment({
      projectId: PROJECT_ID,
      apiHost: undefined,
      allowedOrigins: [],
    })!;
    return Effect.flip(verifyThrowawayCaller({ environment: keyless, token: PRESENTED })).pipe(
      Effect.tap((error) =>
        Effect.sync(() => {
          assert.strictEqual(error._tag, "ZeropsApiUnavailableError");
          assert.deepStrictEqual(seen, []);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("answers invalid-token when the platform rejects the credential", () => {
    const { layer } = scene({ userInfoStatus: 401 });
    return Effect.flip(verifyThrowawayCaller({ environment, token: PRESENTED })).pipe(
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsInvalidTokenError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("answers project-not-found when this container names a project nobody knows", () => {
    const { layer } = scene({ projectStatus: 404 });
    return Effect.flip(verifyThrowawayCaller({ environment, token: PRESENTED })).pipe(
      Effect.tap((error) =>
        Effect.sync(() => assert.strictEqual(error._tag, "ZeropsProjectNotFoundError")),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("refuses to guess at a member list under any other key", () => {
    // The platform answers `clientUserList`; `items` (the search endpoints'
    // key) and a bare array are shapes this door once accepted and the real
    // API never sends. Neither is an admission.
    const { layer } = scene({ members: { items: MEMBERS.clientUserList } });
    return verifyThrowawayCaller({ environment, token: PRESENTED }).pipe(
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          assert.strictEqual(error._tag, "ZeropsApiUnavailableError");
        }),
      ),
      Effect.provide(layer),
    );
  });
});
