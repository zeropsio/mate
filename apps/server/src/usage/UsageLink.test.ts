// @effect-diagnostics nodeBuiltinImport:off -- tests own disposable transcript/home directories.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AGENT_USAGE_CAPTURE_PROTOCOL } from "@t3tools/contracts";
import { usageCanonical, type UsageLinkUp } from "@t3tools/shared/agentUsage";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import type { MateLinkDown, MateLinkUp } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { ServerConfig } from "../config.ts";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeUsageLedger, type UsageLedger } from "./UsageLedger.ts";
import { makeUsageLink, type UsageLinkOptions, type UsageRuntimeEvent } from "./UsageLink.ts";
import type { WatchDirectory } from "./usageCapture.ts";
import { protoBytes, protoNumber, protoText } from "./testing/protobuf.ts";

const response = (id: string, amount: number) =>
  usageCanonical({
    type: "assistant",
    sessionId: "session",
    requestId: "request",
    timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
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
  usage: { capture: AGENT_USAGE_CAPTURE_PROTOCOL, report: 1, mateId: "mate", orgId: "org" },
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

/** Every provider a fact was journaled for. */
const providers = (ledger: UsageLedger) =>
  Effect.gen(function* () {
    const frame = yield* ledger.batch("0", "test");
    return new Set(
      (frame?.entries ?? []).flatMap((entry) => entry.facts.map((fact) => fact.provider)),
    );
  });

/** A Mate whose HQ link negotiated capture, every provider's home under `root`, nothing from V1. */
const mate = (
  options: UsageLinkOptions & {
    readonly projects?: boolean;
    readonly offer?: Extract<MateLinkDown, { type: "state" }>;
  } = {},
) =>
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
        Layer.succeed(HostProcessEnvironment, {
          GROK_HOME: NodePath.join(root, "grok"),
          OPENCODE_DATA_DIR: NodePath.join(root, "opencode"),
          ANTIGRAVITY_DATA_DIR: NodePath.join(root, "antigravity"),
        }),
        ServerSettings.layerTest({
          providers: {
            claudeAgent: { homePath: claudeHome },
            codex: { homePath: NodePath.join(root, "codex") },
          },
        }),
        Layer.succeed(ServerConfig, {
          zerops: { projectId: "project", apiBaseUrl: "http://zerops.invalid" },
        } as unknown as ServerConfig["Service"]),
        NodeServices.layer,
      ),
    );
    const runtime = yield* Queue.unbounded<UsageRuntimeEvent>();
    const link = yield* makeUsageLink(Stream.fromQueue(runtime), options).pipe(
      Effect.provide(context),
    );
    const sent: MateLinkUp[] = [];
    const send = (frame: MateLinkUp) => Effect.sync(() => void sent.push(frame));
    let lane = yield* link.open(send);
    yield* lane.state(options.offer ?? state);
    const reader = yield* makeUsageLedger.pipe(
      Effect.provide(yield* Layer.build(Sqlite.layer({ filename: database }))),
    );
    const write = (name: string, body: string) =>
      Effect.tryPromise(async () => {
        await NodeFSP.mkdir(NodePath.join(transcripts, "project"), { recursive: true });
        await NodeFSP.writeFile(NodePath.join(transcripts, "project", name), body);
      });
    return {
      root,
      transcripts,
      write,
      providers: providers(reader),
      emit: (type: UsageRuntimeEvent["type"]) => Queue.offer(runtime, { type }),
      total: recorded(reader),
      origins: reader.origins,
      offer: (message: Extract<MateLinkDown, { type: "state" }>) => lane.state(message),
      /** HQ's answer on the current link. */
      answer: (message: MateLinkDown) => lane.receive(message),
      /** HQ's ping on the current link. */
      ping: Effect.suspend(() => lane.ping),
      database,
      /** A new link, whose first state is `message`. */
      reconnect: (message: Extract<MateLinkDown, { type: "state" }>) =>
        Effect.gen(function* () {
          lane = yield* link.open(send);
          yield* lane.state(message);
        }),
      /** The hellos sent so far, oldest first. */
      hellos: Effect.sync(() =>
        sent.flatMap((frame) => (frame.type === "usage-hello" ? [frame] : [])),
      ),
    };
  });

/**
 * Watches as Linux inotify reports them: a watch sees its directory's own entries, and a recursive
 * one everything beneath it. Changes are reported when the test says, synchronously.
 */
