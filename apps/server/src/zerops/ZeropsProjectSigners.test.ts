import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import { make as makeMateKey } from "./ZeropsMateKey.ts";
import {
  isMemberListComplete,
  loginTurnRefusal,
  isTurnStartingCommand,
  make as makeProjectSigners,
  parseSignerTags,
  planAgentSignOut,
  readActiveMemberIds,
  readProjectSigners,
  SIGNER_RECORD_WAIT,
  SIGNERS_CACHE_TTL,
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

  // Two records for one login (two sign-ins racing their tag writes, or a hand edit): whose it is
  // is not known, and never guessed from the order the platform lists the tags in.
  for (const [name, tags, expected] of [
    ["one record", [signerTag("claude-code", JAN)], { "claude-code": JAN }],
    [
      "the same person twice",
      [signerTag("claude-code", JAN), signerTag("claude-code", JAN)],
      { "claude-code": JAN },
    ],
    [
      "two people",
      [signerTag("claude-code", JAN), signerTag("claude-code", EVA)],
      { "claude-code": { among: [EVA, JAN] } },
    ],
    [
      "two people, listed the other way round",
      [signerTag("claude-code", EVA), signerTag("claude-code", JAN)],
      { "claude-code": { among: [EVA, JAN] } },
    ],
    [
      "two people on one login, one on another",
      [signerTag("claude-code", JAN), signerTag("claude-code", EVA), signerTag("codex", EVA)],
      { "claude-code": { among: [EVA, JAN] }, codex: EVA },
    ],
  ] as const) {
    it(`reads ${name}`, () => {
      assert.deepStrictEqual(parseSignerTags(tags), expected);
    });
  }

  it("reads nothing out of a project with no tags at all", () => {
    assert.deepStrictEqual(parseSignerTags(undefined), {});
  });

  // D6 per login: another login's signer is its own, never its agent's.
  it("reads a signer per login beside the agents' own", () => {
    assert.deepStrictEqual(
      parseSignerTags([
        signerTag("claude-code", JAN),
        signerTag("claudeAgent-work", EVA),
        signerTag("codex-home", JAN),
      ]),
      { "claude-code": JAN, "claudeAgent-work": EVA, "codex-home": JAN },
    );
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

// A login other than the defaults has no platform flag: its state is its own
// check's answer, and its signer is its own.
describe("loginTurnRefusal", () => {
  for (const [name, input, refusal] of [
    ["my own login", { state: "authorized", token: false, signer: JAN, subject: JAN }, undefined],
    [
      "a login a teammate signed in",
      { state: "authorized", token: false, signer: EVA, subject: JAN },
      { kind: "someone-else" },
    ],
    [
      "a login nobody's sign-in was recorded for",
      { state: "authorized", token: false, signer: undefined, subject: JAN },
      { kind: "unrecorded" },
    ],
    [
      "my login its own check has not answered for yet",
      { state: "registering", token: false, signer: JAN, subject: JAN },
      undefined,
    ],
    [
      "a login nobody signed in",
      { state: "not-authorized", token: false, signer: JAN, subject: JAN },
      { kind: "not-signed-in", auth: "not-authorized" },
    ],
    // Two records for one login: whose credential it is is not known, and a stale signer must
    // never run turns on another's — refused for everyone until somebody signs it in again.
    [
      "a login recorded for two people, one of them me",
      { state: "authorized", token: false, signer: { among: [EVA, JAN] }, subject: JAN },
      { kind: "unsettled" },
    ],
    [
      "a login recorded for two people, neither of them me",
      { state: "authorized", token: false, signer: { among: [EVA, JAN] }, subject: "ida-user-id" },
      { kind: "unsettled" },
    ],
    [
      "a project token somebody else set",
      { state: "authorized", token: true, signer: EVA, subject: JAN },
      undefined,
    ],
  ] as const) {
    it(`${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`, () => {
      assert.deepStrictEqual(loginTurnRefusal(input), refusal);
    });
  }
});

describe("isTurnStartingCommand", () => {
  it("gates the command that starts a turn", () => {
    assert.isTrue(isTurnStartingCommand({ type: "thread.turn.start" }));
  });

  // The decider turns an answer to a message-mode question into a turn of its
  // own; an answer to a native callback question continues the running turn.
  const respond = { type: "thread.user-input.respond" };
  for (const [name, request, expected] of [
    [
      "gates an answer to a pending message-mode question",
      { kind: "user-input.requested", payload: { responseMode: "message", questions: [] } },
      true,
    ],
    [
      "leaves an answer to a native callback question to every member",
      { kind: "user-input.requested", payload: { questions: [] } },
      false,
    ],
    [
      "leaves an answer to a message-mode question already resolved",
      { kind: "user-input.resolved", payload: { responseMode: "message" } },
      false,
    ],
    ["leaves an answer to a question it cannot find", undefined, false],
  ] as const) {
    it(name, () => {
      assert.strictEqual(isTurnStartingCommand(respond, request), expected);
    });
  }

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
      assert.isFalse(isTurnStartingCommand({ type }));
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

  // A record naming two people, one of whom has left: the credential may be theirs, so it goes.
  for (const [name, active, out] of [
    ["one of the two has left", [EVA], ["claude-code"]],
    ["both are still members", [EVA, JAN], []],
  ] as const) {
    it(`a record that names two people: ${name}`, () => {
      assert.deepStrictEqual(
        planAgentSignOut({
          signers: { "claude-code": { among: [EVA, JAN] } },
          activeMemberIds: new Set(active),
        }),
        out,
      );
    });
  }

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

describe("the turn gate", () => {
  const signedIn = {
    state: "authorized",
    providerAuth: "authenticated",
    credPresent: true,
    flagToken: false,
  } as const;

  /**
   * The service over a project whose tags the test changes between calls,
   * counting every project read the service makes. The member list is
   * unreadable, so the leave check never signs anybody out.
   */
  const gate = (initialTags: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      let tags = initialTags;
      let projectReads = 0;
      const signers = yield* makeProjectSigners.pipe(
        Effect.provide(
          Layer.mergeAll(
            httpLayer((url) => {
              if (url.endsWith("/user/list")) return json({ message: "down" }, 500);
              projectReads += 1;
              return json({ id: PROJECT_ID, clientId: CLIENT_ID, tagList: tags });
            }).layer,
            ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
            NodeServices.layer,
          ),
        ),
      );
      // The leave check's first pass reads the tags at start, and fills the cache.
      yield* TestClock.adjust(Duration.zero);
      return {
        signers,
        setTags: (next: ReadonlyArray<string>) => {
          tags = next;
        },
        reads: () => projectReads,
      };
    });

  it.effect(
    "a refusal on a cached signer read re-reads the tags and admits who just signed in",
    () =>
      Effect.gen(function* () {
        const { signers, setTags, reads } = yield* gate([]);
        const before = reads();
        // The person's sign-in lands inside the cache's lifetime.
        setTags([signerTag("claude-code", JAN)]);
        yield* TestClock.adjust(Duration.seconds(5));

        const refusal = yield* signers.turnRefusal({
          agentId: "claude-code",
          agent: signedIn,
          subject: JAN,
        });
        assert.isUndefined(refusal);
        assert.strictEqual(reads() - before, 1, "one re-read, no more");
      }).pipe(Effect.scoped),
  );

  it.effect("a re-read that still refuses refuses with the fresh answer", () =>
    Effect.gen(function* () {
      const { signers, setTags, reads } = yield* gate([signerTag("claude-code", EVA)]);
      const before = reads();
      setTags([]);
      yield* TestClock.adjust(Duration.seconds(5));

      const refusal = yield* signers.turnRefusal({
        agentId: "claude-code",
        agent: signedIn,
        subject: JAN,
      });
      assert.deepStrictEqual(refusal, { kind: "unrecorded" });
      assert.strictEqual(reads() - before, 1);
      // The fresh read replaced the cached one.
      assert.deepStrictEqual(yield* signers.signers, {});
      assert.strictEqual(reads() - before, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("a refusal on a read made for this very call is not read again", () =>
    Effect.gen(function* () {
      const { signers, reads } = yield* gate([signerTag("claude-code", EVA)]);
      yield* TestClock.adjust(SIGNERS_CACHE_TTL);
      const before = reads();

      const refusal = yield* signers.turnRefusal({
        agentId: "claude-code",
        agent: signedIn,
        subject: JAN,
      });
      assert.deepStrictEqual(refusal, { kind: "someone-else" });
      assert.strictEqual(reads() - before, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("another login is gated on its own signer, never its agent's", () =>
    Effect.gen(function* () {
      const { signers } = yield* gate([
        signerTag("claude-code", JAN),
        signerTag("claudeAgent-work", EVA),
      ]);
      const onWork = (subject: string) =>
        signers.loginRefusal({
          key: "claudeAgent-work",
          state: "authorized",
          token: false,
          subject,
        });

      assert.deepStrictEqual(yield* onWork(JAN), { kind: "someone-else" });
      assert.isUndefined(yield* onWork(EVA));
    }).pipe(Effect.scoped),
  );

  // A new Mate's first turn (its stand-up) leaves the moment its person's sign-in succeeds, and
  // the app writes that person's record as them in the same moment: the turn waits for the
  // record on its way instead of being refused ahead of it (a live run, 2026-09-30: refused a
  // second after the sign-in, the record read ~40 s later).
  const justSignedIn = (startedBy: string) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      return {
        agent: { ...signedIn, state: "local-only", providerAuth: "unknown" },
        login: { phase: "succeeded", terminalId: "t", startedAt: now, startedBy },
      } as const;
    });

  it.effect("a turn on its own person's sign-in just made waits for the record on its way", () =>
    Effect.gen(function* () {
      const { signers, setTags } = yield* gate([]);
      const { agent, login } = yield* justSignedIn(JAN);
      const fiber = yield* signers
        .turnRefusal({ agentId: "claude-code", agent, subject: JAN, login })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(2));
      setTags([signerTag("claude-code", JAN)]);
      yield* TestClock.adjust(Duration.seconds(2));

      assert.isUndefined(yield* Fiber.join(fiber));
    }).pipe(Effect.scoped),
  );

  it.effect("a record that never lands refuses once the wait is over", () =>
    Effect.gen(function* () {
      const { signers } = yield* gate([]);
      const { agent, login } = yield* justSignedIn(JAN);
      const fiber = yield* signers
        .turnRefusal({ agentId: "claude-code", agent, subject: JAN, login })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(SIGNER_RECORD_WAIT);
      yield* TestClock.adjust(Duration.seconds(1));

      assert.deepStrictEqual(yield* Fiber.join(fiber), { kind: "unrecorded" });
    }).pipe(Effect.scoped),
  );

  // A sign-in over somebody else's record, or over a record naming two people, ends in this
  // person's record too: their turn waits for it as for a first one.
  for (const [name, before] of [
    ["over another person's record", [signerTag("claude-code", EVA)]],
    [
      "over a record naming two people",
      [signerTag("claude-code", EVA), signerTag("claude-code", JAN)],
    ],
  ] as const) {
    it.effect(`a sign-in just made ${name} waits for its own record`, () =>
      Effect.gen(function* () {
        const { signers, setTags } = yield* gate(before);
        const { agent, login } = yield* justSignedIn(JAN);
        const fiber = yield* signers
          .turnRefusal({ agentId: "claude-code", agent, subject: JAN, login })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust(Duration.seconds(2));
        setTags([signerTag("claude-code", JAN)]);
        yield* TestClock.adjust(Duration.seconds(2));

        assert.isUndefined(yield* Fiber.join(fiber));
      }).pipe(Effect.scoped),
    );
  }

  // Until the new record lands, the old one names the person before: the credential is already
  // the new person's, so the one before runs nothing on it.
  it.effect("the signer before runs nothing on a credential somebody just signed in", () =>
    Effect.gen(function* () {
      const { signers } = yield* gate([signerTag("claude-code", EVA)]);
      const { agent, login } = yield* justSignedIn(JAN);

      assert.deepStrictEqual(
        yield* signers.turnRefusal({ agentId: "claude-code", agent, subject: EVA, login }),
        { kind: "someone-else" },
      );
      assert.isUndefined(
        yield* signers.turnRefusal({
          agentId: "claude-code",
          agent: { ...agent, state: "authorized-token", flagToken: true },
          subject: EVA,
          login,
        }),
        "a project token is nobody's login",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("somebody else's sign-in is nothing this turn waits for", () =>
    Effect.gen(function* () {
      const { signers, reads } = yield* gate([]);
      const { agent, login } = yield* justSignedIn(EVA);
      const before = reads();

      const refusal = yield* signers.turnRefusal({
        agentId: "claude-code",
        agent,
        subject: JAN,
        login,
      });
      assert.deepStrictEqual(refusal, { kind: "unrecorded" });
      assert.strictEqual(reads() - before, 1, "one re-read, no wait");
    }).pipe(Effect.scoped),
  );

  it.effect("an agent that is not signed in is refused without reading the tags again", () =>
    Effect.gen(function* () {
      const { signers, reads } = yield* gate([]);
      const before = reads();

      const refusal = yield* signers.turnRefusal({
        agentId: "claude-code",
        agent: { ...signedIn, state: "not-authorized", credPresent: false },
        subject: JAN,
      });
      assert.deepStrictEqual(refusal, { kind: "not-signed-in", auth: "not-authorized" });
      assert.strictEqual(reads() - before, 0);
    }).pipe(Effect.scoped),
  );
});

describe("isActiveMember", () => {
  /**
   * The service over an org whose member list the test changes between
   * calls, counting every member-list read. No signer is recorded, so the
   * leave check never reads the member list on its own.
   */
  const members = (initial: unknown, initialStatus = 200) =>
    Effect.gen(function* () {
      let body = initial;
      let status = initialStatus;
      let memberReads = 0;
      const signers = yield* makeProjectSigners.pipe(
        Effect.provide(
          Layer.mergeAll(
            httpLayer((url) => {
              if (!url.endsWith("/user/list")) {
                return json({ id: PROJECT_ID, clientId: CLIENT_ID, tagList: [] });
              }
              memberReads += 1;
              return json(body, status);
            }).layer,
            ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
            NodeServices.layer,
          ),
        ),
      );
      yield* TestClock.adjust(Duration.zero);
      return {
        signers,
        setMembers: (next: unknown, nextStatus = 200) => {
          body = next;
          status = nextStatus;
        },
        reads: () => memberReads,
      };
    });

  const janActive = { clientUserList: [{ id: "cu-jan", userId: JAN, status: "ACTIVE" }] };

  it.effect("answers yes for an ACTIVE member and no for anybody else", () =>
    Effect.gen(function* () {
      const { signers } = yield* members(janActive);
      assert.isTrue(yield* signers.isActiveMember(JAN));
      assert.isFalse(yield* signers.isActiveMember(EVA));
    }).pipe(Effect.scoped),
  );

  // "Cannot read" is neither answer: the caller refuses on it, and says why.
  it.effect("answers nothing when the member list cannot be read and nothing was known", () =>
    Effect.gen(function* () {
      const { signers } = yield* members({ message: "down" }, 500);
      assert.isUndefined(yield* signers.isActiveMember(JAN));
    }).pipe(Effect.scoped),
  );

  it.effect("reads the member list once per cache lifetime", () =>
    Effect.gen(function* () {
      const { signers, reads } = yield* members(janActive);
      yield* signers.isActiveMember(JAN);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* signers.isActiveMember(EVA);
      assert.strictEqual(reads(), 1);
      yield* TestClock.adjust(SIGNERS_CACHE_TTL);
      yield* signers.isActiveMember(JAN);
      assert.strictEqual(reads(), 2);
    }).pipe(Effect.scoped),
  );

  it.effect("a failed re-read answers from the last list read", () =>
    Effect.gen(function* () {
      const { signers, setMembers, reads } = yield* members(janActive);
      assert.isTrue(yield* signers.isActiveMember(JAN));
      setMembers({ message: "down" }, 500);
      yield* TestClock.adjust(SIGNERS_CACHE_TTL);
      assert.isTrue(yield* signers.isActiveMember(JAN));
      assert.strictEqual(reads(), 2);
    }).pipe(Effect.scoped),
  );
});
