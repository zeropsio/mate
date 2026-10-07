import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { UsageFact } from "@t3tools/contracts";
import {
  USAGE_GENESIS_DIGEST,
  usageDigest,
  usageEntryDigest,
  usageSnapshotDigest,
  type UsageLinkUp,
} from "@t3tools/shared/agentUsage";
import * as Sqlite from "../persistence/NodeSqliteClient.ts";
import { makeUsageLedger, type UsageLedger } from "./UsageLedger.ts";
import { makeUsageReplication } from "./usageReplication.ts";
import { initialMeterState, meterLine } from "./usageMeters.ts";

const binding = { orgId: "org", projectId: "project", mateId: "mate" };
const fact = (originId: string, nativeId: string, amount: string): Omit<UsageFact, "revision"> => ({
  originId,
  factId: nativeId,
  nativeId,
  aliases: [],
  provider: "claude",
  model: "model",
  pricingBand: "standard",
  components: {
    uncachedInput: amount,
    cachedInput: "0",
    cacheCreation: "0",
    output: "0",
    reasoning: null,
    inclusiveTotal: amount,
  },
  nativeCost: null,
  time: { kind: "instant", at: "2026-10-07T12:00:00.000Z", provenance: "provider" },
  evidence: "response",
  meterVersion: "v1",
  state: "settled",
  sessionId: null,
  runId: null,
  parentId: null,
});
/** Fake HQ boundary: replacements and cursor commit together, ACK delivery is controlled by the test. */
class Hq {
  cursor = "0";
  digest = USAGE_GENESIS_DIGEST;
  facts = new Map<string, UsageFact>();
  total() {
    return [...this.facts.values()].reduce(
      (sum, row) =>
        sum + (row.state === "retracted" ? 0n : BigInt(row.components.inclusiveTotal ?? "0")),
      0n,
    );
  }
  apply(frame: UsageLinkUp) {
    if (frame.type === "usage-hello") return;
    if (frame.type === "usage-batch") {
      for (const entry of frame.entries) {
        const { digest, ...body } = entry;
        assert.equal(digest, usageEntryDigest(body));
        if (BigInt(entry.sequence) <= BigInt(this.cursor)) continue;
        assert.equal(entry.previousDigest, this.digest);
        assert.equal(BigInt(entry.sequence), BigInt(this.cursor) + 1n);
        for (const row of entry.facts) this.replace(row);
        this.cursor = entry.sequence;
        this.digest = entry.digest;
      }
    } else if (frame.type === "usage-snapshot") {
      const { type: _type, channel: _channel, digest, manifestDigest: _manifest, ...body } = frame;
      assert.equal(digest, usageSnapshotDigest(body));
      for (const row of frame.facts) this.replace(row);
      if (frame.page + 1 === frame.pages) {
        assert.equal(frame.digest, frame.manifestDigest);
        this.cursor = frame.highWater;
        this.digest = frame.highDigest;
      }
    }
  }
  replace(row: UsageFact) {
    const key = `${row.originId}:${row.nativeId}`;
    const old = this.facts.get(key);
    if (!old || BigInt(row.revision) > BigInt(old.revision)) this.facts.set(key, row);
    else if (row.revision === old.revision) assert.deepEqual(old, row);
  }
  resume(
    hello: Extract<UsageLinkUp, { type: "usage-hello" }>,
    channel: string,
    action: "replay" | "snapshot" = "replay",
  ) {
    return {
      type: "usage-resume" as const,
      ledgerId: hello.ledgerId,
      channel,
      cursor: this.cursor,
      digest: this.digest,
      action,
    };
  }
  ack(ledgerId: string, channel: string) {
    return {
      type: "usage-ack" as const,
      ledgerId,
      channel,
      cursor: this.cursor,
      digest: this.digest,
    };
  }
}
const withLedger = <A, E>(run: (ledger: UsageLedger) => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  makeUsageLedger.pipe(Effect.flatMap(run), Effect.provide(Sqlite.layer({ filename: ":memory:" })));

describe("durable Mate usage boundary", () => {
  it.effect("a newly captured source is declared before its facts or coverage leave the lane", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const lane = makeUsageReplication(ledger);
        const initial = yield* lane.hello;
        assert.isEmpty(initial.origins);
        const origin = yield* ledger.bind("new-source", binding, "claude");
        yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
        const hq = new Hq();
        const declaration = yield* lane.receive(hq.resume(initial, "before-capture"));
        if (declaration?.type !== "usage-hello") throw new Error("Expected source declaration");
        assert.deepEqual(
          declaration.origins.map((item) => item.originId),
          [origin.originId],
        );
        const batch = yield* lane.receive(hq.resume(declaration, "declared"));
        assert.equal(batch?.type, "usage-batch");
        hq.apply(batch!);
        assert.equal(hq.total(), 120n);
        yield* lane.receive(hq.ack(declaration.ledgerId, "declared"));
        const later = yield* ledger.bind("later-source", binding, "codex");
        yield* ledger.coverage(later.originId, {
          state: "unsupported",
          since: null,
          through: null,
          gaps: ["missing-meter"],
        });
        assert.equal((yield* lane.next)?.type, "usage-hello");
        assert.equal(hq.total(), 120n);
      }),
    ),
  );

  it.effect(
    "ACK loss, repeated receipt and restart keep two equal real requests at exactly 240",
    () =>
      withLedger((ledger) =>
        Effect.gen(function* () {
          const origin = yield* ledger.bind("claude-source", binding, "claude");
          yield* ledger.capture(fact(origin.originId, "a", "120"), "transcript", 1);
          yield* ledger.capture(fact(origin.originId, "b", "120"), "transcript", 2);
          yield* ledger.capture(fact(origin.originId, "a", "120"), "copied-transcript", 1);
          const hq = new Hq();
          const first = makeUsageReplication(ledger);
          const hello = yield* first.hello;
          const frame = yield* first.receive(hq.resume(hello, "first"));
          assert.isDefined(frame);
          hq.apply(frame!);
          assert.deepEqual(yield* first.next, frame);
          // The existing link's next ping retransmits the immutable in-flight frame after ACK loss.
          hq.apply((yield* first.next)!);
          hq.apply(frame!);
          assert.equal(hq.total(), 240n);
          // HQ committed but its ACK disappeared. A new socket resumes the committed cut.
          const restarted = makeUsageReplication(yield* makeUsageLedger);
          const secondHello = yield* restarted.hello;
          assert.equal(secondHello.ledgerId, hello.ledgerId);
          assert.isUndefined(yield* restarted.receive(hq.resume(secondHello, "second")));
          assert.equal(hq.total(), 240n);
        }),
      ),
  );

  it.effect("compacted replay repairs by a pinned snapshot and then H+1, with lost page ACK", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const origin = yield* ledger.bind("source", binding, "claude");
        yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
        const live = new Hq();
        const first = makeUsageReplication(ledger);
        const hello = yield* first.hello;
        live.apply((yield* first.receive(live.resume(hello, "live")))!);
        yield* first.receive(live.ack(hello.ledgerId, "live"));
        const restored = new Hq();
        const recovery = makeUsageReplication(ledger);
        const recoveryHello = yield* recovery.hello;
        const pinned = yield* recovery.receive(
          restored.resume(recoveryHello, "repair", "snapshot"),
        );
        assert.equal(pinned?.type, "usage-snapshot");
        restored.apply(pinned!);
        // Live correction after H cannot change the pinned snapshot.
        yield* ledger.capture(fact(origin.originId, "a", "150"), "file", 2);
        yield* ledger.capture(fact(origin.originId, "b", "10"), "file", 3);
        const reconnected = makeUsageReplication(yield* makeUsageLedger);
        const newHello = yield* reconnected.hello;
        const repeated = yield* reconnected.receive(
          restored.resume(newHello, "repair2", "snapshot"),
        );
        restored.apply(repeated!);
        assert.equal(restored.total(), 120n);
        assert.equal(repeated?.type, "usage-snapshot");
        if (repeated?.type !== "usage-snapshot") throw new Error("Expected snapshot");
        const tail = yield* reconnected.receive({
          type: "usage-snapshot-ack",
          ledgerId: newHello.ledgerId,
          channel: "repair2",
          snapshotId: repeated.snapshotId,
          nextPage: repeated.pages,
          cursor: repeated.highWater,
          digest: repeated.highDigest,
        });
        restored.apply(tail!);
        yield* reconnected.receive(restored.ack(newHello.ledgerId, "repair2"));
        assert.equal(restored.total(), 160n);
      }),
    ),
  );

  it.effect("a source wake during snapshot negotiation retransmits the same pinned cut", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const origin = yield* ledger.bind("source", binding, "claude");
        yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
        const live = new Hq();
        const first = makeUsageReplication(ledger);
        const initial = yield* first.hello;
        live.apply((yield* first.receive(live.resume(initial, "live")))!);
        yield* first.receive(live.ack(initial.ledgerId, "live"));
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const recovery = makeUsageReplication({
          ...ledger,
          snapshot: (channel) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(ledger.snapshot(channel)),
            ),
        });
        const restored = new Hq();
        const hello = yield* recovery.hello;
        const negotiating = yield* recovery
          .receive(restored.resume(hello, "repair", "snapshot"))
          .pipe(Effect.forkChild);
        yield* Deferred.await(entered);
        const waking = yield* recovery.next.pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const pinned = yield* Fiber.join(negotiating);
        assert.equal(pinned?.type, "usage-snapshot");
        assert.deepEqual(yield* Fiber.join(waking), pinned);
        restored.apply(pinned!);
        assert.equal(restored.total(), 120n);
      }),
    ),
  );

  it.effect(
    "incomplete paged recovery retains its cut; duplicate page ACK and replay do not recount",
    () =>
      withLedger((ledger) =>
        Effect.gen(function* () {
          const origin = yield* ledger.bind("source", binding, "claude");
          for (let index = 0; index < 101; index++)
            yield* ledger.capture(
              fact(origin.originId, `request-${index}`, "1"),
              "file",
              index + 1,
            );
          const hq = new Hq();
          const lane = makeUsageReplication(ledger);
          const hello = yield* lane.hello;
          const first = yield* lane.receive(hq.resume(hello, "snapshot", "snapshot"));
          if (first?.type !== "usage-snapshot") throw new Error("Expected snapshot");
          assert.equal(first.pages, 2);
          hq.apply(first);
          assert.equal(hq.cursor, "0");
          assert.isAbove(Number(hq.total()), 0);
          assert.isBelow(Number(hq.total()), 101);
          const ack = {
            type: "usage-snapshot-ack" as const,
            ledgerId: hello.ledgerId,
            channel: "snapshot",
            snapshotId: first.snapshotId,
            nextPage: 1,
            cursor: "0",
            digest: USAGE_GENESIS_DIGEST,
          };
          const second = yield* lane.receive(ack);
          assert.isUndefined(yield* lane.receive(ack));
          if (second?.type !== "usage-snapshot") throw new Error("Expected second page");
          hq.apply(second);
          hq.apply(second);
          assert.equal(hq.total(), 101n);
          yield* lane.receive({
            ...ack,
            nextPage: 2,
            cursor: second.highWater,
            digest: second.highDigest,
          });
          assert.equal((yield* ledger.metadata).ack, Number(second.highWater));
        }),
      ),
  );
  it.effect(
    "refuses cross-project clones and same-sequence different digest without changing totals",
    () =>
      withLedger((ledger) =>
        Effect.gen(function* () {
          const origin = yield* ledger.bind("source", binding, "claude");
          yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
          const denied = yield* ledger
            .bind("source", { ...binding, projectId: "clone" }, "claude")
            .pipe(Effect.flip);
          assert.equal(denied._tag, "UsageLedgerError");
          const lane = makeUsageReplication(ledger);
          const hello = yield* lane.hello;
          const deniedPrefix = yield* lane
            .receive({
              type: "usage-resume",
              ledgerId: hello.ledgerId,
              channel: "clone",
              cursor: hello.highWater,
              digest: "f".repeat(64),
              action: "snapshot",
            })
            .pipe(Effect.flip);
          assert.equal(deniedPrefix._tag, "UsageLedgerError");
          assert.equal((yield* ledger.metadata).highWater, Number(hello.highWater));
        }),
      ),
  );

  it.effect("a baseline finished for a replaced ledger never marks the new one baselined", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        yield* ledger.begin(binding);
        const old = (yield* ledger.metadata).ledgerId;
        yield* ledger.restart({ ...binding, mateId: "mate-2" });
        yield* ledger.markBaselined(old);
        assert.isFalse((yield* ledger.metadata).baselined);
        yield* ledger.markBaselined((yield* ledger.metadata).ledgerId);
        assert.isTrue((yield* ledger.metadata).baselined);
      }),
    ),
  );
  it.effect("a new ledger never takes an origin under the registration it replaced", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        yield* ledger.begin(binding);
        yield* ledger.restart({ ...binding, mateId: "mate-2" });
        const stale = yield* ledger.bind("source", binding, "claude").pipe(Effect.flip);
        assert.equal(
          stale._tag === "UsageLedgerError" ? stale.code : stale._tag,
          "source-binding-conflict",
        );
        assert.lengthOf(yield* ledger.origins, 0);
      }),
    ),
  );
  it.effect("an unavailable HQ is asked again after a growing delay, never at once", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const lane = makeUsageReplication(ledger);
        const hello = yield* lane.hello;
        const unavailable = {
          type: "usage-error" as const,
          ledgerId: hello.ledgerId,
          code: "usage_ingest_unavailable",
          disposition: "transient" as const,
        };
        assert.isUndefined(yield* lane.receive(unavailable));
        assert.isUndefined(yield* lane.next);
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* lane.next)?.type, "usage-hello");
        assert.isUndefined(yield* lane.receive(unavailable));
        yield* TestClock.adjust("5 seconds");
        assert.isUndefined(yield* lane.next);
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* lane.next)?.type, "usage-hello");
        const hq = new Hq();
        yield* lane.receive(hq.resume(hello, "open"));
        assert.isUndefined(yield* lane.receive(unavailable));
        yield* TestClock.adjust("5 seconds");
        assert.equal((yield* lane.next)?.type, "usage-hello");
      }),
    ),
  );

  it.effect("a fenced lane stops quietly and the next link's lane carries the journal on", () =>
    withLedger((ledger) =>
      Effect.gen(function* () {
        const origin = yield* ledger.bind("source", binding, "claude");
        yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
        const hq = new Hq();
        const fenced = makeUsageReplication(ledger);
        const hello = yield* fenced.hello;
        yield* fenced.receive(hq.resume(hello, "old"));
        const answer = yield* fenced.receive({
          type: "usage-error",
          ledgerId: hello.ledgerId,
          code: "channel_replaced",
          disposition: "fenced",
        });
        assert.isUndefined(answer);
        assert.isUndefined(yield* fenced.next);
        const lane = makeUsageReplication(ledger);
        const reopened = yield* lane.hello;
        hq.apply((yield* lane.receive(hq.resume(reopened, "new")))!);
        yield* lane.receive(hq.ack(reopened.ledgerId, "new"));
        assert.equal(hq.total(), 120n);
        assert.equal((yield* ledger.metadata).ack, Number(hq.cursor));
      }),
    ),
  );

  it.effect(
    "a stale-channel ACK cannot compact; capture and source checkpoint roll back together",
    () =>
      withLedger((ledger) =>
        Effect.gen(function* () {
          const origin = yield* ledger.bind("source", binding, "claude");
          yield* ledger
            .transaction(
              ledger
                .capture(fact(origin.originId, "a", "999"), "file", 1)
                .pipe(
                  Effect.andThen(ledger.saveCheckpoint("file", "advanced")),
                  Effect.andThen(Effect.fail("crash")),
                ),
            )
            .pipe(Effect.flip);
          assert.isUndefined(yield* ledger.checkpoint("file"));
          yield* ledger.capture(fact(origin.originId, "a", "120"), "file", 1);
          const hq = new Hq();
          const lane = makeUsageReplication(ledger);
          const hello = yield* lane.hello;
          hq.apply((yield* lane.receive(hq.resume(hello, "active")))!);
          assert.isUndefined(yield* lane.receive(hq.ack(hello.ledgerId, "obsolete")));
          assert.equal((yield* ledger.metadata).ack, 0);
          yield* lane.receive(hq.ack(hello.ledgerId, "active"));
          assert.equal(hq.total(), 120n);
        }),
      ),
  );
});

