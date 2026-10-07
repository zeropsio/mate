// @effect-diagnostics nodeBuiltinImport:off -- tests own disposable transcript/home directories.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { usageCanonical, type UsageLinkUp } from "@t3tools/shared/agentUsage";
import { makeUsageLedger, type UsageLedger } from "./UsageLedger.ts";
import { makeUsageReplication } from "./usageReplication.ts";
import { captureSource, CAPTURE_READ_BYTES } from "./usageCapture.ts";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";

const binding = { orgId: "org", projectId: "project", mateId: "mate" };
const response = (id: string, amount: number) =>
  usageCanonical({
    type: "assistant",
    sessionId: "session",
    requestId: "request",
    timestamp: "2026-10-07T12:00:00.000Z",
    message: {
      id,
      model: "claude",
      usage: {
        input_tokens: amount,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }) + "\n";
const temporary = Effect.acquireRelease(
  Effect.tryPromise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-mate-test-"))),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);
const consume = (ledger: UsageLedger) =>
  Effect.gen(function* () {
    const frame = yield* ledger.batch("0", "test");
    const facts = new Map<
      string,
      Extract<UsageLinkUp, { type: "usage-batch" }>["entries"][number]["facts"][number]
    >();
    for (const entry of frame?.entries ?? [])
      for (const fact of entry.facts) facts.set(fact.nativeId, fact);
    return [...facts.values()].reduce(
      (sum, fact) => sum + BigInt(fact.components.uncachedInput ?? "0"),
      0n,
    );
  });
it.effect(
  "retained import, appended correction, copied history and reopened home produce exact recorded totals",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const transcript = NodePath.join(directory, "session.jsonl");
        const database = NodePath.join(directory, "usage.sqlite");
        const source = { provider: "claude" as const, directory };
        yield* Effect.tryPromise(() =>
          NodeFSP.writeFile(transcript, response("one", 120) + response("one", 120)),
        );
        const run = <A, E>(job: (ledger: UsageLedger) => Effect.Effect<A, E>) =>
          makeUsageLedger.pipe(
            Effect.flatMap(job),
            Effect.provide(Sqlite.layer({ filename: database })),
          );
        const before = yield* run((ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 120n);
            return yield* ledger.hello;
          }),
        );
        yield* Effect.tryPromise(() =>
          NodeFSP.appendFile(transcript, response("one", 150) + response("two", 150)),
        );
        yield* Effect.tryPromise(() =>
          NodeFSP.copyFile(transcript, NodePath.join(directory, "copy.jsonl")),
        );
        yield* run((ledger) =>
          Effect.gen(function* () {
            assert.equal((yield* ledger.hello).ledgerId, before.ledgerId);
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 300n);
            const cut = yield* ledger.hello;
            yield* captureSource(ledger, binding, source);
            assert.equal((yield* ledger.hello).highWater, cut.highWater);
            yield* Effect.tryPromise(() => NodeFSP.unlink(transcript));
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 300n);
            const conflict = yield* captureSource(
              ledger,
              { ...binding, projectId: "copied-project" },
              source,
            ).pipe(Effect.flip);
            assert.equal(conflict._tag, "UsageLedgerError");
          }),
        );
      }),
    ),
);
it.effect(
  "import drains bounded chunks and an unterminated receipt appears only once its newline commits",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const transcript = NodePath.join(directory, "session.jsonl");
        const source = { provider: "claude" as const, directory };
        const filler = usageCanonical({ type: "user", value: "x".repeat(1024) }) + "\n";
        yield* Effect.tryPromise(() =>
          NodeFSP.writeFile(
            transcript,
            filler.repeat(Math.ceil(CAPTURE_READ_BYTES / filler.length) + 1) +
              response("one", 120).trimEnd(),
          ),
        );
        yield* makeUsageLedger.pipe(
          Effect.flatMap((ledger) =>
            Effect.gen(function* () {
              yield* captureSource(ledger, binding, source);
              assert.equal(yield* consume(ledger), 0n);
              assert.include(
                (yield* ledger.origins)[0]!.coverage.gaps,
                "incomplete-or-oversize-record",
              );
              yield* Effect.tryPromise(() => NodeFSP.appendFile(transcript, "\n"));
              yield* captureSource(ledger, binding, source);
              yield* captureSource(ledger, binding, source);
              assert.equal(yield* consume(ledger), 120n);
            }),
          ),
          Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
        );
      }),
    ),
);

it.effect(
  "two copied ledgers diverging at the same sequence refuse replay and preserve accepted totals",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const transcript = NodePath.join(directory, "session.jsonl");
        const originalPath = NodePath.join(directory, "original.sqlite");
        const clonedPath = NodePath.join(directory, "clone.sqlite");
        const source = { provider: "claude" as const, directory };
        yield* Effect.tryPromise(() => NodeFSP.writeFile(transcript, response("one", 120)));
        const run = <A, E>(filename: string, job: (ledger: UsageLedger) => Effect.Effect<A, E>) =>
          makeUsageLedger.pipe(Effect.flatMap(job), Effect.provide(Sqlite.layer({ filename })));
        yield* run(originalPath, (ledger) => captureSource(ledger, binding, source));
        // Both connections were closed; the copied SQLite file is a coherent source cut.
        yield* Effect.tryPromise(() => NodeFSP.copyFile(originalPath, clonedPath));
        yield* Effect.tryPromise(() => NodeFSP.appendFile(transcript, response("two", 100)));
        const accepted = yield* run(originalPath, (ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 220n);
            return yield* ledger.hello;
          }),
        );
        yield* Effect.tryPromise(() =>
          NodeFSP.writeFile(transcript, response("one", 120) + response("three", 200)),
        );
        yield* run(clonedPath, (ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            const clone = yield* ledger.hello;
            assert.equal(clone.ledgerId, accepted.ledgerId);
            assert.equal(clone.highWater, accepted.highWater);
            assert.notEqual(clone.highDigest, accepted.highDigest);
            const lane = makeUsageReplication(ledger);
            yield* lane.hello;
            const failure = yield* lane
              .receive({
                type: "usage-resume",
                ledgerId: clone.ledgerId,
                channel: "clone",
                action: "replay",
                cursor: accepted.highWater,
                digest: accepted.highDigest,
              })
              .pipe(Effect.flip);
            assert.equal(failure._tag, "UsageLedgerError");
            assert.isUndefined(yield* lane.next);
          }),
        );
        yield* run(originalPath, (ledger) =>
          Effect.gen(function* () {
            assert.equal(yield* consume(ledger), 220n);
          }),
        );
      }),
    ),
);

