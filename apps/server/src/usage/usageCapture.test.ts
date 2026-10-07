// @effect-diagnostics nodeBuiltinImport:off -- tests own disposable transcript/home directories.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { usageCanonical, usageDigest, type UsageLinkUp } from "@t3tools/shared/agentUsage";
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

/** The latest revision of every fact the ledger journaled, by native id. */
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

/** Shaped after a real Grok Build `turn_completed` session update. */
const grokTurn = (turn: {
  readonly promptId?: string;
  readonly at?: number;
  readonly usage: Record<string, unknown>;
}) =>
  usageCanonical({
    timestamp: Math.floor((turn.at ?? Date.parse("2026-10-07T12:00:00.000Z")) / 1000),
    method: "_x.ai/session/update",
    params: {
      sessionId: "grok-session",
      update: {
        sessionUpdate: "turn_completed",
        ...(turn.promptId === undefined ? {} : { prompt_id: turn.promptId }),
        stop_reason: "end_turn",
        usage: turn.usage,
      },
      _meta: { agentTimestampMs: turn.at ?? Date.parse("2026-10-07T12:00:00.000Z") },
    },
  }) + "\n";

it.effect(
  "a Grok turn is one fact per model, and a turn without a prompt id or with more cache than input is none",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const directory = yield* temporary;
        const session = NodePath.join(directory, "sessions", "grok-session");
        const meter = (input: number, cached: number, output: number, reasoning: number) => ({
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
          cachedReadTokens: cached,
          cacheCreationTokens: 0,
          reasoningTokens: reasoning,
        });
        yield* Effect.tryPromise(async () => {
          await NodeFSP.mkdir(session, { recursive: true });
          await NodeFSP.writeFile(
            NodePath.join(session, "updates.jsonl"),
            [
              grokTurn({
                promptId: "before",
                at: Date.parse("2026-10-07T11:00:00.000Z"),
                usage: { ...meter(900, 0, 9, 0), modelUsage: { "grok-4": meter(900, 0, 9, 0) } },
              }),
              grokTurn({
                promptId: "p1",
                usage: {
                  ...meter(1300, 400, 70, 30),
                  modelUsage: {
                    "grok-4.5-build": meter(1000, 400, 50, 30),
                    "grok-code-fast": meter(300, 0, 20, 0),
                  },
                },
              }),
              grokTurn({ promptId: "p2", usage: meter(200, 50, 10, 0) }),
              grokTurn({ usage: meter(500, 0, 5, 0) }),
              grokTurn({ promptId: "p3", usage: meter(100, 200, 5, 0) }),
              usageCanonical({ params: { update: { sessionUpdate: "agent_message_chunk" } } }),
              "",
            ].join("\n"),
          );
          // Only the session log is Grok's usage source.
          await NodeFSP.writeFile(
            NodePath.join(session, "other.jsonl"),
            grokTurn({ promptId: "p9", usage: meter(1, 0, 1, 0) }),
          );
        });
        yield* makeUsageLedger.pipe(
          Effect.flatMap((ledger) =>
            Effect.gen(function* () {
              yield* captureSource(
                ledger,
                binding,
                { provider: "grok", directory: NodePath.join(directory, "sessions") },
                { floor: Date.parse("2026-10-07T11:30:00.000Z") },
              );
              const facts = yield* journaled(ledger);
              const id = (native: string) => usageDigest(["grok", [native]]);
              assert.deepEqual(
                [...facts.values()].map((fact) => [fact.nativeId, fact.model, fact.components]),
                [
                  [
                    id("grok-session:p1:grok-4.5-build"),
                    "grok-4.5-build",
                    {
                      uncachedInput: "600",
                      cachedInput: "400",
                      cacheCreation: "0",
                      output: "50",
                      reasoning: "30",
                      inclusiveTotal: "1050",
                    },
                  ],
                  [
                    id("grok-session:p1:grok-code-fast"),
                    "grok-code-fast",
                    {
                      uncachedInput: "300",
                      cachedInput: "0",
                      cacheCreation: "0",
                      output: "20",
                      reasoning: "0",
                      inclusiveTotal: "320",
                    },
                  ],
                  [
                    id("grok-session:p2:grok"),
                    null,
                    {
                      uncachedInput: "150",
                      cachedInput: "50",
                      cacheCreation: "0",
                      output: "10",
                      reasoning: "0",
                      inclusiveTotal: "210",
                    },
                  ],
                ],
              );
              const fact = facts.get(id("grok-session:p1:grok-4.5-build"))!;
              assert.equal(fact.sessionId, usageDigest(["grok", "grok-session"]));
              assert.deepEqual(fact.time, {
                kind: "instant",
                at: "2026-10-07T12:00:00.000Z",
                provenance: "provider-transcript",
              });
              assert.isNull(fact.nativeCost);
              const [origin] = yield* ledger.origins;
              assert.equal(origin!.provider, "grok");
              assert.includeMembers(
                [...origin!.coverage.gaps],
                ["grok-missing-native-identity", "grok-invalid-cache-subset"],
              );
            }),
          ),
          Effect.provide(Sqlite.layer({ filename: NodePath.join(directory, "usage.sqlite") })),
        );
      }),
    ),
);
