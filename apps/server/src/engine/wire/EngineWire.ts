/**
 * The engine's conversation wire, server side: what `registerEngineRpc` serves.
 *
 * A subscription attaches to the conversation's committed events and to the live plane first,
 * then sends a window snapshot (or, from a cursor in the same sequence space, only what changed
 * since), then `synchronized`, then each commit's changed records and the live text as it streams.
 * Changes are state-based: whole records by `rev`, read after the commit, so a burst that lands
 * while the client is slow goes as one frame. Streamed text is keyed by item (the live plane names
 * it by the driver's key; the record's `ItemOpened` joins the two) and settled when the item's
 * boundary record is sent. Calls enter the conversation's actor as the person, under the client's
 * command id, so a retry answers with the stored receipt.
 *
 * In V1 mode the wire is `unservedWire`: every method answers `unserved`, nothing is read.
 *
 * @module engine/wire/EngineWire
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandResult,
  ConversationHeader,
  ENGINE_WIRE_BUDGETS,
  EngineWireError,
  MATE_ENGINE_PROTOCOLS,
  type CommandId,
  type ConversationId,
  type EngineAnswerInput,
  type EngineDismissInput,
  type EngineCallResult,
  type EngineConversationFrame,
  type EngineDetail,
  type EnginePage,
  type EngineReadDetailInput,
  type EngineReadEarlierInput,
  type EngineReadRunInput,
  type EngineReceiptInput,
  type EngineReceiptResult,
  type EngineRowsFrame,
  type EngineSendInput,
  type EngineSteerInput,
  type EngineSwitchModelInput,
  type EngineStopInput,
  type EngineSubscribeInput,
  type EngineSubscribeRowsInput,
  type EngineUnserved,
  type EngineWindow,
  type ItemId,
  type KnownEngineEvent,
  type Principal,
} from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import type { Command } from "../domain/command.ts";
import type { ConversationState } from "../domain/state.ts";
import { EngineSignals } from "../EngineSignals.ts";
import { LiveBus, type LiveFrame } from "../LiveBus.ts";
import { conversationRowOf } from "../read/conversationRow.ts";
import { readConversationView } from "../read/conversationView.ts";
import { bytesOf, changesFrames, fitRecords, liveFrames, sliceUtf8 } from "./budget.ts";
import { makeRecords } from "./records.ts";

/** Who calls, and the revision their records carry: the Mate's environment and start epoch. */
export interface WireCaller {
  readonly subject: string;
  readonly environmentId: string;
  readonly epoch: number;
}

