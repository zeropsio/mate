/**
 * What a Mate keeps of each message its person's other Mates sent it (`ZeropsMateMessages`): the
 * message as HQ sent it, the owner HQ named as the Mate took it, the conversation its run went
 * into, how that run ended, and whether HQ acknowledged that end. Kept in the server's state
 * directory (`mate-messages.json`), so a restart neither loses a message it said it took nor an end
 * HQ has not heard.
 *
 * Each change replaces the file whole (a synced sibling renamed over it). A change that could not
 * be written fails and is undone, so the ledger never holds what a restart would not: whoever
 * changed it makes the change again at its next look.
 *
 * @module ZeropsMateMessageLedger
 */
import { MateMessage, MateMessageEnd } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

/**
 * How many acknowledged messages the ledger keeps, by id only: one HQ sends again is answered
 * `message-taken` and never worked twice. The oldest go first; an open one is never dropped.
 */
const KEPT_SETTLED = 200;

const MessageEntry = Schema.Struct({
  /** The message as HQ sent it; dropped once HQ acknowledged its end. */
  message: Schema.optionalKey(MateMessage),
  /**
   * The owner HQ named for this Mate when it took the message: the one signer its run may spend.
   * Absent: HQ named none, and the message was declined.
   */
  ownerUserId: Schema.optionalKey(Schema.String),
  takenAt: Schema.Number,
  /** The conversation its run went into, once the engine recorded its message there. */
  conversationId: Schema.optionalKey(Schema.String),
  end: Schema.optionalKey(MateMessageEnd),
  /** An ask's answer, as `message-ended` carries it. */
  words: Schema.optionalKey(Schema.String),
  /** HQ recorded the end (`message-ack`): it is told no more. */
  acked: Schema.optionalKey(Schema.Literal(true)),
});
export type MessageEntry = typeof MessageEntry.Type;

const encodeEntry = Schema.encodeSync(Schema.fromJsonString(MessageEntry));
const LedgerFile = Schema.fromJsonString(Schema.Record(Schema.String, MessageEntry));
const decodeLedgerFile = Schema.decodeUnknownOption(LedgerFile);
const encodeLedgerFile = Schema.encodeSync(LedgerFile);

/** A change the ledger could not write: kept in memory only until the next one writes. */
export class MateMessageLedgerUnwritten extends Schema.TaggedError<MateMessageLedgerUnwritten>()(
  "MateMessageLedgerUnwritten",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "The Mate's message ledger could not be written";
  }
}

export class ZeropsMateMessageLedger extends Context.Service<
  ZeropsMateMessageLedger,
  {
    /** Every message the ledger holds, oldest taken first. */
    readonly entries: Effect.Effect<ReadonlyArray<readonly [string, MessageEntry]>>;
    /** The message's entry; none for one the Mate never took. */
    readonly entry: (id: string) => Effect.Effect<MessageEntry | undefined>;
    /**
     * Sets the message's entry from what it held (none for a message never taken) and writes the
     * ledger; the entry after. Fails when it could not be written.
     */
    readonly update: (
      id: string,
      change: (entry: MessageEntry | undefined) => MessageEntry,
    ) => Effect.Effect<MessageEntry, MateMessageLedgerUnwritten>;
  }
>()("t3/zerops/ZeropsMateMessageLedger") {}

/** A ledger over `entries`, each change kept by `keep`. */
const ledgerOver = (
  entries: Map<string, MessageEntry>,
  keep: (
    entries: ReadonlyMap<string, MessageEntry>,
  ) => Effect.Effect<void, MateMessageLedgerUnwritten>,
) =>
  Effect.gen(function* () {
    const writing = yield* Semaphore.make(1);
    const update: ZeropsMateMessageLedger["Service"]["update"] = (id, change) =>
      Effect.gen(function* () {
        const before = entries.get(id);
        const next = change(before);
        if (before !== undefined && encodeEntry(before) === encodeEntry(next)) return next;
        const held = new Map(entries);
        entries.set(id, next);
        const settled = [...entries].filter(([, entry]) => entry.acked === true);
        for (const [oldest] of settled.slice(0, Math.max(0, settled.length - KEPT_SETTLED))) {
          entries.delete(oldest);
        }
        yield* keep(entries).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              entries.clear();
              for (const [key, entry] of held) entries.set(key, entry);
            }),
          ),
        );
        return next;
      }).pipe(writing.withPermit);
    return ZeropsMateMessageLedger.of({
      entries: Effect.sync(() => [...entries]),
      entry: (id) => Effect.sync(() => entries.get(id)),
      update,
    });
  });

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const file = path.join(stateDir, "mate-messages.json");
  // Unreadable or absent: nothing kept.
  const kept = yield* fs.readFileString(file).pipe(
    Effect.map((text) => Option.getOrElse(decodeLedgerFile(text), () => ({}))),
    Effect.orElseSucceed(() => ({})),
  );
  const temp = `${file}.next`;
  const encoder = new TextEncoder();
  /**
   * Replaced whole, never written in place: the next ledger goes to a sibling file, is synced to
   * disk, then takes the ledger's name, so a crash mid-write leaves the last whole one.
   */
  const write = (contents: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* fs.makeDirectory(stateDir, { recursive: true });
        const next = yield* fs.open(temp, { flag: "w" });
        yield* next.writeAll(encoder.encode(contents));
        yield* next.sync;
      }),
    ).pipe(
      Effect.andThen(fs.rename(temp, file)),
      Effect.mapError((cause) => new MateMessageLedgerUnwritten({ cause })),
    );
  return yield* ledgerOver(new Map(Object.entries(kept)), (entries) =>
    write(encodeLedgerFile(Object.fromEntries(entries))),
  );
});

export const layer = Layer.effect(ZeropsMateMessageLedger, make);

/** A ledger in memory, over `entries` a test keeps to start the same Mate again on them. */
export const layerMemory = (entries: Map<string, MessageEntry> = new Map()) =>
  Layer.effect(
    ZeropsMateMessageLedger,
    ledgerOver(entries, () => Effect.void),
  );
