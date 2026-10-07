// @effect-diagnostics nodeBuiltinImport:off -- tests own disposable provider databases.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { usageCanonical, usageDigest, type UsageLinkUp } from "@t3tools/shared/agentUsage";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { makeUsageLedger, type UsageLedger } from "./UsageLedger.ts";
import { captureDatabaseSource } from "./usageDatabaseCapture.ts";
import { protoBytes, protoNumber, protoText } from "./testing/protobuf.ts";

const binding = { orgId: "org", projectId: "project", mateId: "mate" };
/** When capture began. */
const floor = Date.parse("2026-10-07T12:00:00.000Z");
const temporary = Effect.acquireRelease(
  Effect.tryPromise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-db-test-"))),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);
const journaled = (ledger: UsageLedger) =>
  Effect.gen(function* () {
    const frame = yield* ledger.batch("0", "test");
    const facts = new Map<
      string,
      Extract<UsageLinkUp, { type: "usage-batch" }>["entries"][number]["facts"][number]
    >();
    for (const entry of frame?.entries ?? [])
      for (const fact of entry.facts) facts.set(fact.nativeId, fact);
    return facts;
  });
const withLedger = <A, E>(directory: string, job: (ledger: UsageLedger) => Effect.Effect<A, E>) =>
  makeUsageLedger.pipe(
    Effect.flatMap(job),
    Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
  );

const openCodeMessage = (id: string, created: number, output: number) =>
  usageCanonical({
    id,
    sessionID: "oc-session",
    role: "assistant",
    modelID: "claude-sonnet-4-5",
    time: { created },
    cost: 0.25,
    tokens: { input: 100, output, reasoning: 5, cache: { read: 30, write: 10 } },
  });

it.effect(
  "an OpenCode message is a fact once, an updated message is its next revision, and one from before capture began is none",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const root = NodePath.join(directory, "opencode");
        yield* Effect.tryPromise(() => NodeFSP.mkdir(root, { recursive: true }));
        const db = new NodeSqlite.DatabaseSync(NodePath.join(root, "opencode.db"));
        yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));
        db.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER)");
        const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
        insert.run("msg-0", "oc-session", openCodeMessage("msg-0", floor - 1000, 20), floor - 1000);
        insert.run("msg-1", "oc-session", openCodeMessage("msg-1", floor + 1000, 20), floor + 1000);
        const source = { provider: "opencode" as const, roots: [root] };
        yield* withLedger(directory, (ledger) =>
          Effect.gen(function* () {
            yield* captureDatabaseSource(ledger, binding, source, {
              floor,
              now: () => floor + 5000,
            });
            const id = usageDigest(["opencode", ["msg-1"]]);
            const first = yield* journaled(ledger);
            assert.deepEqual([...first.keys()], [id]);
            const fact = first.get(id)!;
            assert.deepEqual(fact.components, {
              uncachedInput: "100",
              cachedInput: "30",
              cacheCreation: "10",
              output: "25",
              reasoning: "5",
              inclusiveTotal: null,
            });
            assert.equal(fact.model, "claude-sonnet-4-5");
            assert.equal(fact.sessionId, usageDigest(["opencode", "oc-session"]));
            assert.isNull(fact.nativeCost);
            assert.deepEqual(fact.time, {
              kind: "instant",
              at: "2026-10-07T12:00:01.000Z",
              provenance: "provider-database",
            });
            assert.equal(fact.revision, "1");
            const cut = (yield* ledger.hello).highWater;
            yield* captureDatabaseSource(ledger, binding, source, {
              floor,
              now: () => floor + 6000,
            });
            assert.equal((yield* ledger.hello).highWater, cut);
            db.prepare("UPDATE message SET data = ? WHERE id = ?").run(
              openCodeMessage("msg-1", floor + 1000, 40),
              "msg-1",
            );
            yield* captureDatabaseSource(ledger, binding, source, {
              floor,
              now: () => floor + 7000,
            });
            const updated = (yield* journaled(ledger)).get(id)!;
            assert.equal(updated.revision, "2");
            assert.equal(updated.components.output, "45");
            const [origin] = yield* ledger.origins;
            assert.equal(origin!.provider, "opencode");
            assert.equal(origin!.coverage.state, "partial");
            assert.deepEqual(origin!.coverage.gaps, []);
          }),
        );
      }),
    ),
);

