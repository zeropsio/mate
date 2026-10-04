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
  type CarryOverMarker,
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
  /** One container across starts: its marker, its credentials, and what Zerops and HQ answer. */
  const container = (input: {
    readonly held?: ReadonlyArray<string>;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly saved?: Readonly<Record<string, string>> | undefined;
    readonly marker?: CarryOverMarker;
    readonly keeps?: boolean;
  }) =>
    Effect.gen(function* () {
      const marker = yield* Ref.make<CarryOverMarker | undefined>(input.marker);
      const held = yield* Ref.make<ReadonlyArray<string>>(input.held ?? []);
      const tags = yield* Ref.make("tags" in input ? input.tags : []);
      const saved = yield* Ref.make("saved" in input ? input.saved : {});
      const reads = yield* Ref.make(0);
      const read = <A>(ref: Ref.Ref<A>) =>
        Ref.update(reads, (n) => n + 1).pipe(Effect.andThen(Ref.get(ref)));
      const sources: CarryOverSources = {
        marker: Ref.get(marker),
        keepMarker: (next) =>
          input.keeps === false
            ? Effect.succeed(false)
            : Ref.set(marker, next).pipe(Effect.as(true)),
        heldLogins: Ref.get(held),
        readTags: read(tags),
        readSaved: read(saved),
      };
      return { sources, marker, held, tags, saved, reads };
    });

  it.effect("keeps the old signer once, and is done", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources, marker } = yield* container({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), ["claude-code"]);
      assert.strictEqual((yield* store.load)["claude-code"]?.by, JAN);
      assert.deepStrictEqual(yield* Ref.get(marker), { state: "done" });
    }),
  );

  it.effect("reads nothing at a start after it is done", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources, reads } = yield* container({
        marker: { state: "done" },
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.strictEqual(yield* Ref.get(reads), 0);
    }),
  );

  it.effect("is done even when there was nothing to carry", () =>
    Effect.gen(function* () {
      const { sources, marker } = yield* container({ tags: [tag("claude-code", JAN)] });

      assert.deepStrictEqual(yield* carrySignersOver(yield* memorySignInStore(), sources), []);
      assert.deepStrictEqual(yield* Ref.get(marker), { state: "done" });
    }),
  );

  it.effect("carries nothing when it cannot keep which logins it may carry", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources, reads } = yield* container({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
        keeps: false,
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.strictEqual(yield* Ref.get(reads), 0);
    }),
  );

  it.effect("tags that cannot be read carry nothing, and leave it open", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources, marker } = yield* container({
        held: ["codex"],
        tags: undefined,
        saved: { codex: EVA },
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
      assert.deepStrictEqual(yield* store.load, {});
      assert.deepStrictEqual(yield* Ref.get(marker), {
        state: "open",
        eligible: ["codex"],
        starts: 1,
      });
    }),
  );

  // HQ fails at the update's start; a terminal login turns up before the next one. The tags
  // still name Jan for it, but it held no credential when the carry-over began.
  it.effect("a login whose credential turns up while it is open is never carried", () =>
    Effect.gen(function* () {
      const store = yield* memorySignInStore();
      const { sources, held, saved } = yield* container({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN), tag("codex", JAN)],
        saved: undefined,
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), ["claude-code"]);
      yield* Ref.set(held, ["claude-code", "codex"]);
      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
      yield* Ref.set(saved, { codex: JAN });
      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
      assert.deepStrictEqual(Object.keys(yield* store.load), ["claude-code"]);
    }),
  );

  it.effect("an HQ that never answers closes it at the third start", () =>
    Effect.gen(function* () {
      const { sources, marker } = yield* container({ saved: undefined });
      const store = yield* memorySignInStore();

      for (const starts of [1, 2]) {
        yield* carrySignersOver(store, sources);
        assert.deepStrictEqual(yield* Ref.get(marker), { state: "open", eligible: [], starts });
      }
      yield* carrySignersOver(store, sources);
      assert.deepStrictEqual(yield* Ref.get(marker), { state: "done" });
    }),
  );

  it.effect(
    "an HQ that answers at a later start adds its signer for a login held from the first",
    () =>
      Effect.gen(function* () {
        const store = yield* memorySignInStore();
        const { sources, saved, marker } = yield* container({
          held: ["codex"],
          tags: ["mate"],
          saved: undefined,
        });

        assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
        yield* Ref.set(saved, { codex: EVA });
        assert.deepStrictEqual(yield* carrySignersOver(store, sources), ["codex"]);
        assert.deepStrictEqual(yield* Ref.get(marker), { state: "done" });
      }),
  );

  it.effect("never writes over the history of a login whose credential went", () =>
    Effect.gen(function* () {
      const kept: SignInRecords = { "claude-code": { by: EVA, at: 1, credentialCleared: true } };
      const store = yield* memorySignInStore(kept);
      const { sources } = yield* container({
        held: ["claude-code"],
        tags: [tag("claude-code", JAN)],
      });

      assert.deepStrictEqual(yield* carrySignersOver(store, sources), []);
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
    ...[401, 403, 408, 429, 503].map(
      (status) =>
        [
          `an HQ that answers ${status}: no answer`,
          { project, hq: [{ code: "refused" }, status] },
          { tags: ["mate", tag("codex", JAN)], saved: undefined },
        ] as const,
    ),
    [
      "a 200 that is not HQ's Mate: no answer",
      { project, hq: [{ ok: true }, 200] },
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

describe("liveCarryOverSources on the container", () => {
  const environment = resolveZeropsEnvironment({
    projectId: "project-fixture",
    apiHost: undefined,
    allowedOrigins: [],
    apiToken: "mate-key",
  })!;
  const sourcesIn = (home: string) =>
    liveCarryOverSources({ homeDir: home, environment }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.die("no read")),
      ),
      Effect.provideService(
        ZeropsMateKeyModule.ZeropsMateKey,
        ZeropsMateKeyModule.snapshotOnlyReader("mate-key"),
      ),
    );

  it.effect("finds every login whose credential is here, the further ones by their homes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-carry-" });
      const file = (relative: string) =>
        Effect.gen(function* () {
          const at = `${home}/${relative}`;
          yield* fs.makeDirectory(at.slice(0, at.lastIndexOf("/")), { recursive: true });
          yield* fs.writeFileString(at, "{}");
        });
      yield* file(".claude/.credentials.json");
      yield* file(".mate/logins/codex-work/auth.json");
      yield* file(".mate/logins/not-a-login/auth.json");
      yield* fs.makeDirectory(`${home}/.mate/logins/claudeAgent-empty`, { recursive: true });

      assert.deepStrictEqual(yield* (yield* sourcesIn(home)).heldLogins, [
        "claude-code",
        "codex-work",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps its marker across starts, and reads one it cannot make out as done", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-carry-" });
      const sources = yield* sourcesIn(home);
      const open: CarryOverMarker = { state: "open", eligible: ["codex"], starts: 2 };

      assert.isUndefined(yield* sources.marker);
      assert.isTrue(yield* sources.keepMarker(open));
      assert.deepStrictEqual(yield* (yield* sourcesIn(home)).marker, open);
      yield* fs.writeFileString(`${home}/.mate/signers-carried.json`, "{ not json");
      assert.deepStrictEqual(yield* sources.marker, { state: "done" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