const inotify = () => {
  const watches: Array<{
    readonly directory: string;
    readonly recursive: boolean;
    readonly changed: (name: string | null) => void;
    closed: boolean;
  }> = [];
  const watch: WatchDirectory = (directory, { recursive, changed }) => {
    // As fs.watch does, a directory that is not there cannot be watched.
    if (!NodeFS.existsSync(directory))
      throw Object.assign(new Error(`ENOENT: ${directory}`), { code: "ENOENT" });
    const entry = { directory, recursive, changed, closed: false };
    watches.push(entry);
    return () => {
      entry.closed = true;
    };
  };
  return {
    watch,
    watching: (directory: string) =>
      watches.some((entry) => !entry.closed && entry.directory === directory),
    /** `path` was created or written. */
    touch: (path: string) => {
      // Only the watches already there see this change; one it brings about sees the next.
      const count = watches.length;
      for (let index = 0; index < count; index++) {
        const entry = watches[index]!;
        if (entry.closed) continue;
        const name = NodePath.relative(entry.directory, path);
        if (name === "" || name.startsWith("..")) continue;
        if (!entry.recursive && name.includes(NodePath.sep)) continue;
        entry.changed(name);
      }
    },
  };
};

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
        const events = inotify();
        const subject = yield* mate({ watch: events.watch, projects: false });
        const home = NodePath.dirname(subject.transcripts);
        yield* eventually(
          Effect.sync(() => events.watching(home)),
          Boolean,
        );
        // Startup's own scans settle; nothing else looks at the disk until a watch reports.
        yield* Effect.sleep("300 millis");
        const one = response("one", 120);
        yield* subject.write("session.jsonl", one);
        const file = NodePath.join(subject.transcripts, "project", "session.jsonl");
        events.touch(subject.transcripts);
        // The directory's own watch is attached as its parent sees it appear, before any scan.
        assert.isTrue(events.watching(subject.transcripts));
        assert.isFalse(events.watching(home));
        yield* subject.emit("session.started");
        events.touch(file);
        assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
        yield* subject.write("session.jsonl", one + response("two", 30));
        events.touch(file);
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

it.live("capture waits for HQ to name the org and never asks Zerops for it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch } = silentWatch();
      const { orgId: _, ...older } = state.usage!;
      const subject = yield* mate({ watch, offer: { ...state, usage: older } });
      yield* subject.emit("session.started");
      yield* Effect.sleep("200 millis");
      assert.lengthOf(yield* subject.origins, 0);
      yield* subject.offer(state);
      yield* eventually(subject.origins, (origins) => origins.length > 0);
      yield* subject.write("session.jsonl", response("one", 120));
      yield* subject.emit("turn.completed");
      assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
      assert.isTrue((yield* subject.origins).every((origin) => origin.orgId === "org"));
    }),
  ),
);

it.live(
  "capture starts at HQ's first offer: what transcripts held before it is never counted",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { watch } = silentWatch();
        const { orgId: _, ...older } = state.usage!;
        const subject = yield* mate({ watch, offer: { ...state, usage: older } });
        const before = response("before", 500);
        yield* subject.write("session.jsonl", before);
        yield* subject.offer(state);
        yield* eventually(subject.origins, (origins) => origins.length > 0);
        yield* subject.emit("turn.completed");
        yield* Effect.sleep("200 millis");
        yield* subject.write("session.jsonl", before + response("after", 120));
        yield* subject.emit("turn.completed");
        assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
        yield* Effect.sleep("200 millis");
        assert.equal(yield* subject.total, 120n);
      }),
    ),
);

it.live("a Mate registered again starts a new ledger from that moment and keeps capturing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch } = silentWatch();
      const subject = yield* mate({ watch });
      yield* eventually(subject.origins, (origins) => origins.length > 0);
      const first = (yield* subject.hellos)[0]!;
      const before = response("before", 500);
      yield* subject.write("session.jsonl", before);
      yield* subject.emit("turn.completed");
      yield* eventually(subject.total, (total) => total === 500n);
      yield* subject.reconnect({ ...state, usage: { ...state.usage!, mateId: "mate-2" } });
      const hellos = yield* eventually(subject.hellos, (sent) =>
        sent.some((hello) => hello.ledgerId !== first.ledgerId),
      );
      const renewed = hellos.find((hello) => hello.ledgerId !== first.ledgerId)!;
      assert.isTrue(renewed.origins.every((origin) => origin.mateId === "mate-2"));
      yield* eventually(subject.origins, (origins) => origins.length > 0);
      yield* subject.emit("turn.completed");
      yield* Effect.sleep("200 millis");
      yield* subject.write("session.jsonl", before + response("after", 120));
      yield* subject.emit("turn.completed");
      assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
      assert.isTrue((yield* subject.origins).every((origin) => origin.mateId === "mate-2"));
    }),
  ),
);

