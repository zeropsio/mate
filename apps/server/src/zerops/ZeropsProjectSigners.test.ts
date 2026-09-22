import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { make as makeMateKey } from "./ZeropsMateKey.ts";
import {
  isMemberListComplete,
  isTurnStartingCommand,
  parseSignerTags,
  planAgentSignOut,
  readActiveMemberIds,
  readProjectSigners,
  signerTag,
  turnRefusal,
} from "./ZeropsProjectSigners.ts";

const JAN = "jan-user-id";
const EVA = "eva-user-id";

describe("parseSignerTags", () => {
  it("reads a signer per agent and leaves every other tag alone", () => {
    assert.deepStrictEqual(
      parseSignerTags([
        "mate:g:acme",
        signerTag("claude-code", JAN),
        "mate:role:dev",
        signerTag("codex", EVA),
      ]),
      { "claude-code": JAN, codex: EVA },
    );
  });

  // A tag list is a shared space — people put their own tags there — and one
  // this build does not understand must never cost it the ones it does.
  for (const [name, tag] of [
    ["an agent this build has never heard of", "mate:signer:cursor:jan"],
    ["a tag naming nobody", "mate:signer:claude-code:"],
    ["a tag naming no agent", "mate:signer::jan"],
    ["a tag with nothing after the prefix", "mate:signer:"],
    ["something merely named like one", "mate:signers:claude-code:jan"],
    ["an ordinary group tag", "mate:g:acme"],
  ] as const) {
    it(`drops ${name}`, () => {
      assert.deepStrictEqual(parseSignerTags([tag]), {});
    });
  }

  it("reads nothing out of a project with no tags at all", () => {
    assert.deepStrictEqual(parseSignerTags(undefined), {});
  });
});

describe("turnRefusal", () => {
  const signedIn = {
    state: "authorized",
    providerAuth: "authenticated",
    credPresent: true,
    flagToken: false,
  } as const;
  const tokenAgent = {
    state: "authorized-token",
    providerAuth: "unknown",
    credPresent: false,
    flagToken: true,
  } as const;
  // Is the agent signed in at all, then whose is it: mine / someone else's /
  // unrecorded / a token agent.
  for (const [name, input, refusal] of [
    ["my own agent", { agent: signedIn, signer: JAN, subject: JAN }, undefined],
    [
      "an agent somebody else signed in",
      { agent: signedIn, signer: EVA, subject: JAN },
      { kind: "someone-else" },
    ],
    // D6 keeps no backward compatibility: an older login, a terminal login or
    // a copied credential file runs for nobody until someone signs in here.
    [
      "an agent nobody's sign-in was recorded for",
      { agent: signedIn, signer: undefined, subject: JAN },
      { kind: "unrecorded" },
    ],
    [
      "an agent whose recorded signer is blank",
      { agent: signedIn, signer: "", subject: JAN },
      { kind: "unrecorded" },
    ],
    [
      "a caller the session could not name",
      { agent: signedIn, signer: JAN, subject: undefined },
      { kind: "someone-else" },
    ],
    // An API key belongs to the project, not to a person.
    [
      "a token-authorized agent somebody else signed in",
      { agent: tokenAgent, signer: EVA, subject: JAN },
      undefined,
    ],
    [
      "a token-authorized agent with no record at all",
      { agent: tokenAgent, signer: undefined, subject: JAN },
      undefined,
    ],
    // Signed in inside the container, the project flag seconds away: the CLI
    // works, so only whose it is decides.
    [
      "my agent still being registered",
      {
        agent: { ...signedIn, state: "local-only" },
        signer: JAN,
        subject: JAN,
      },
      undefined,
    ],
    // Not signed in is refused before anything else: the turn would only fail
    // inside the agent CLI.
    [
      "an agent nobody signed in",
      {
        agent: {
          state: "not-authorized",
          providerAuth: "unauthenticated",
          credPresent: false,
          flagToken: false,
        },
        signer: undefined,
        subject: JAN,
      },
      { kind: "not-signed-in", auth: "not-authorized" },
    ],
    [
      "an agent the project signed in but this container has no login for",
      {
        agent: { ...signedIn, credPresent: false, state: "reconnect" },
        signer: JAN,
        subject: JAN,
      },
      { kind: "not-signed-in", auth: "reconnect" },
    ],
    [
      "an agent whose own check says its login no longer works",
      {
        agent: { ...signedIn, providerAuth: "unauthenticated" },
        signer: JAN,
        subject: JAN,
      },
      { kind: "not-signed-in", auth: "needs-reauth" },
    ],
  ] as const) {
    it(`${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`, () => {
      assert.deepStrictEqual(turnRefusal(input), refusal);
    });
  }
});

