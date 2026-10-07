/** One negotiated accounting lane per socket. ACKs from a replaced channel cannot prune evidence. */
import type { UsageLinkDown, UsageLinkUp } from "@t3tools/shared/agentUsage";
import { USAGE_GENESIS_DIGEST } from "@t3tools/shared/agentUsage";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { UsageLedgerError, type UsageLedger } from "./UsageLedger.ts";

export const makeUsageReplication = (ledger: UsageLedger) => {
  const lock = Semaphore.makeUnsafe(1);
  let channel: string | undefined;
  let ledgerId: string | undefined;
  let cursor = "0";
  let stopped = false;
  let flight: { cursor: string; digest: string; frame: UsageLinkUp } | undefined;
  let pages: Extract<UsageLinkUp, { type: "usage-snapshot" }>[] | undefined;
  let page = 0;
  let advertisement: Extract<UsageLinkUp, { type: "usage-hello" }> | undefined;
  const conflict = (code: string) => new UsageLedgerError({ code });
  const announced = (frame: Extract<UsageLinkUp, { type: "usage-batch" | "usage-snapshot" }>) => {
    const known = new Set(advertisement?.origins.map((origin) => origin.originId));
    const rows =
      frame.type === "usage-batch"
        ? frame.entries.flatMap((entry) => [...entry.facts, ...entry.coverage])
        : [...frame.facts, ...frame.coverage];
    return rows.every((row) => known.has(row.originId));
  };
  const next = Effect.gen(function* () {
    if (stopped) return undefined;
    if (!channel) return advertisement;
    if (flight) return flight.frame;
    if (pages) {
      const value = pages[page];
      if (value && !announced(value)) return yield* hello;
      if (value) flight = { cursor: value.highWater, digest: value.highDigest, frame: value };
      return value;
    }
    const value = yield* ledger.batch(cursor, channel);
    if (stopped) return undefined;
    if (value && !announced(value)) return yield* hello;
    if (value) {
      const last = value.entries[value.entries.length - 1]!;
      flight = { cursor: last.sequence, digest: last.digest, frame: value };
    }
    return value;
  });
  const hello = Effect.gen(function* () {
    if (stopped) return yield* conflict("lane-stopped");
    const value = yield* ledger.hello;
    if (stopped) return yield* conflict("lane-stopped");
    ledgerId = value.ledgerId;
    advertisement = value;
    channel = undefined;
    flight = undefined;
    pages = undefined;
    return value;
  });
  const receive = Effect.fnUntraced(function* (message: UsageLinkDown) {
    if (stopped || message.ledgerId !== ledgerId) return undefined;
    if (message.type === "usage-error") {
      if (message.disposition === "transient") return yield* hello;
      stopped = true;
      return yield* conflict(message.code);
    }
    if (message.type === "usage-resume") {
      const digest = yield* ledger.digestAt(message.cursor);
      if (digest !== undefined && digest !== message.digest)
        return yield* conflict("prefix-conflict");
      if (message.cursor === "0" && message.digest !== USAGE_GENESIS_DIGEST)
        return yield* conflict("prefix-conflict");
      channel = message.channel;
      cursor = message.cursor;
      flight = undefined;
      if (message.action === "snapshot") pages = yield* ledger.snapshot(channel);
      else {
        if (digest === undefined) return yield* conflict("unproved-replay-prefix");
        pages = undefined;
        yield* ledger.acknowledge(message.cursor, message.digest);
        yield* ledger.compact;
      }
      page = 0;
      return yield* next;
    }
    if (message.channel !== channel || !flight) return undefined;
    if (message.type === "usage-snapshot-ack") {
      const current = pages?.[page];
      if (!current || message.snapshotId !== current.snapshotId) return undefined;
      if (message.nextPage <= page) return undefined;
      if (message.nextPage !== page + 1) return yield* conflict("snapshot-ack-page");
      if (message.nextPage === current.pages) {
        if (message.cursor !== current.highWater || message.digest !== current.highDigest)
          return yield* conflict("snapshot-ack-cut");
        yield* ledger.acknowledge(message.cursor, message.digest);
        yield* ledger.finishSnapshot;
        cursor = message.cursor;
        pages = undefined;
      }
      page = message.nextPage;
      flight = undefined;
      yield* ledger.compact;
      return yield* next;
    }
    if (pages) return yield* conflict("snapshot-awaiting-page-ack");
    if (BigInt(message.cursor) <= BigInt(cursor)) return undefined;
    if (message.cursor !== flight.cursor || message.digest !== flight.digest)
      return yield* conflict("ack-outside-flight");
    yield* ledger.acknowledge(message.cursor, message.digest);
    cursor = message.cursor;
    flight = undefined;
    yield* ledger.compact;
    return yield* next;
  });
  // Source wakes and socket ACKs share one lane; a paused snapshot cannot expose its cursor early.
  const serialized = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      lock.withPermits(1),
      Effect.onError(() =>
        Effect.sync(() => {
          stopped = true;
        }),
      ),
    );
  return {
    hello: serialized(hello),
    next: serialized(next),
    receive: (message: UsageLinkDown) => serialized(receive(message)),
    stop: () => {
      stopped = true;
    },
  };
};
export type UsageReplication = ReturnType<typeof makeUsageReplication>;