it.effect("an OpenCode store that cannot be read is a gap, never a certified zero", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporary;
      const root = NodePath.join(directory, "opencode");
      yield* Effect.tryPromise(async () => {
        await NodeFSP.mkdir(root, { recursive: true });
        await NodeFSP.writeFile(NodePath.join(root, "opencode.db"), "not a sqlite database");
      });
      yield* withLedger(directory, (ledger) =>
        Effect.gen(function* () {
          yield* captureDatabaseSource(
            ledger,
            binding,
            { provider: "opencode", roots: [root] },
            { floor, now: () => floor + 5000 },
          );
          const [origin] = yield* ledger.origins;
          assert.include(origin!.coverage.gaps, "opencode-source-unreadable");
        }),
      );
    }),
  ),
);

it.effect(
  "an Antigravity generation is one fact under its first identity with the rest as aliases; one dated by its file alone is undated; one with no identity is none",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const conversations = NodePath.join(directory, "antigravity", "conversations");
        yield* Effect.tryPromise(() => NodeFSP.mkdir(conversations, { recursive: true }));
        const path = NodePath.join(conversations, "ag-session.db");
        const db = new NodeSqlite.DatabaseSync(path);
        const seconds = Math.floor(floor / 1000) + 60;
        const dated = [
          ...protoNumber(2, 100),
          ...protoNumber(3, 40),
          ...protoNumber(4, 5),
          ...protoNumber(5, 20),
          ...protoNumber(9, 10),
          ...protoText(11, "response-1"),
          ...protoText(12, "message-1"),
        ];
        try {
          db.exec(
            "CREATE TABLE gen_metadata (idx INTEGER, data BLOB); CREATE TABLE steps (idx INTEGER, metadata BLOB)",
          );
          db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
            0,
            new Uint8Array(
              protoBytes(1, [
                ...protoBytes(4, dated),
                ...protoText(19, "Gemini 3 Pro"),
                ...protoBytes(9, protoBytes(4, protoNumber(1, seconds))),
              ]),
            ),
          );
          // A step with no clock and no model of its own: only the file's time dates it.
          db.prepare("INSERT INTO steps VALUES (?, ?)").run(
            1,
            new Uint8Array(
              protoBytes(9, [...protoNumber(2, 7), ...protoNumber(3, 3), ...protoText(11, "r-2")]),
            ),
          );
          db.prepare("INSERT INTO steps VALUES (?, ?)").run(
            2,
            new Uint8Array(protoBytes(9, [...protoNumber(2, 9), ...protoNumber(3, 1)])),
          );
        } finally {
          db.close();
        }
        yield* Effect.tryPromise(() => NodeFSP.utimes(path, seconds, seconds));
        yield* withLedger(directory, (ledger) =>
          Effect.gen(function* () {
            yield* captureDatabaseSource(
              ledger,
              binding,
              { provider: "antigravity", roots: [conversations] },
              { floor, now: () => floor + 120_000 },
            );
            const id = (key: string) => usageDigest(["antigravity", [key]]);
            const facts = yield* journaled(ledger);
            assert.sameMembers(
              [...facts.keys()],
              [id("antigravity:11:response-1"), id("antigravity:11:r-2")],
            );
            const generation = facts.get(id("antigravity:11:response-1"))!;
            assert.deepEqual(generation.aliases, [id("antigravity:12:message-1")]);
            assert.equal(generation.model, "gemini-3-pro");
            assert.equal(generation.sessionId, usageDigest(["antigravity", "ag-session"]));
            assert.deepEqual(generation.components, {
              uncachedInput: "100",
              cachedInput: "20",
              cacheCreation: "5",
              output: "40",
              reasoning: "10",
              inclusiveTotal: null,
            });
            assert.equal(generation.time.kind, "instant");
            const fileTimed = facts.get(id("antigravity:11:r-2"))!;
            assert.deepEqual(fileTimed.time, { kind: "undated" });
            assert.isNull(fileTimed.model);
            const [origin] = yield* ledger.origins;
            assert.equal(origin!.provider, "antigravity");
            assert.include(origin!.coverage.gaps, "antigravity-missing-native-identity");
          }),
        );
      }),
    ),
);
