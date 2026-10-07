// @effect-diagnostics nodeBuiltinImport:off -- tests own disposable transcript/home directories.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AGENT_USAGE_CAPTURE_PROTOCOL } from "@t3tools/contracts";
import { usageCanonical, type UsageLinkUp } from "@t3tools/shared/agentUsage";
import type { MateLinkDown } from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import * as ServerSettings from "../serverSettings.ts";
import { ZeropsOrgRead } from "../zerops/ZeropsOrgRead.ts";
import { makeUsageLedger, type UsageLedger } from "./UsageLedger.ts";
import { makeUsageLink, type UsageLinkOptions, type UsageRuntimeEvent } from "./UsageLink.ts";
import { watchDirectory, type WatchDirectory } from "./usageCapture.ts";

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

const state = {
  type: "state",
  mate: { projectId: "project" },
  usage: { capture: AGENT_USAGE_CAPTURE_PROTOCOL, report: 1, mateId: "mate" },
} as unknown as Extract<MateLinkDown, { type: "state" }>;

const temporary = Effect.acquireRelease(
  Effect.tryPromise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-link-test-"))),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);

const recorded = (ledger: UsageLedger) =>
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

const eventually = <A, E>(read: Effect.Effect<A, E>, ok: (value: A) => boolean) =>
  Effect.gen(function* () {
    let value = yield* read;
    for (let attempt = 0; attempt < 250 && !ok(value); attempt++) {
      yield* Effect.sleep("20 millis");
      value = yield* read;
    }
    return value;
  });

/** A Mate whose HQ link negotiated capture, its Claude home under `root`, nothing from V1. */
const mate = (options: UsageLinkOptions & { readonly projects?: boolean } = {}) =>
  Effect.gen(function* () {
    const root = yield* temporary;
    const claudeHome = NodePath.join(root, "claude");
    const transcripts = NodePath.join(claudeHome, "projects");
    yield* Effect.tryPromise(() =>
      NodeFSP.mkdir(options.projects === false ? claudeHome : transcripts, { recursive: true }),
    );
    const database = NodePath.join(root, "usage.sqlite");
    const context = yield* Layer.build(
      Layer.mergeAll(
        Sqlite.layer({ filename: database }),
        ServerSettings.layerTest({
          providers: {
            claudeAgent: { homePath: claudeHome },
            codex: { homePath: NodePath.join(root, "codex") },
          },
        }),
        Layer.succeed(ServerConfig, {
          zerops: { projectId: "project", apiBaseUrl: "http://zerops.invalid" },
        } as unknown as ServerConfig["Service"]),
        Layer.succeed(ZeropsOrgRead, {
          project: () =>
            Effect.succeed({ kind: "answered", status: 200, body: { clientId: "org" } }),
          members: () => Effect.succeed({ kind: "no-key" }),
        }),
        NodeServices.layer,
      ),
    );
    const runtime = yield* Queue.unbounded<UsageRuntimeEvent>();
    const link = yield* makeUsageLink(Stream.fromQueue(runtime), options).pipe(
      Effect.provide(context),
    );
    const lane = yield* link.open(() => Effect.void);
    yield* lane.state(state);
    const reader = yield* makeUsageLedger.pipe(
      Effect.provide(yield* Layer.build(Sqlite.layer({ filename: database }))),
    );
    const write = (name: string, body: string) =>
      Effect.tryPromise(async () => {
        await NodeFSP.mkdir(NodePath.join(transcripts, "project"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(transcripts, "project", name), body);
      });
    return {
      transcripts,
      write,
      emit: (type: UsageRuntimeEvent["type"]) => Queue.offer(runtime, { type }),
      total: recorded(reader),
    };
  });

/** A watch that attaches and never reports; each attach is kept so a test can fail or close it. */
const silentWatch = () => {
  const attached: Array<{ directory: string; failed: () => void; closed: boolean }> = [];
  const watch: WatchDirectory = (directory, { failed }) => {
    const entry = { directory, failed, closed: false };
    attached.push(entry);
    return () => {
      entry.closed = true;
    };
  };
  return { watch, attached };
};

it.live("a completed turn is captured under the Mate engine, with no V1 orchestration event", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch, attached } = silentWatch();
      const subject = yield* mate({ watch });
      yield* eventually(
        Effect.sync(() => attached.some((entry) => entry.directory === subject.transcripts)),
        Boolean,
      );
      yield* subject.write("session.jsonl", response("one", 120));
      yield* subject.emit("turn.completed");
      assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
    }),
  ),
);

it.live(
  "a transcript directory created after startup is captured after the first session starts",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const attached: string[] = [];
        const watch: WatchDirectory = (directory, options) => {
          attached.push(directory);
          return watchDirectory(directory, options);
        };
        const subject = yield* mate({ watch, projects: false });
        yield* eventually(
          Effect.sync(() => attached.length >= 2),
          Boolean,
        );
        yield* subject.emit("session.started");
        yield* subject.write("session.jsonl", response("one", 120));
        assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
        yield* subject.write("session.jsonl", response("one", 120) + response("two", 30));
        assert.equal(yield* eventually(subject.total, (total) => total === 150n), 150n);
      }),
    ),
);

it.live("a watcher that errors is replaced", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch, attached } = silentWatch();
      const subject = yield* mate({ watch, retry: { baseMs: 10, maxMs: 100 } });
      const ofTranscripts = Effect.sync(() =>
        attached.filter((entry) => entry.directory === subject.transcripts),
      );
      const [first] = yield* eventually(ofTranscripts, (entries) => entries.length === 1);
      first!.failed();
      const after = yield* eventually(ofTranscripts, (entries) => entries.length === 2);
      assert.equal(after.length, 2);
      assert.isTrue(first!.closed);
      assert.isFalse(after[1]!.closed);
    }),
  ),
);

it.live("a watcher that keeps erroring is retried with growing delays, never in a loop", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const attached: string[] = [];
      const watch: WatchDirectory = (directory, { failed }) => {
        attached.push(directory);
        queueMicrotask(failed);
        return () => {};
      };
      const subject = yield* mate({ watch, retry: { baseMs: 40, maxMs: 1_000 } });
      yield* Effect.sleep("450 millis");
      const attempts = attached.filter((directory) => directory === subject.transcripts).length;
      // 40 + 80 + 160 ms of backoff: four attaches in the window; a tight loop makes hundreds.
      assert.isAtLeast(attempts, 2);
      assert.isAtMost(attempts, 6);
    }),
  ),
);