it.effect("damaged UTF-8 does not commit a receipt or advance a byte checkpoint", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporary;
      const transcript = NodePath.join(directory, "session.jsonl");
      const source = { provider: "claude" as const, directory };
      yield* Effect.tryPromise(() => NodeFSP.writeFile(transcript, response("one", 120)));
      yield* makeUsageLedger.pipe(
        Effect.flatMap((ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 120n);
            const parts = response("two", 200).split('"two"');
            const damaged = Buffer.concat([
              Buffer.from(parts[0] + '"t'),
              Buffer.from([0xff]),
              Buffer.from('o"' + parts[1]),
            ]);
            yield* Effect.tryPromise(() => NodeFSP.appendFile(transcript, damaged));
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 120n);
            assert.include((yield* ledger.origins)[0]!.coverage.gaps, "source-capture-failed");
          }),
        ),
        Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
      );
    }),
  ),
);

it.effect("a rewrite during capture cannot checkpoint old facts over the new native prefix", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporary;
      const transcript = NodePath.join(directory, "session.jsonl");
      const source = { provider: "claude" as const, directory };
      yield* Effect.tryPromise(() => NodeFSP.writeFile(transcript, response("one", 120)));
      yield* makeUsageLedger.pipe(
        Effect.flatMap((ledger) =>
          Effect.gen(function* () {
            yield* captureSource(
              {
                ...ledger,
                capture: (...args) =>
                  ledger
                    .capture(...args)
                    .pipe(
                      Effect.tap(() =>
                        Effect.tryPromise(() =>
                          NodeFSP.writeFile(transcript, response("one", 150)),
                        ).pipe(Effect.orDie),
                      ),
                    ),
              },
              binding,
              source,
            );
            assert.include((yield* ledger.origins)[0]!.coverage.gaps, "source-capture-failed");
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 150n);
          }),
        ),
        Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
      );
    }),
  ),
);

it.effect("inherited Claude responses with a different outer session never count twice", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporary;
      const transcript = NodePath.join(directory, "session.jsonl");
      const inherited = NodePath.join(directory, "z-inherited.jsonl");
      const source = { provider: "claude" as const, directory };
      yield* Effect.tryPromise(() => NodeFSP.writeFile(transcript, response("one", 120)));
      yield* Effect.tryPromise(() =>
        NodeFSP.writeFile(
          inherited,
          response("one", 120).replace('"sessionId":"session"', '"sessionId":"fork"'),
        ),
      );
      yield* makeUsageLedger.pipe(
        Effect.flatMap((ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 120n);
            yield* Effect.tryPromise(() => NodeFSP.appendFile(transcript, response("one", 150)));
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 150n);
          }),
        ),
        Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
      );
    }),
  ),
);

it.effect("a transcript past 64 MiB is still counted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* temporary;
      const transcript = NodePath.join(directory, "session.jsonl");
      const source = { provider: "claude" as const, directory };
      const filler = usageCanonical({ type: "user", value: "x".repeat(16 * 1024) }) + "\n";
      yield* Effect.tryPromise(() =>
        NodeFSP.writeFile(
          transcript,
          filler.repeat(Math.ceil((65 * 1024 * 1024) / filler.length)) + response("one", 120),
        ),
      );
      yield* makeUsageLedger.pipe(
        Effect.flatMap((ledger) =>
          Effect.gen(function* () {
            yield* captureSource(ledger, binding, source);
            assert.equal(yield* consume(ledger), 120n);
          }),
        ),
        Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
      );
    }),
  ),
);

it.effect(
  "a resumed transcript reads what was appended and a bounded guard, never its prefix",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const transcript = NodePath.join(directory, "session.jsonl");
        const source = { provider: "claude" as const, directory };
        const filler = usageCanonical({ type: "user", value: "x".repeat(1024) }) + "\n";
        const prefix = filler.repeat(2048) + response("one", 120);
        yield* Effect.tryPromise(() => NodeFSP.writeFile(transcript, prefix));
        yield* makeUsageLedger.pipe(
          Effect.flatMap((ledger) =>
            Effect.gen(function* () {
              yield* captureSource(ledger, binding, source);
              yield* Effect.tryPromise(() => NodeFSP.appendFile(transcript, response("two", 30)));
              let read = 0;
              yield* captureSource(ledger, binding, source, {
                onRead: (bytes) => {
                  read += bytes;
                },
              });
              assert.equal(yield* consume(ledger), 150n);
              assert.isBelow(read, prefix.length / 4);
            }),
          ),
          Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
        );
      }),
    ),
);
