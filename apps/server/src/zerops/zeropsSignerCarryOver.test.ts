import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";

import {
  carrySignersOver,
  liveCarryOverSources,
  loginCredentialPath,
  planSignerCarryOver,
  type CarryOverSources,
} from "./zeropsSignerCarryOver.ts";
import { memorySignInStore, type SignInRecords } from "./zeropsSignIns.ts";

const JAN = "u-jan-fixture";
const EVA = "u-eva-fixture";
const tag = (key: string, userId: string) => `mate:signer:${key}:${userId}`;

describe("planSignerCarryOver", () => {
  const cases: ReadonlyArray<
    readonly [
      name: string,
      input: {
        readonly named?: ReadonlyArray<string>;
        readonly held?: ReadonlyArray<string>;
        readonly tags?: ReadonlyArray<string>;
        readonly saved?: Readonly<Record<string, string>>;
      },
      expected: Readonly<Record<string, string>>,
    ]
  > = [
    [
      "a login signed in before the record began takes its tag's signer",
      { held: ["claude-code"], tags: ["mate", tag("claude-code", JAN)] },
      { "claude-code": JAN },
    ],
    [
      "a login whose tag HQ's port removed takes HQ's saved signer",
      { held: ["codex"], saved: { codex: EVA } },
      { codex: EVA },
    ],
    [
      "the tag and HQ naming the same person carry that person",
      { held: ["claude-code"], tags: [tag("claude-code", JAN)], saved: { "claude-code": JAN } },
      { "claude-code": JAN },
    ],
    [
      "another login takes its own tag, never its agent's",
      {
        held: ["claudeAgent-work", "claude-code"],
        tags: [tag("claudeAgent-work", EVA), tag("claude-code", JAN)],
      },
      { "claudeAgent-work": EVA, "claude-code": JAN },
    ],
    [
      "a login the record names keeps its record",
      { named: ["claude-code"], held: ["claude-code"], tags: [tag("claude-code", JAN)] },
      {},
    ],
    [
      "a login with no credential here carries nothing",
      { held: [], tags: [tag("claude-code", JAN)] },
      {},
    ],
    [
      "two people named by the tags carry nobody",
      { held: ["claude-code"], tags: [tag("claude-code", JAN), tag("claude-code", EVA)] },
      {},
    ],
    [
      "the tag and HQ naming two people carry nobody",
      { held: ["claude-code"], tags: [tag("claude-code", JAN)], saved: { "claude-code": EVA } },
      {},
    ],
    [
      "a key no build signs in, or a malformed tag, carries nothing",
      {
        held: ["cursor", "claude-code", "codex"],
        tags: [
          tag("cursor", JAN),
          "mate:signer:claude-code",
          "mate:signer:codex:",
          "mate:signer::x",
        ],
        saved: { cursor: EVA, codex: "x".repeat(200) },
      },
      {},
    ],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      assert.deepStrictEqual(
        planSignerCarryOver({
          named: new Set(input.named ?? []),
          held: new Set(input.held ?? []),
          tags: input.tags ?? [],
          saved: input.saved ?? {},
        }),
        expected,
      );
    });
  }
});

describe("loginCredentialPath", () => {
  for (const [key, expected] of [
    ["claude-code", "/home/zerops/.claude/.credentials.json"],
    ["codex", "/home/zerops/.codex/auth.json"],
    ["claudeAgent-work", "/home/zerops/.mate/logins/claudeAgent-work/.credentials.json"],
    ["codex-work", "/home/zerops/.mate/logins/codex-work/auth.json"],
    ["cursor", undefined],
  ] as const) {
    it(`finds the credential of ${key}`, () => {
      assert.strictEqual(loginCredentialPath("/home/zerops", key), expected);
    });
  }
});

