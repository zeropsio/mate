/**
 * What an automated Mate keeps of each task beyond its conversation's record: what the task may
 * spend (`MateTaskLimits`), what it spent (the minutes its runs took, its turns' reported cost), and
 * how people or its limits ended it. Kept in the server's state directory (`automated-tasks.json`)
 * so a restart neither starts a stopped task again nor forgets what one spent.
 *
 * Each change replaces the file whole (a synced sibling renamed over it); a write that fails is
 * told and the entry kept in memory: the next change writes it again.
 *
 * @module ZeropsTaskLedger
 */
import { MateTaskLimits } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";

/** How many tasks the ledger keeps: the oldest go first, long after HQ stopped asking of them. */
const KEPT_TASKS = 200;

const TaskEntry = Schema.Struct({
  limits: Schema.optionalKey(MateTaskLimits),
  /** People stopped it (`task-stop`), with HQ's reason: it takes no more messages. */
  stopped: Schema.optionalKey(Schema.String),
  /**
   * How many times HQ put it back in line after the Mate took it (`task-stop` `requeued`), and at
   * how many of them the Mate took it again: dropped while the first is ahead.
   */
  requeued: Schema.optionalKey(Schema.Number),
  retaken: Schema.optionalKey(Schema.Number),
  /** The limit that stopped it, or turned a follow-up away. */
  limitHit: Schema.optionalKey(Schema.Literals(["minutes", "cost"])),
  /** Each ended run of the task's, by its id: how long it ran. */
  runMs: Schema.Record(Schema.String, Schema.Number),
  /**
   * When each run of the task's on now was last seen live, by its id, at most a minute apart: a
   * run a restart cut ends at the recovery, so the time the Mate was down is never its own.
   */
  liveAt: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  /** US dollars in billionths (the usage record's scale 9), summed over the counted turns. */
  costNano: Schema.String,
  /** The provider turns counted in `costNano`: a turn's usage told twice counts once. */
  turns: Schema.Array(Schema.String),
});
export type TaskEntry = typeof TaskEntry.Type;

export const emptyTaskEntry: TaskEntry = { runMs: {}, costNano: "0", turns: [] };

const encodeEntry = Schema.encodeSync(Schema.fromJsonString(TaskEntry));
const LedgerFile = Schema.fromJsonString(Schema.Record(Schema.String, TaskEntry));
const decodeLedgerFile = Schema.decodeUnknownOption(LedgerFile);
const encodeLedgerFile = Schema.encodeSync(LedgerFile);

export class ZeropsTaskLedger extends Context.Service<
  ZeropsTaskLedger,
  {
    /** The task's entry; none for a task the ledger holds nothing of. */
    readonly entry: (taskId: string) => Effect.Effect<TaskEntry | undefined>;
    /** Changes the task's entry (an empty one when it has none) and keeps it; the entry after. */
    readonly update: (
      taskId: string,
      change: (entry: TaskEntry) => TaskEntry,
    ) => Effect.Effect<TaskEntry>;
  }
>()("t3/zerops/ZeropsTaskLedger") {}

/** A ledger over `entries`, each change kept by `keep`. */
const ledgerOver = (
  entries: Map<string, TaskEntry>,
  keep: (entries: ReadonlyMap<string, TaskEntry>) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const writing = yield* Semaphore.make(1);
    const update: ZeropsTaskLedger["Service"]["update"] = (taskId, change) =>
      Effect.gen(function* () {
        const before = entries.get(taskId);
        const next = change(before ?? emptyTaskEntry);
        if (before !== undefined && encodeEntry(before) === encodeEntry(next)) return next;
        entries.delete(taskId);
        entries.set(taskId, next);
        for (const oldest of entries.keys()) {
          if (entries.size <= KEPT_TASKS) break;
          entries.delete(oldest);
        }
        yield* keep(entries);
        return next;
      }).pipe(writing.withPermit);
    return ZeropsTaskLedger.of({
      entry: (taskId) => Effect.sync(() => entries.get(taskId)),
      update,
    });
  });

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const file = path.join(stateDir, "automated-tasks.json");
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
    ).pipe(Effect.andThen(fs.rename(temp, file)));
  return yield* ledgerOver(new Map(Object.entries(kept)), (entries) =>
    write(encodeLedgerFile(Object.fromEntries(entries))).pipe(
      Effect.catch((error) =>
        Effect.logWarning("zerops tasks: the task ledger could not be kept", {
          reason: error.message,
        }),
      ),
    ),
  );
});

export const layer = Layer.effect(ZeropsTaskLedger, make);

/** A ledger in memory, over `entries` a test keeps to start the same Mate again on them. */
export const layerMemory = (entries: Map<string, TaskEntry> = new Map()) =>
  Layer.effect(
    ZeropsTaskLedger,
    ledgerOver(entries, () => Effect.void),
  );