for (const code of ["ledger_rollback_conflict", "origin_lineage_conflict"])
  it.live(`HQ refusing the ledger (${code}) starts a new one and capture goes on`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { watch } = silentWatch();
        const subject = yield* mate({ watch });
        const [first] = yield* eventually(subject.hellos, (sent) => sent.length > 0);
        const before = response("before", 500);
        yield* subject.write("session.jsonl", before);
        yield* subject.emit("turn.completed");
        yield* eventually(subject.total, (total) => total === 500n);
        yield* subject.answer({
          type: "usage-error",
          ledgerId: first!.ledgerId,
          code,
          disposition: "refused",
        });
        const hellos = yield* eventually(subject.hellos, (sent) =>
          sent.some((hello) => hello.ledgerId !== first!.ledgerId),
        );
        const renewed = hellos.find((hello) => hello.ledgerId !== first!.ledgerId)!;
        assert.equal(renewed.highWater, "0");
        assert.notInclude(
          renewed.origins.map((origin) => origin.originId),
          first!.origins[0]?.originId,
        );
        // The refused ledger's journal is gone: nothing grows behind a stopped lane.
        assert.equal(yield* subject.total, 0n);
        yield* eventually(subject.origins, (origins) => origins.length > 0);
        yield* subject.emit("turn.completed");
        yield* Effect.sleep("200 millis");
        yield* subject.write("session.jsonl", before + response("after", 120));
        yield* subject.emit("turn.completed");
        assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
      }),
    ),
  );

it.live("Grok, OpenCode and Antigravity are captured while Cursor is still unsupported", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch } = silentWatch();
      const subject = yield* mate({ watch });
      yield* eventually(subject.origins, (origins) => origins.length > 0);
      yield* subject.emit("turn.completed");
      yield* Effect.sleep("200 millis");
      const now = (yield* Clock.currentTimeMillis) + 1000;
      yield* Effect.tryPromise(async () => {
        const grok = NodePath.join(subject.root, "grok", "sessions", "grok-session");
        await NodeFSP.mkdir(grok, { recursive: true });
        await NodeFSP.writeFile(
          NodePath.join(grok, "updates.jsonl"),
          usageCanonical({
            params: {
              sessionId: "grok-session",
              update: {
                sessionUpdate: "turn_completed",
                prompt_id: "prompt",
                usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 0 },
              },
              _meta: { agentTimestampMs: now },
            },
          }) + "\n",
        );
        const opencode = NodePath.join(subject.root, "opencode");
        await NodeFSP.mkdir(opencode, { recursive: true });
        const messages = new NodeSqlite.DatabaseSync(NodePath.join(opencode, "opencode.db"));
        messages.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)");
        messages.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
          "msg",
          "session",
          usageCanonical({
            role: "assistant",
            modelID: "model",
            time: { created: now },
            tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          }),
        );
        messages.close();
        const antigravity = NodePath.join(subject.root, "antigravity", "conversations");
        await NodeFSP.mkdir(antigravity, { recursive: true });
        const conversation = new NodeSqlite.DatabaseSync(NodePath.join(antigravity, "c.db"));
        conversation.exec("CREATE TABLE steps (idx INTEGER, metadata BLOB)");
        conversation
          .prepare("INSERT INTO steps VALUES (?, ?)")
          .run(
            0,
            new Uint8Array([
              ...protoBytes(9, [...protoNumber(2, 10), ...protoText(11, "response")]),
              ...protoBytes(8, protoNumber(1, Math.ceil(now / 1000))),
            ]),
          );
        conversation.close();
      });
      yield* subject.emit("turn.completed");
      const captured = yield* eventually(subject.providers, (found) => found.size >= 3);
      assert.sameMembers([...captured], ["grok", "opencode", "antigravity"]);
      const coverage = new Map(
        (yield* subject.origins).map((origin) => [origin.provider, origin.coverage.state]),
      );
      assert.equal(coverage.get("cursor"), "unsupported");
      for (const provider of ["grok", "opencode", "antigravity"] as const)
        assert.equal(coverage.get(provider), "partial");
    }),
  ),
);

it.live("a ledger that cannot be read at the offer is asked again later, never replaced", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { watch } = silentWatch();
      const subject = yield* mate({ watch, beginRetry: { baseMs: 50, maxMs: 200 } });
      const [first] = yield* eventually(subject.hellos, (sent) => sent.length > 0);
      yield* eventually(subject.origins, (origins) => origins.length > 0);
      yield* subject.write("session.jsonl", response("kept", 120));
      yield* subject.emit("turn.completed");
      assert.equal(yield* eventually(subject.total, (total) => total === 120n), 120n);
      // The ledger cannot be read when HQ offers capture again (another process mid-write).
      const raw = new NodeSqlite.DatabaseSync(subject.database);
      const held = raw.prepare("SELECT value FROM usage_meta WHERE id=1").get()!["value"];
      raw.prepare("UPDATE usage_meta SET value='damaged' WHERE id=1").run();
      yield* subject.reconnect(state);
      assert.lengthOf(yield* subject.hellos, 1);
      raw.prepare("UPDATE usage_meta SET value=? WHERE id=1").run(String(held));
      raw.close();
      const hellos = yield* eventually(
        Effect.andThen(subject.ping, subject.hellos),
        (sent) => sent.length > 1,
      );
      assert.isTrue(hellos.every((hello) => hello.ledgerId === first!.ledgerId));
      assert.equal(yield* subject.total, 120n);
    }),
  ),
);