describe("isTurnStartingCommand", () => {
  it("gates the one command that spends a subscription", () => {
    assert.isTrue(isTurnStartingCommand("thread.turn.start"));
  });

  // Everything else stays open to every member who can open the Mate: a
  // colleague must be able to stop an agent they are not allowed to start.
  for (const type of [
    "thread.turn.interrupt",
    "thread.session.stop",
    "thread.archive",
    "thread.settle",
    "thread.create",
    "thread.meta.update",
    "project.create",
  ]) {
    it(`leaves ${type} to every member`, () => {
      assert.isFalse(isTurnStartingCommand(type));
    });
  }
});

describe("planAgentSignOut", () => {
  it("signs out the agent whose signer the org no longer knows", () => {
    assert.deepStrictEqual(
      planAgentSignOut({
        signers: { "claude-code": JAN, codex: EVA },
        activeMemberIds: new Set([EVA]),
      }),
      ["claude-code"],
    );
  });

  it("leaves an agent whose signer is still a member", () => {
    assert.deepStrictEqual(
      planAgentSignOut({ signers: { "claude-code": JAN }, activeMemberIds: new Set([JAN]) }),
      [],
    );
  });

  // Absence of evidence is not evidence of a leaver, and this read is the one
  // thing between a platform blip and a room full of deleted logins.
  it("signs nobody out when the member list could not be read", () => {
    assert.deepStrictEqual(
      planAgentSignOut({ signers: { "claude-code": JAN }, activeMemberIds: undefined }),
      [],
    );
  });

  it("signs nobody out when nothing is recorded", () => {
    assert.deepStrictEqual(planAgentSignOut({ signers: {}, activeMemberIds: new Set() }), []);
  });
});

describe("isMemberListComplete", () => {
  for (const [name, body, entriesLength, expected] of [
    ["no totalCount at all", {}, 3, true],
    ["body is not an object", null, 0, true],
    ["totalCount matches the rows read", { totalCount: 2 }, 2, true],
    ["totalCount is fewer than the rows read", { totalCount: 1 }, 2, true],
    ["totalCount exceeds the rows read", { totalCount: 5 }, 2, false],
    ["totalCount is not a finite number", { totalCount: "5" }, 2, true],
  ] as const) {
    it(name, () => {
      assert.strictEqual(isMemberListComplete(body, entriesLength), expected);
    });
  }
});

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
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

const httpLayer = (
  route: (url: string) => Response,
  mateKey: ZeropsMateKeyModule.ZeropsMateKeyReader = ZeropsMateKeyModule.snapshotOnlyReader(
    MATE_KEY,
  ),
) => {
  const seen: Array<string | undefined> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        seen.push(request.headers.authorization);
        return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
      }),
    ),
    Layer.succeed(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
  );
  return { layer, seen } as const;
};