export interface EngineWireShape {
  readonly subscribe: (
    input: EngineSubscribeInput,
    caller: WireCaller,
  ) => Stream.Stream<EngineConversationFrame, EngineWireError>;
  readonly subscribeRows: (
    input: EngineSubscribeRowsInput,
    caller: WireCaller,
  ) => Stream.Stream<EngineRowsFrame, EngineWireError>;
  readonly readEarlier: (
    input: EngineReadEarlierInput,
  ) => Effect.Effect<EnginePage, EngineWireError>;
  readonly readRun: (input: EngineReadRunInput) => Effect.Effect<EnginePage, EngineWireError>;
  readonly readDetail: (
    input: EngineReadDetailInput,
  ) => Effect.Effect<EngineDetail, EngineWireError>;
  readonly receipt: (
    input: EngineReceiptInput,
  ) => Effect.Effect<EngineReceiptResult, EngineWireError>;
  readonly send: (
    input: EngineSendInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
  readonly stop: (
    input: EngineStopInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
  readonly answer: (
    input: EngineAnswerInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
  readonly dismiss: (
    input: EngineDismissInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
  readonly steer: (
    input: EngineSteerInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
  readonly switchModel: (
    input: EngineSwitchModelInput,
    caller: WireCaller,
  ) => Effect.Effect<EngineCallResult, EngineWireError>;
}

// ── unserved ────────────────────────────────────────────────────────────────────────────────

/** What a client hears from a Mate whose conversation is on the V1 wire. */
export const NOT_ON_ENGINE = "This Mate's conversation runs on the orchestration wire.";
/** What a client hears when it speaks a protocol newer than this Mate's. */
export const MATE_TOO_OLD = "This Mate is older than this app. Update the Mate to talk to it here.";
/** What a client hears when it speaks a protocol older than this Mate serves. */
export const APP_TOO_OLD = "Update Zerops Mate to keep talking to this Mate.";

const unserved = (reason: EngineUnserved["reason"], message: string): EngineUnserved => ({
  type: "unserved",
  reason,
  protocols: reason === "protocol" ? [...MATE_ENGINE_PROTOCOLS] : [],
  message,
});

/** The protocol a client speaks, unless this server cannot serve it: then where it is routed. */
export const protocolRefusal = (protocol: number): EngineUnserved | undefined => {
  if (MATE_ENGINE_PROTOCOLS.includes(protocol)) return undefined;
  return unserved(
    "protocol",
    protocol > Math.max(...MATE_ENGINE_PROTOCOLS) ? MATE_TOO_OLD : APP_TOO_OLD,
  );
};

const notOnEngine = unserved("not-on-engine", NOT_ON_ENGINE);

/** The wire of a Mate whose conversation is V1's: every method answers unserved. */
export const unservedWire: EngineWireShape = {
  subscribe: () => Stream.make(notOnEngine),
  subscribeRows: () => Stream.make(notOnEngine),
  readEarlier: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  readRun: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  readDetail: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  receipt: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  send: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  stop: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  answer: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  dismiss: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  steer: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
  switchModel: () => Effect.succeed({ _tag: "Unserved", unserved: notOnEngine }),
};

// ── served ──────────────────────────────────────────────────────────────────────────────────

export interface EngineWireOptions {
  /** How long a subscription gathers commits and deltas before it sends them (default 50 ms). */
  readonly coalesce?: Duration.Input;
  /** Records a resume carries at most; past it the subscriber is reset. */
  readonly resumeRecords?: number;
  readonly snapshotBytes?: number;
  readonly changesBytes?: number;
}

const UNREADABLE = "The Mate engine could not read this conversation now. Try again.";
/** Why the wire refuses a person's message in a crewmate's chat. */
export const CREWMATE_SENDS = "A crewmate's chat takes messages through its crew.";

const UNTAKEN = "The Mate engine could not take this now. Try again.";

const wireError = (message: string) => (cause: unknown) =>
  Effect.logWarning(`Mate engine wire: ${message}`, cause).pipe(
    Effect.andThen(Effect.fail(new EngineWireError({ message }))),
  );

const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(CommandResult));
/** A header as text: a subscriber is sent it again only when this changes. */
const headerJson = Schema.encodeSync(Schema.fromJsonString(ConversationHeader));

const headerOf = (state: ConversationState): ConversationHeader => ({
  conversationId: state.conversationId,
  agent: state.agent,
  archived: state.archived,
  model: state.model,
  session:
    state.session === null
      ? null
      : {
          driver: state.session.driver,
          model: state.session.model,
          steer: state.session.capabilities.steer,
        },
  pausedUntil: state.pausedUntil,
  queued: state.queue.length,
});

type Inbox =
  | { readonly _tag: "event"; readonly event: KnownEngineEvent }
  | { readonly _tag: "live"; readonly frame: LiveFrame }
  | { readonly _tag: "failed"; readonly cause: unknown };

/** Inputs a subscription holds while its client reads the frames before them. */
const INBOX = 1024;
/** Streamed text the live plane named by a key no committed item has yet. */
const PENDING_KEYS = 8;
/** Keys of items whose boundary was sent: their late deltas are dropped. */
const SETTLED_KEYS = 512;

export const makeEngineWire = (options: EngineWireOptions = {}) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const live = yield* LiveBus;
    const signals = yield* EngineSignals;
    const sql = yield* SqlClient.SqlClient;
    const records = yield* makeRecords;
    const coalesce = Duration.fromInputUnsafe(options.coalesce ?? "50 millis");
    const resumeRecords = options.resumeRecords ?? ENGINE_WIRE_BUDGETS.resumeRecords;
    const snapshotBytes = options.snapshotBytes ?? ENGINE_WIRE_BUDGETS.snapshotBytes;
    const changesBytes = options.changesBytes ?? ENGINE_WIRE_BUDGETS.changesBytes;

    const header = (conversation: ConversationId) =>
      Effect.map(conversations.state(conversation), headerOf);

    /** The window snapshot, within its budget: fewer older groups, then a shorter live tail. */
    const snapshot = (
      conversation: ConversationId,
      groupsAsked: number,
      head: number,
      epoch: number,
      origin: string,
    ) =>
      Effect.gen(function* () {
        const all = yield* records.groups(conversation);
        const top = yield* header(conversation);
        let count = Math.min(Math.max(1, groupsAsked), ENGINE_WIRE_BUDGETS.earlierGroupsMax);
        for (;;) {
          const picked = records.pickGroups(all, count);
          const window = yield* records.windowOf(conversation, picked.runIds, picked.window);
          const fitted = fitRecords(window);
          const frame: Extract<EngineConversationFrame, { readonly type: "snapshot" }> = {
            type: "snapshot",
            protocol: Math.max(...MATE_ENGINE_PROTOCOLS),
            epoch,
            origin,
            head,
            header: top,
            runs: fitted.runs,
            items: fitted.items,
            requests: fitted.requests,
            window: window.window,
          };
          if (bytesOf(frame) <= snapshotBytes) return frame;
          if (count > 1) {
            count -= 1;
            continue;
          }
          // The newest group alone is over: its oldest work goes, its messages and asks stay.
          const items = [...frame.items];
          while (items.length > 0 && bytesOf({ ...frame, items }) > snapshotBytes) {
            const index = items.findIndex(
              (item) => item.kind !== "person" && item.kind !== "request",
            );
            if (index === -1) break;
            items.splice(index, 1);
          }
          return { ...frame, items };
        }
      });

    const subscribe: EngineWireShape["subscribe"] = (input, caller) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Stream.make(refused);
      const conversation = input.conversationId;
      const epoch = caller.epoch;
      return Stream.unwrap(
        Effect.gen(function* () {
          // Bounded: a subscriber that stops reading holds the live plane back, which drops it
          // frames and says so (Gap); it is then opened again with the text so far.
          const inbox = yield* Queue.bounded<Inbox>(INBOX);
          // Attach first: whatever commits or streams from here on reaches the inbox.
          const attachedAt = yield* records.head(conversation);
          yield* conversations.subscribe(conversation, attachedAt).pipe(
            Stream.runForEach((event) =>
              event._tag === "Unknown" ? Effect.void : Queue.offer(inbox, { _tag: "event", event }),
            ),
            Effect.catch((cause) => Queue.offer(inbox, { _tag: "failed", cause })),
            Effect.forkScoped,
          );
          // The live plane, subscribed again whenever this subscriber fell behind it.
          yield* Effect.scoped(
            Effect.flatMap(live.subscribe(conversation), (frames) =>
              Stream.runForEach(frames, (frame) =>
                frame._tag === "Gap" ? Effect.void : Queue.offer(inbox, { _tag: "live", frame }),
              ),
            ),
          ).pipe(Effect.forever, Effect.forkScoped);

          // Open: a resume from the cursor when it can, else a reset and a snapshot.
          const origin = yield* records.origin;
          const head = yield* records.head(conversation);
          const after = input.after;
          const opening: Array<EngineConversationFrame> = [];
          let cursor = head;
          let lastHeader = "";
          const resetReason =
            after === undefined
              ? undefined
              : after.origin !== origin
                ? ("origin" as const)
                : after.epoch > epoch
                  ? ("epoch" as const)
                  : after.seq > head
                    ? ("ahead" as const)
                    : (yield* records.changedCount(conversation, after.seq)) > resumeRecords
                      ? ("gap" as const)
                      : undefined;
          if (after !== undefined && resetReason === undefined) {
            const changed = yield* records.changedSince(conversation, after.seq);
            const top = yield* header(conversation);
            lastHeader = headerJson(top);
            cursor = Math.max(head, changed.to);
            opening.push(
              ...changesFrames(
                { epoch, from: after.seq, to: cursor, header: top },
                changed,
                changesBytes,
              ),
            );
          } else {
            if (resetReason !== undefined) opening.push({ type: "reset", reason: resetReason });
            const frame = yield* snapshot(
              conversation,
              input.groups ?? ENGINE_WIRE_BUDGETS.windowGroups,
              head,
              epoch,
              origin,
            );
            lastHeader = headerJson(frame.header);
            opening.push(frame);
          }
          opening.push({ type: "synchronized", epoch, head: cursor });

          // The live plane's keys for the items open now; later ones come with their records.
          const keyToItem = new Map<string, ItemId>();
          const itemToKey = new Map<string, string>();
          for (const row of yield* records.openItemKeys(conversation)) {
            if (row.live_key === null) continue;
            keyToItem.set(row.live_key, row.item_id as ItemId);
            itemToKey.set(row.item_id, row.live_key);
          }
          const settled = new Set<string>();
          const streaming = new Set<string>();
          const pending = new Map<string, Map<string, string>>();

          const place = (
            streams: Map<string, string>,
            stream: string,
            offset: number,
            text: string,
          ) => {
            const before = streams.get(stream) ?? "";
            streams.set(
              stream,
              offset <= before.length ? before.slice(0, offset) + text : before + text,
            );
          };

          const step = (batch: ReadonlyArray<Inbox>) =>
            Effect.gen(function* () {
              const failed = batch.find((input) => input._tag === "failed");
              if (failed !== undefined) return yield* wireError(UNREADABLE)(failed.cause);
              const frames: Array<EngineConversationFrame> = [];
              const events = batch.flatMap((input) =>
                input._tag === "event" ? [input.event] : [],
              );
              const opened: Array<string> = [];
              const closed: Array<string> = [];
              for (const event of events) {
                if (event._tag === "ItemOpened" && event.key !== null) {
                  keyToItem.set(event.key, event.itemId);
                  itemToKey.set(event.itemId, event.key);
                  opened.push(event.key);
                }
                if (event._tag === "ItemClosed") closed.push(event.itemId);
              }
              if (events.length > 0) {
                const changed = yield* records.changedSince(conversation, cursor);
                const top = yield* header(conversation);
                const topJson = headerJson(top);
                const to = Math.max(cursor, changed.to, ...events.map((event) => event.seq));
                const any =
                  changed.runs.length + changed.items.length + changed.requests.length > 0;
                if (any || topJson !== lastHeader) {
                  frames.push(
                    ...changesFrames(
                      {
                        epoch,
                        from: cursor,
                        to,
                        ...(topJson === lastHeader ? {} : { header: top }),
                      },
                      changed,
                      changesBytes,
                    ),
                  );
                  lastHeader = topJson;
                  cursor = to;
                }
              }
              // The boundary records are sent: their streamed text goes.
              for (const itemId of closed) {
                const key = itemToKey.get(itemId);
                if (key !== undefined) {
                  itemToKey.delete(itemId);
                  keyToItem.delete(key);
                  settled.add(key);
                  if (settled.size > SETTLED_KEYS) settled.delete(settled.values().next().value!);
                }
                if (streaming.delete(itemId)) {
                  frames.push({ type: "live.settle", itemId: itemId as ItemId });
                }
              }
              // Text that streamed before its item was committed opens with it.
              for (const key of opened) {
                const streams = pending.get(key);
                const itemId = keyToItem.get(key);
                pending.delete(key);
                if (streams === undefined || itemId === undefined) continue;
                for (const [stream, text] of streams) {
                  streaming.add(itemId);
                  frames.push(...liveFrames(itemId, stream, text, { open: true }));
                }
              }
              // Deltas, contiguous ones joined.
              let run: { itemId: ItemId; stream: string; offset: number; text: string } | null =
                null;
              const flush = () => {
                if (run === null) return;
                streaming.add(run.itemId);
                frames.push(
                  ...liveFrames(run.itemId, run.stream, run.text, {
                    open: false,
                    offset: run.offset,
                  }),
                );
                run = null;
              };
              for (const input of batch) {
                if (input._tag !== "live") continue;
                const frame = input.frame;
                switch (frame._tag) {
                  case "Open":
                    flush();
                    for (const entry of frame.items) {
                      if (settled.has(entry.key)) continue;
                      const itemId = keyToItem.get(entry.key);
                      if (itemId === undefined) {
                        const streams = pending.get(entry.key) ?? new Map<string, string>();
                        streams.set(entry.stream, entry.text);
                        pending.set(entry.key, streams);
                        continue;
                      }
                      streaming.add(itemId);
                      frames.push(...liveFrames(itemId, entry.stream, entry.text, { open: true }));
                    }
                    for (const entry of frame.progress ?? []) {
                      frames.push({
                        type: "progress",
                        itemId: entry.key as ItemId,
                        value: entry.value,
                      });
                    }
                    break;
                  case "Append": {
                    if (settled.has(frame.key)) break;
                    const itemId = keyToItem.get(frame.key);
                    if (itemId === undefined) {
                      flush();
                      const streams = pending.get(frame.key) ?? new Map<string, string>();
                      place(streams, frame.stream, frame.offset, frame.text);
                      pending.set(frame.key, streams);
                      if (pending.size > PENDING_KEYS) pending.delete(pending.keys().next().value!);
                      break;
                    }
                    const current = run as {
                      itemId: ItemId;
                      stream: string;
                      offset: number;
                      text: string;
                    } | null;
                    if (
                      current !== null &&
                      current.itemId === itemId &&
                      current.stream === frame.stream &&
                      current.offset + current.text.length === frame.offset
                    ) {
                      current.text += frame.text;
                    } else {
                      flush();
                      run = {
                        itemId,
                        stream: frame.stream,
                        offset: frame.offset,
                        text: frame.text,
                      };
                    }
                    break;
                  }
                  case "Progress":
                    flush();
                    frames.push({
                      type: "progress",
                      itemId: frame.key as ItemId,
                      value: frame.value,
                    });
                    break;
                  case "Context":
                    flush();
                    frames.push({ type: "context", usage: frame.usage });
                    break;
                  default:
                    break;
                }
              }
              flush();
              return frames;
            });

          const take = Effect.gen(function* () {
            const first = yield* Queue.takeAll(inbox);
            if (Duration.isZero(coalesce)) return first;
            yield* Effect.sleep(coalesce);
            return [...first, ...(yield* Queue.clear(inbox))];
          });

          return Stream.concat(
            Stream.fromIterable(opening),
            Stream.fromEffectRepeat(Effect.flatMap(take, step)).pipe(Stream.flattenIterable),
          );
        }).pipe(Effect.catch(wireError(UNREADABLE))),
      ).pipe(Stream.catch((cause) => Stream.fromEffect(wireError(UNREADABLE)(cause))));
    };

    const rowOf = (conversation: ConversationId, caller: WireCaller) =>
      readConversationView(conversation).pipe(
        Effect.provideService(Conversations, conversations),
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.map((view) =>
          view === undefined
            ? undefined
            : conversationRowOf(view, { environmentId: caller.environmentId, epoch: caller.epoch }),
        ),
      );

    const subscribeRows: EngineWireShape["subscribeRows"] = (input, caller) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Stream.make(refused);
      return Stream.unwrap(
        Effect.gen(function* () {
          const commits = yield* PubSub.subscribe(signals.commits);
          const ids = yield* sql<{ readonly conversation_id: string }>`
            SELECT conversation_id FROM engine_conversation WHERE owner_kind = 'conversation' ORDER BY rowid
          `;
          const rows = (yield* Effect.forEach(ids, (row) =>
            rowOf(row.conversation_id as ConversationId, caller),
          )).flatMap((row) => (row === undefined ? [] : [row]));
          const opening: ReadonlyArray<EngineRowsFrame> = [
            {
              type: "snapshot",
              protocol: Math.max(...MATE_ENGINE_PROTOCOLS),
              epoch: caller.epoch,
              rows,
            },
            { type: "synchronized", epoch: caller.epoch },
          ];
          const changed = Effect.gen(function* () {
            const batch = new Set(yield* PubSub.takeAll(commits));
            const frames: Array<EngineRowsFrame> = [];
            for (const id of batch) {
              const row = yield* rowOf(id, caller);
              if (row !== undefined) frames.push({ type: "row", row });
            }
            return frames;
          });
          return Stream.concat(
            Stream.fromIterable(opening),
            Stream.fromEffectRepeat(changed).pipe(Stream.flattenIterable),
          );
        }).pipe(Effect.catch(wireError(UNREADABLE))),
      ).pipe(Stream.catch((cause) => Stream.fromEffect(wireError(UNREADABLE)(cause))));
    };

    const pageOf = <E>(
      read: (count: number) => Effect.Effect<
        {
          readonly records: Parameters<typeof fitRecords>[0];
          readonly window: EngineWindow;
          readonly more: boolean;
        },
        E
      >,
      count: number,
      budget: number,
    ) =>
      Effect.gen(function* () {
        let n = count;
        for (;;) {
          const got = yield* read(n);
          const page: EnginePage = {
            _tag: "Page",
            ...fitRecords(got.records),
            window: got.window,
            more: got.more,
          };
          if (bytesOf(page) <= budget || n <= 1) return page;
          n = Math.max(1, Math.floor(n / 2));
        }
      }).pipe(Effect.catch(wireError(UNREADABLE)));

    const readEarlier: EngineWireShape["readEarlier"] = (input) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Effect.succeed({ _tag: "Unserved", unserved: refused });
      const conversation = input.conversationId;
      return pageOf(
        (count) =>
          Effect.gen(function* () {
            const picked = records.pickGroups(
              yield* records.groups(conversation),
              count,
              input.beforeOrdinal,
            );
            const window = yield* records.windowOf(conversation, picked.runIds, picked.window);
            return { records: window, window: window.window, more: window.window.earlier };
          }),
        Math.min(
          input.groups ?? ENGINE_WIRE_BUDGETS.windowGroups,
          ENGINE_WIRE_BUDGETS.earlierGroupsMax,
        ),
        ENGINE_WIRE_BUDGETS.earlierBytes,
      );
    };