const codexLine = (type: string, payload: unknown, timestamp = "2026-10-07T12:00:00.000Z") =>
  JSON.stringify({ type, payload, timestamp });
const cumulative = (total: number) =>
  codexLine("event_msg", {
    type: "token_count",
    info: {
      total_token_usage: {
        input_tokens: total,
        cached_input_tokens: 0,
        output_tokens: 0,
        total_tokens: total,
      },
    },
  });
describe("Claude/Codex meters", () => {
  it("keeps response identity, cache splits and unknown components without invented zero", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "s",
      requestId: "r",
      timestamp: "2026-10-07T12:00:00.000Z",
      message: {
        id: "m",
        model: "claude",
        usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 10 },
      },
    });
    const first = meterLine("claude", line, initialMeterState()).fact!;
    assert.deepEqual(first, meterLine("claude", line, initialMeterState()).fact);
    assert.equal(first.components.uncachedInput, "100");
    assert.equal(first.components.cachedInput, "20");
    assert.isNull(first.components.cacheCreation);
  });
  it("reads Claude reasoning from thinking tokens and leaves it unknown when they are absent", () => {
    const line = (usage: unknown) =>
      JSON.stringify({
        type: "assistant",
        sessionId: "s",
        message: { id: "m", model: "claude", usage },
      });
    const thinking = meterLine(
      "claude",
      line({
        input_tokens: 2,
        output_tokens: 442,
        output_tokens_details: { thinking_tokens: 285 },
      }),
      initialMeterState(),
    ).fact!;
    assert.equal(thinking.components.reasoning, "285");
    const silent = meterLine(
      "claude",
      line({ input_tokens: 2, output_tokens: 442 }),
      initialMeterState(),
    ).fact!;
    assert.isNull(silent.components.reasoning);
  });
  it("a Codex cache write is counted when its meter reports one and is a structural zero otherwise", () => {
    const counter = (usage: Record<string, number>) =>
      codexLine("event_msg", { type: "token_count", info: { total_token_usage: usage } });
    const written = initialMeterState();
    meterLine("codex", codexLine("session_meta", { id: "w" }), written);
    const write = meterLine(
      "codex",
      counter({
        input_tokens: 300,
        cached_input_tokens: 100,
        cache_write_input_tokens: 50,
        output_tokens: 10,
        total_tokens: 310,
      }),
      written,
    ).fact!;
    assert.equal(write.components.cacheCreation, "50");
    assert.equal(write.components.uncachedInput, "150");
    const plain = initialMeterState();
    meterLine("codex", codexLine("session_meta", { id: "p" }), plain);
    const none = meterLine(
      "codex",
      counter({
        input_tokens: 300,
        cached_input_tokens: 100,
        output_tokens: 10,
        total_tokens: 310,
      }),
      plain,
    ).fact!;
    assert.equal(none.components.cacheCreation, "0");
    assert.equal(none.components.uncachedInput, "200");
  });
  it("files a Claude sub-agent's requests under its own session, nested in its parent's", () => {
    const line = JSON.stringify({
      type: "assistant",
      sessionId: "s",
      agentId: "agent-1",
      isSidechain: true,
      timestamp: "2026-10-07T12:00:00.000Z",
      message: { id: "m", model: "claude", usage: { input_tokens: 1, output_tokens: 1 } },
    });
    const fact = meterLine("claude", line, initialMeterState()).fact!;
    assert.equal(fact.sessionId, usageDigest(["claude", "agent-1"]));
    assert.equal(fact.parentId, usageDigest(["claude", "s"]));
    const main = meterLine(
      "claude",
      line.replace(/"agentId":"agent-1","isSidechain":true,/u, ""),
      initialMeterState(),
    ).fact!;
    assert.equal(main.sessionId, usageDigest(["claude", "s"]));
    assert.isNull(main.parentId);
  });
  it("preserves proved fast/cache duration bands and refuses inconsistent creation totals", () => {
    const line = (usage: unknown) =>
      JSON.stringify({
        type: "assistant",
        sessionId: "s",
        message: { id: "m", model: "claude", usage },
      });
    const known = meterLine(
      "claude",
      line({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 20,
        speed: "fast",
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20 },
      }),
      initialMeterState(),
    );
    assert.equal(known.fact?.pricingBand, "fast-cache-1h");
    assert.equal(known.fact?.components.cacheCreation, "20");
    const mixed = meterLine(
      "claude",
      line({
        cache_creation_input_tokens: 20,
        cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 10 },
      }),
      initialMeterState(),
    );
    assert.equal(mixed.fact?.components.cacheCreation, "20");
    assert.equal(mixed.gap, "claude-mixed-cache-duration");
    const unknown = meterLine(
      "claude",
      line({ cache_creation_input_tokens: 20 }),
      initialMeterState(),
    );
    assert.equal(unknown.fact?.pricingBand, "cache-duration-unknown");
    assert.equal(unknown.fact?.components.cacheCreation, "20");
    assert.equal(unknown.gap, "claude-cache-duration-unavailable");
    const invalid = meterLine(
      "claude",
      line({ cache_creation_input_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 20 } }),
      initialMeterState(),
    );
    assert.isUndefined(invalid.fact);
    assert.equal(invalid.gap, "claude-invalid-cache-duration-split");
  });
  it.effect(
    "120 → 150 → unproved reset 10 remains 150; proved new session adds 10 exactly once",
    () =>
      withLedger((ledger) =>
        Effect.gen(function* () {
          const origin = yield* ledger.bind("codex", binding, "codex");
          const state = initialMeterState();
          meterLine(
            "codex",
            codexLine("session_meta", { id: "first" }, "2026-10-07T11:00:00.000Z"),
            state,
          );
          for (const [index, total] of [120, 150].entries()) {
            const result = meterLine("codex", cumulative(total), state);
            yield* ledger.capture(
              { ...result.fact!, originId: origin.originId },
              "file",
              index + 1,
            );
          }
          const reset = meterLine("codex", cumulative(10), state);
          assert.equal(reset.gap, "codex-unproved-counter-reset");
          assert.isUndefined(reset.fact);
          // Passing the old high-water later does not prove that the reset counter has its lineage.
          assert.isUndefined(meterLine("codex", cumulative(180), state).fact);
          const nextState = initialMeterState();
          meterLine(
            "codex",
            codexLine("session_meta", { id: "second" }, "2026-10-07T11:00:00.000Z"),
            nextState,
          );
          const next = meterLine("codex", cumulative(10), nextState).fact!;
          yield* ledger.capture({ ...next, originId: origin.originId }, "new-file", 1);
          yield* ledger.capture({ ...next, originId: origin.originId }, "new-file", 1);
          const hq = new Hq();
          const lane = makeUsageReplication(ledger);
          const hello = yield* lane.hello;
          hq.apply((yield* lane.receive(hq.resume(hello, "channel")))!);
          assert.equal(hq.total(), 160n);
        }),
      ),
  );
  it("a Codex session resumed after capture began never sends the total it had before", () => {
    const floor = Date.parse("2026-10-07T12:00:00.000Z");
    const state = initialMeterState();
    meterLine(
      "codex",
      codexLine("session_meta", { id: "s" }, "2026-10-01T10:00:00.000Z"),
      state,
      floor,
    );
    meterLine("codex", codexLine("turn_context", { model: "a" }), state, floor);
    const before = codexLine(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 0,
            output_tokens: 0,
            total_tokens: 1000,
          },
        },
      },
      "2026-10-01T10:05:00.000Z",
    );
    assert.isUndefined(meterLine("codex", before, state, floor).fact);
    const after = meterLine("codex", cumulative(1300), state, floor).fact!;
    assert.equal(after.components.inclusiveTotal, "300");
    assert.equal(after.components.uncachedInput, "300");
    assert.deepEqual(after.time, {
      kind: "interval",
      since: "2026-10-01T10:05:00.000Z",
      until: "2026-10-07T12:00:00.000Z",
      provenance: "provider-counter-range",
    });
  });
  it("counts a Codex fork's and child's own usage under their parent session, never the history they copied", () => {
    const fork = initialMeterState();
    meterLine(
      "codex",
      codexLine(
        "session_meta",
        { id: "fork", forked_from_id: "parent" },
        "2026-10-07T12:00:00.000Z",
      ),
      fork,
    );
    // The parent's history is copied in at the fork instant, then the ancestors' metas.
    meterLine(
      "codex",
      codexLine("session_meta", { id: "parent" }, "2026-10-07T12:00:00.010Z"),
      fork,
    );
    const copied = codexLine(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 0,
            output_tokens: 0,
            total_tokens: 1000,
          },
        },
      },
      "2026-10-07T12:00:00.020Z",
    );
    assert.isUndefined(meterLine("codex", copied, fork).fact);
    const own = codexLine(
      "event_msg",
      {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1300,
            cached_input_tokens: 0,
            output_tokens: 0,
            total_tokens: 1300,
          },
        },
      },
      "2026-10-07T12:00:30.000Z",
    );
    const forked = meterLine("codex", own, fork).fact!;
    assert.equal(forked.components.inclusiveTotal, "300");
    assert.equal(forked.sessionId, usageDigest(["codex", "fork"]));
    assert.equal(forked.parentId, usageDigest(["codex", "parent"]));
    const child = initialMeterState();
    meterLine(
      "codex",
      codexLine(
        "session_meta",
        { id: "child", source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } },
        "2026-10-07T11:59:00.000Z",
      ),
      child,
    );
    const spawned = meterLine("codex", cumulative(120), child).fact!;
    assert.equal(spawned.components.inclusiveTotal, "120");
    assert.equal(spawned.parentId, usageDigest(["codex", "parent"]));
  });
  it("refuses invalid cache subsets; keeps mixed-model counter allocation unknown", () => {
    const early = initialMeterState();
    meterLine("codex", codexLine("session_meta", { id: "early" }), early);
    meterLine("codex", codexLine("turn_context", { model: "a" }), early);
    meterLine("codex", codexLine("turn_context", { model: "b" }), early);
    assert.isNull(meterLine("codex", cumulative(120), early).fact?.model);
    const state = initialMeterState();
    meterLine("codex", codexLine("session_meta", { id: "s" }, "2026-10-06T23:00:00.000Z"), state);
    meterLine("codex", codexLine("turn_context", { model: "a" }), state);
    meterLine("codex", cumulative(120), state);
    meterLine("codex", codexLine("turn_context", { model: "b" }), state);
    const second = meterLine("codex", cumulative(150), state).fact!;
    assert.isNull(second.model);
    assert.equal(second.time.kind, "interval");
    assert.equal(
      meterLine(
        "codex",
        codexLine("event_msg", {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 1, cached_input_tokens: 2, total_tokens: 151 },
          },
        }),
        state,
      ).gap,
      "codex-invalid-cache-subset",
    );
  });
});