describe("readProjectSigners", () => {
  it.effect("reads the tags with the Mate's own key, and nobody else's", () => {
    const { layer, seen } = httpLayer(() =>
      json({ id: PROJECT_ID, clientId: CLIENT_ID, tagList: [signerTag("claude-code", JAN)] }),
    );
    return readProjectSigners({ environment }).pipe(
      Effect.tap((signers) =>
        Effect.sync(() => {
          assert.deepStrictEqual(signers, { "claude-code": JAN });
          assert.deepStrictEqual(seen, [`Bearer ${MATE_KEY}`]);
        }),
      ),
      Effect.provide(layer),
    );
  });

  // "Cannot read" is not "nobody signed in": the gate refuses on unknown, and
  // the cache keeps whatever was last known so a blip never locks the person
  // who signed in out of their own agent.
  for (const [name, route] of [
    ["the project read fails", () => json({ message: "down" }, 500)],
    ["the project read is not a project", () => json({ nope: true })],
  ] as const) {
    it.effect(`answers nothing when ${name}`, () =>
      readProjectSigners({ environment }).pipe(
        Effect.tap((signers) => Effect.sync(() => assert.isUndefined(signers))),
        Effect.provide(httpLayer(route).layer),
      ),
    );
  }

  it.effect("makes no call at all when this Mate has no key of its own", () => {
    const { layer, seen } = httpLayer(
      () => json({}),
      ZeropsMateKeyModule.snapshotOnlyReader(undefined),
    );
    const keyless = resolveZeropsEnvironment({
      projectId: PROJECT_ID,
      apiHost: undefined,
      allowedOrigins: [],
    })!;
    return readProjectSigners({ environment: keyless }).pipe(
      Effect.tap((signers) =>
        Effect.sync(() => {
          assert.isUndefined(signers);
          assert.deepStrictEqual(seen, []);
        }),
      ),
      Effect.provide(layer),
    );
  });

  it.effect("a key rotated in the store is retried once, not treated as a failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-signers-key-rotate-" });
      const storePath = path.join(dir, "env.json");
      yield* fs.writeFileString(storePath, `{"ZCP_API_KEY":"old-key"}`);
      const mateKey = yield* makeMateKey({ fs, snapshot: MATE_KEY, storePath });

      const layer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const token = request.headers.authorization?.replace("Bearer ", "");
            if (token === "old-key") {
              yield* fs.writeFileString(storePath, `{"ZCP_API_KEY":"new-key"}`).pipe(Effect.orDie);
              return HttpClientResponse.fromWeb(request, json({}, 401));
            }
            return HttpClientResponse.fromWeb(
              request,
              json({
                id: PROJECT_ID,
                clientId: CLIENT_ID,
                tagList: [signerTag("claude-code", JAN)],
              }),
            );
          }),
        ),
      );

      const signers = yield* readProjectSigners({ environment }).pipe(
        Effect.provide(layer),
        Effect.provideService(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
      );
      assert.deepStrictEqual(signers, { "claude-code": JAN });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("readActiveMemberIds", () => {
  const route =
    (members: unknown, status = 200) =>
    (url: string) =>
      url.endsWith("/user/list")
        ? json(members, status)
        : json({ id: PROJECT_ID, clientId: CLIENT_ID });

  it.effect("names every ACTIVE member and nobody else", () =>
    readActiveMemberIds({ environment }).pipe(
      Effect.tap((ids) =>
        Effect.sync(() =>
          assert.deepStrictEqual(
            ids === undefined ? [] : [...ids].toSorted(),
            [EVA, JAN].toSorted(),
          ),
        ),
      ),
      Effect.provide(
        httpLayer(
          route({
            clientUserList: [
              { id: "cu-jan", userId: JAN, status: "ACTIVE" },
              { id: "cu-eva", userId: EVA, status: "ACTIVE" },
              { id: "cu-gone", userId: "gone", status: "INVITED" },
            ],
          }),
        ).layer,
      ),
    ),
  );

  // An empty list is an outage dressed as an answer, and acting on it would
  // delete every login in the container.
  for (const [name, members, status] of [
    ["the member list cannot be read", {}, 500],
    ["the member list comes back empty", { clientUserList: [] }, 200],
    ["the member list is not a list", { members: [] }, 200],
  ] as const) {
    it.effect(`answers nothing when ${name}`, () =>
      readActiveMemberIds({ environment }).pipe(
        Effect.tap((ids) => Effect.sync(() => assert.isUndefined(ids))),
        Effect.provide(httpLayer(route(members, status)).layer),
      ),
    );
  }

  // S6: a page is not the whole org, so nobody merely off it counts as gone.
  it.effect("a partial member list signs nobody out", () =>
    readActiveMemberIds({ environment }).pipe(
      Effect.tap((ids) => Effect.sync(() => assert.isUndefined(ids))),
      Effect.provide(
        httpLayer(
          route({
            clientUserList: [{ id: "cu-jan", userId: JAN, status: "ACTIVE" }],
            totalCount: 2,
          }),
        ).layer,
      ),
    ),
  );

  it.effect("a totalCount that matches the row count is not partial", () =>
    readActiveMemberIds({ environment }).pipe(
      Effect.tap((ids) =>
        Effect.sync(() => assert.deepStrictEqual(ids === undefined ? [] : [...ids], [JAN])),
      ),
      Effect.provide(
        httpLayer(
          route({
            clientUserList: [{ id: "cu-jan", userId: JAN, status: "ACTIVE" }],
            totalCount: 1,
          }),
        ).layer,
      ),
    ),
  );
});