describe("carrySignersOver", () => {
  const sources = (input: {
    readonly done?: boolean;
    readonly held?: ReadonlyArray<string>;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly saved?: Readonly<Record<string, string>> | undefined;
  }) =>
    Effect.gen(function* () {
      const done = yield* Ref.make(input.done ?? false);
      const reads = yield* Ref.make(0);
      const read = <A>(value: A) => Ref.update(reads, (n) => n + 1).pipe(Effect.as(value));
      const held = new Set(input.held ?? []);
      return {
        done,
        reads,
        sources: {
          done: Ref.get(done),
          markDone: () => Ref.set(done, true),
          credentialHeld: (key) => Effect.succeed(held.has(key)),
          readTags: read("tags" in input ? input.tags : []),
          readSaved: read("saved" in input ? input.saved : {}),
        } satisfies CarryOverSources,
      };
    });

  it.effect("keeps the old signer once, and is done", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources: from, done } = yield* sources({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, from), ["claude-code"]);
      assert.strictEqual((yield* store.load)["claude-code"]?.by, JAN);
      assert.isTrue(yield* Ref.get(done));
    }),
  );

  it.effect("reads nothing at a start after it is done", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources: from, reads } = yield* sources({
        done: true,
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, from), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.strictEqual(yield* Ref.get(reads), 0);
    }),
  );

  it.effect("is done even when there was nothing to carry", () =>
    Effect.gen(function* () {
      const { sources: from, done } = yield* sources({ tags: [tag("claude-code", JAN)] });

      assert.deepStrictEqual(yield* carrySignersOver(yield* memorySignInStore(), from), []);
      assert.isTrue(yield* Ref.get(done));
    }),
  );

  it.effect("tags that cannot be read carry nothing, and leave it to the next start", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources: from, done } = yield* sources({
        held: ["codex"],
        tags: undefined,
        saved: { codex: EVA },
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, from), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.isFalse(yield* Ref.get(done));
    }),
  );

  it.effect(
    "an HQ that does not answer leaves the tags' signers carried, and the rest to later",
    () =>
      Effect.gen(function* () {
        const store = yield* memorySignInStore();
        const { sources: from, done } = yield* sources({
          held: ["claude-code"],
          tags: [tag("claude-code", JAN)],
          saved: undefined,
        });

        assert.deepStrictEqual(yield* carrySignersOver(store, from), ["claude-code"]);
        assert.isFalse(yield* Ref.get(done));
      }),
  );

  it.effect("never writes over the history of a login whose credential went", () =>
    Effect.gen(function* () {
      const kept: SignInRecords = { "claude-code": { by: EVA, at: 1, credentialCleared: true } };
      const store = yield* memorySignInStore(kept);
      const { sources: from } = yield* sources({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, from), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.deepStrictEqual(yield* store.lastSigners, { "claude-code": EVA });
    }),
  );
});

// What a start reads the old record from: the project's tags with the Mate's own key, and HQ's
// saved signers with the Mate's credential. Only an answer counts; a failure is the next start's.
describe("liveCarryOverSources", () => {
  const PROJECT = "project-fixture";
  const HQ = "https://hq.example.test";
  const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
  const respond = (body: unknown, status: number) =>
    new Response(encodeJson(body), { status, headers: { "content-type": "application/json" } });

  const read = (input: {
    readonly project: readonly [body: unknown, status: number];
    readonly hq?: readonly [body: unknown, status: number];
  }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-carry-" });
      const enrollment = `${home}/enrollment.json`;
      if (input.hq !== undefined) {
        yield* fs.writeFileString(
          enrollment,
          encodeJson({ hq: HQ, credential: "mate-credential" }),
        );
      }
      const environment = {
        ...resolveZeropsEnvironment({
          projectId: PROJECT,
          apiHost: undefined,
          allowedOrigins: [],
          apiToken: "mate-key",
        })!,
        hqEnrollmentPath: enrollment,
      };
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            request.url === `${HQ}/api/mate/self`
              ? respond(...(input.hq ?? [{}, 500]))
              : respond(...input.project),
          ),
        ),
      );
      const sources = yield* liveCarryOverSources({ homeDir: home, environment }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(
          ZeropsMateKeyModule.ZeropsMateKey,
          ZeropsMateKeyModule.snapshotOnlyReader("mate-key"),
        ),
      );
      return { tags: yield* sources.readTags, saved: yield* sources.readSaved };
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

  const project = [{ id: PROJECT, tagList: ["mate", tag("codex", JAN)] }, 200] as const;
  for (const [name, input, expected] of [
    [
      "both answer",
      { project, hq: [{ projectId: PROJECT, signers: { codex: EVA } }, 200] },
      { tags: ["mate", tag("codex", JAN)], saved: { codex: EVA } },
    ],
    [
      "no HQ enrolled: nothing saved",
      { project },
      { tags: ["mate", tag("codex", JAN)], saved: {} },
    ],
    [
      "an HQ with no record of this Mate: nothing saved",
      { project, hq: [{ code: "mate_not_found" }, 404] },
      { tags: ["mate", tag("codex", JAN)], saved: {} },
    ],
    [
      "an HQ that refuses this Mate: nothing saved",
      { project, hq: [{ code: "mate_credential_required" }, 401] },
      { tags: ["mate", tag("codex", JAN)], saved: {} },
    ],
    [
      "an HQ that fails: no answer",
      { project, hq: [{}, 503] },
      { tags: ["mate", tag("codex", JAN)], saved: undefined },
    ],
    [
      "a project that cannot be read: no answer",
      { project: [{ message: "down" }, 500], hq: [{ signers: {} }, 200] },
      { tags: undefined, saved: {} },
    ],
  ] as const) {
    it.effect(name, () =>
      Effect.gen(function* () {
        assert.deepStrictEqual<unknown>(yield* read(input), expected);
      }),
    );
  }
});