    const readRun: EngineWireShape["readRun"] = (input) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Effect.succeed({ _tag: "Unserved", unserved: refused });
      return pageOf(
        (limit) =>
          Effect.gen(function* () {
            const page = yield* records.runPage(input.conversationId, input.runId, {
              ...(input.beforeSeq === undefined ? {} : { beforeSeq: input.beforeSeq }),
              limit,
            });
            return {
              records: page,
              window: { oldestOrdinal: page.runs[0]?.ordinal ?? null, earlier: false },
              more: page.more,
            };
          }),
        Math.min(
          Math.max(1, input.limit ?? ENGINE_WIRE_BUDGETS.runPageItems),
          ENGINE_WIRE_BUDGETS.runPageItems,
        ),
        ENGINE_WIRE_BUDGETS.runPageBytes,
      );
    };

    const readDetail: EngineWireShape["readDetail"] = (input) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Effect.succeed({ _tag: "Unserved", unserved: refused });
      return Effect.gen(function* () {
        const whole = yield* records.part(input.conversationId, input.itemId, input.part);
        if (whole === undefined) return { _tag: "Missing" } as const;
        const budget = ENGINE_WIRE_BUDGETS.detailBytes;
        const total = new TextEncoder().encode(whole).length;
        const range = input.range;
        const read =
          range === "tail"
            ? sliceUtf8(whole, Math.max(0, total - budget), budget)
            : sliceUtf8(whole, range?.from ?? 0, Math.min(range?.bytes ?? budget, budget));
        return { _tag: "Detail", ...read } as const;
      }).pipe(Effect.catch(wireError(UNREADABLE)));
    };

    const receipt: EngineWireShape["receipt"] = (input) => {
      const refused = protocolRefusal(input.protocol);
      if (refused !== undefined) return Effect.succeed({ _tag: "Unserved", unserved: refused });
      return Effect.gen(function* () {
        const stored = yield* records.receipt(input.conversationId, input.commandId);
        if (stored === null) return { _tag: "None" } as const;
        return { _tag: "Found", result: yield* decodeResult(stored) } as const;
      }).pipe(Effect.catch(wireError(UNREADABLE)));
    };

    /** A person's command, under the client's id: the receipt, a refusal by the engine's rules. */
    const command = (
      protocol: number,
      conversationId: ConversationId,
      commandId: CommandId,
      caller: WireCaller,
      body: Command,
    ): Effect.Effect<EngineCallResult, EngineWireError> => {
      const refused = protocolRefusal(protocol);
      if (refused !== undefined) return Effect.succeed({ _tag: "Unserved", unserved: refused });
      const principal: Principal = { kind: "person", subject: caller.subject };
      return conversations.ask({ commandId, conversationId, principal, command: body }).pipe(
        Effect.map((accepted): EngineCallResult => accepted),
        Effect.catchTag("CommandRejected", (rejected) =>
          Effect.succeed<EngineCallResult>({ _tag: "Rejected", rejection: rejected.rejection }),
        ),
        Effect.catch(wireError(UNTAKEN)),
      );
    };

    return {
      subscribe,
      subscribeRows,
      readEarlier,
      readRun,
      readDetail,
      receipt,
      send: (input, caller) =>
        // A crewmate's chat takes a person's message through its crew (`zerops.crew.command`),
        // which routes it to the crewmate's task; never straight into its conversation.
        conversations.state(input.conversationId).pipe(
          Effect.map((state) => state.agent?.profile.kind === "crewmate"),
          Effect.orElseSucceed(() => false),
          Effect.flatMap((crewmate) =>
            crewmate && protocolRefusal(input.protocol) === undefined
              ? Effect.succeed<EngineCallResult>({
                  _tag: "Rejected",
                  rejection: { reason: "unknown", detail: CREWMATE_SENDS },
                })
              : command(input.protocol, input.conversationId, input.commandId, caller, {
                  _tag: "Send",
                  text: input.text,
                  ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
                }),
          ),
        ),
      stop: (input, caller) =>
        command(input.protocol, input.conversationId, input.commandId, caller, {
          _tag: "Stop",
          ...(input.runId === undefined ? {} : { runId: input.runId }),
        }),
      answer: (input, caller) => {
        const answer = input.answer;
        if (answer.kind === "unknown" && protocolRefusal(input.protocol) === undefined) {
          return Effect.succeed<EngineCallResult>({
            _tag: "Rejected",
            rejection: {
              reason: "unknown",
              detail: `This Mate cannot take a ${answer.type} answer.`,
            },
          });
        }
        return command(input.protocol, input.conversationId, input.commandId, caller, {
          _tag: "Answer",
          requestId: input.requestId,
          answer:
            answer.kind === "approval"
              ? { decision: answer.decision }
              : answer.kind === "input"
                ? {
                    answers: answer.answers,
                    ...(answer.attachmentsByQuestionId === undefined
                      ? {}
                      : { attachmentsByQuestionId: answer.attachmentsByQuestionId }),
                  }
                : null,
          summary: input.summary,
        });
      },
      dismiss: (input, caller) =>
        command(input.protocol, input.conversationId, input.commandId, caller, {
          _tag: "Dismiss",
          requestId: input.requestId,
        }),
      steer: (input, caller) =>
        command(input.protocol, input.conversationId, input.commandId, caller, {
          _tag: "Steer",
          runId: input.runId,
          text: input.text,
        }),
      switchModel: (input, caller) =>
        command(input.protocol, input.conversationId, input.commandId, caller, {
          _tag: "SwitchModel",
          model: input.model,
        }),
    } satisfies EngineWireShape;
  });
