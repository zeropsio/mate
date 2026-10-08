import { MateHealth } from "@t3tools/contracts";
/**
 * The Mates' overviews as their links bring them (SPEC §3.4, `@t3tools/shared/mateLink`): each by
 * its project, in this Core's memory.
 *
 * - A link's first frame is the whole overview; each frame after it replaces the sections it names.
 *   Frames are taken from the link HQ hears alone: the Mate's newest link that no later run
 *   outranks. A link is of the run its attention names, and a run of an earlier epoch than the one
 *   HQ holds — a restarted server's old link HQ has not heard go yet, or that run back from a
 *   partition on a newer link — is passed by. A later run's attention is taken from whichever link
 *   brings it.
 * - A Mate is online while one of its links is open.
 * - The store keeps a Mate's overview as it stands when a whole one arrives and when one of its
 *   chats changes kind or one of its engine conversations its state — a state moving, never a live
 *   step or a word — so a Mate that sleeps keeps its last state for whoever reads it after a
 *   restart.
 *
 * @module mateOverviews
 */
import { HqAttentionValue, type HqAttentionScopeValue } from "@t3tools/shared/hqStream";
import { acceptAttention } from "./attentionIngest.ts";
import type { MatePresence } from "@t3tools/shared/hqMates";
import { type MateLinkUp, MateOverview } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { Leader } from "./leader.ts";

/** A frame of a Mate's overview, as its link brings it. */
const readAttention = Schema.decodeUnknownOption(HqAttentionValue);

/** Whether two attention values are of one run of one Mate. */
const sameRun = (left: { readonly source: Run }, right: { readonly source: Run }) =>
  left.source.environmentId === right.source.environmentId &&
  left.source.epoch === right.source.epoch &&
  left.source.incarnation === right.source.incarnation;

export type OverviewFrame = Extract<MateLinkUp, { readonly type: "overview" }>;

/** A Mate as HQ holds it: its presence, and its overview where it has one. */
export type MateOverviewEntry = HqAttentionScopeValue;

/** A Mate's overview as HQ's store keeps it. */
export interface StoredOverview {
  readonly projectId: string;
  readonly overview: MateOverview;
  /** When it was kept: ISO. */
  readonly reportedAt: string;
}

/** Where overviews outlive this Core. */
export interface OverviewStore {
  readonly loadHealth?: Effect.Effect<
    ReadonlyArray<{
      readonly projectId: string;
      readonly health: MateHealth;
      readonly reportedAt: string;
    }>
  >;
  readonly saveHealth?: (projectId: string, health: MateHealth) => Effect.Effect<void>;
  readonly load: Effect.Effect<ReadonlyArray<StoredOverview>>;
  readonly save: (projectId: string, overview: MateOverview) => Effect.Effect<void>;
  readonly forgetSeen?: (projectIds: ReadonlyArray<string>) => Effect.Effect<void>;
}

export class MateOverviews extends Context.Service<
  MateOverviews,
  {
    /** Registers an open link of the Mate for the scope's lifetime; the link's number. */
    readonly connect: (projectId: string) => Effect.Effect<number, never, Scope.Scope>;
    /** A frame the link `link` brought. */
    readonly report: (projectId: string, link: number, frame: OverviewFrame) => Effect.Effect<void>;
    readonly reportHealth: (
      projectId: string,
      link: number,
      value: MateHealth,
    ) => Effect.Effect<void>;
    readonly reportAttention: (
      projectId: string,
      link: number,
      value: unknown,
    ) => Effect.Effect<void>;
    /**
     * Reads back what the store keeps of every Mate HQ holds no link of: offline, as of its
     * writing. At a takeover.
     */
    readonly restore: Effect.Effect<void>;
    /** Lets go of Mates whose records went (`structure.ts`); their store rows go with the records. */
    readonly forget: (projectIds: ReadonlyArray<string>) => Effect.Effect<void>;
    /** Every Mate HQ holds, by project. */
    readonly all: Effect.Effect<ReadonlyMap<string, MateOverviewEntry>>;
    /** The projects whose Mate changed, as they change. */
    readonly changes: Stream.Stream<string>;
    readonly forgotten: Stream.Stream<string>;
    /** Synchronous cache fence after durable acknowledgements are forgotten. */
    readonly seenEpoch: Effect.Effect<number>;
  }
>()("@t3tools/hq/mateOverviews") {}

/** One run of a Mate, as its attention names it. */
type Run = Omit<HqAttentionValue["source"], "revision">;

interface Entry {
  readonly health: MateHealth | null;
  readonly healthOn: number | null;
  readonly attentionOn: number | null;
  readonly attention: HqAttentionValue | null;
  /** Its open links, oldest first: the newest is the one HQ hears. */
  readonly links: ReadonlyArray<number>;
  /** When it last went online or offline: ISO. */
  readonly since: string;
  readonly overview: MateOverview | null;
  /** The link whose whole overview HQ holds; sections are taken from it alone. */
  readonly fullOn: number | null;
  /** The run each open link's attention named; a link that said none yet has none. */
  readonly runs: ReadonlyMap<number, Run>;
}

/** Whether `run` is of an earlier run than `held` in the same environment: no later word. */
const outranked = (run: Run, held: { readonly source: Run }) =>
  run.environmentId === held.source.environmentId &&
  (run.epoch < held.source.epoch ||
    (run.epoch === held.source.epoch && run.incarnation !== held.source.incarnation));

/** The link HQ hears: the newest open one that no later run outranks. */
const heardOf = (entry: Entry) =>
  entry.links.findLast((link) => {
    const run = entry.runs.get(link);
    return (
      run === undefined ||
      ((entry.attention === null || !outranked(run, entry.attention)) &&
        (entry.health === null || !outranked(run, entry.health)))
    );
  });

/** Each listed chat's kind and each engine conversation's state: what moving says a state moved. */
const kindsOf = (overview: MateOverview | null) =>
  [
    ...(overview?.threads.list.map((thread) => `${thread.id}:${thread.kind}`) ?? []),
    ...(overview?.conversations?.map((row) => `${row.conversationId}:${row.state.kind}`) ?? []),
  ].join(" ");

/** Refusal and reset evidence must survive a Core restart even when the thread's kind stays put. */
const retainedStateOf = (overview: MateOverview | null) =>
  JSON.stringify([
    kindsOf(overview),
    overview?.main?.session?.lastError ?? null,
    overview?.main?.usagePause ?? null,
  ]);

export const makeMateOverviews = (
  store: OverviewStore,
): Effect.Effect<MateOverviews["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const entries = new Map<string, Entry>();
    let seenEpoch = 0;
    const changed = yield* PubSub.unbounded<string>();
    const forgotten = yield* PubSub.unbounded<string>();
    // Beside the links, one at a time, each save the overview as it stands by then.
    const unsaved = yield* Queue.unbounded<{ readonly id: string; readonly health?: boolean }>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const job = yield* Queue.take(unsaved);
          const entry = entries.get(job.id);
          if (job.health) {
            if (entry?.health != null && store.saveHealth !== undefined)
              yield* store.saveHealth(job.id, entry.health);
          } else if (entry?.overview != null) yield* store.save(job.id, entry.overview);
        }),
      ),
    );
    let links = 0;
    const now = Effect.map(Clock.currentTimeMillis, (ms) =>
      DateTime.formatIso(DateTime.makeUnsafe(ms)),
    );
    const presenceOf = (entry: Entry): MatePresence => {
      const online = entry.links.length > 0;
      return {
        online,
        since: entry.since,
        overview: online
          ? entry.fullOn !== null && entry.fullOn === heardOf(entry)
            ? "live"
            : "none"
          : entry.overview === null
            ? "none"
            : "stored",
      };
    };
    const update = (projectId: string, change: (entry: Entry) => Entry) =>
      Effect.gen(function* () {
        const entry = entries.get(projectId) ?? {
          links: [],
          since: yield* now,
          overview: null,
          fullOn: null,
          attention: null,
          attentionOn: null,
          health: null,
          healthOn: null,
          runs: new Map(),
        };
        entries.set(projectId, change(entry));
        yield* PubSub.publish(changed, projectId);
      });

    return MateOverviews.of({
      connect: (projectId) =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            links += 1;
            const link = links;
            const at = yield* now;
            yield* update(projectId, (entry) => ({
              ...entry,
              links: [...entry.links, link],
              since: entry.links.length === 0 ? at : entry.since,
            }));
            return link;
          }),
          (link) =>
            Effect.gen(function* () {
              const at = yield* now;
              yield* update(projectId, (entry) => {
                const links = entry.links.filter((open) => open !== link);
                const runs = new Map(entry.runs);
                runs.delete(link);
                return { ...entry, links, runs, since: links.length === 0 ? at : entry.since };
              });
              // Its last link gone: offline from now, as it stands now.
              if (entries.get(projectId)?.links.length === 0) {
                yield* Queue.offer(unsaved, { id: projectId });
              }
            }),
        ),
      report: (projectId, link, frame) =>
        Effect.gen(function* () {
          const entry = entries.get(projectId);
          if (entry === undefined || link !== heardOf(entry)) return;
          const overview = frame.full
            ? frame.overview
            : entry.fullOn === link && entry.overview !== null
              ? { ...entry.overview, ...frame.sections }
              : undefined;
          if (overview === undefined) return;
          yield* update(projectId, () => ({ ...entry, overview, fullOn: link }));
          if (frame.full || retainedStateOf(entry.overview) !== retainedStateOf(overview)) {
            yield* Queue.offer(unsaved, { id: projectId });
          }
        }),
      reportHealth: (projectId, link, value) =>
        Effect.gen(function* () {
          const known = entries.get(projectId);
          if (known === undefined || !known.links.includes(link)) return;
          const named = known.runs.get(link);
          const source = value.source;
          if (
            named !== undefined &&
            (named.environmentId !== source.environmentId ||
              named.epoch !== source.epoch ||
              named.incarnation !== source.incarnation)
          )
            return;
          const entry =
            named === undefined ? { ...known, runs: new Map(known.runs).set(link, source) } : known;
          const before = entry.health;
          const live = link === heardOf(entry);
          const newer =
            before === null
              ? live
              : before.source.environmentId !== source.environmentId
                ? live
                : source.epoch > before.source.epoch ||
                  (source.epoch === before.source.epoch &&
                    source.incarnation === before.source.incarnation &&
                    source.revision > before.source.revision &&
                    live);
          if (
            !newer &&
            !(
              live &&
              before !== null &&
              sameRun(before, value) &&
              source.revision === before.source.revision
            )
          ) {
            if (entry !== known) yield* update(projectId, () => entry);
            return;
          }
          yield* update(projectId, () => ({
            ...entry,
            health: newer ? value : before,
            healthOn: link,
          }));
          if (newer) yield* Queue.offer(unsaved, { id: projectId, health: true });
        }),
      reportAttention: (projectId, link, value) =>
        Effect.gen(function* () {
          const known = entries.get(projectId);
          if (known === undefined || !known.links.includes(link)) return;
          const read = readAttention(value);
          if (Option.isNone(read)) return;
          const { environmentId, epoch, incarnation } = read.value.source;
          const named = known.runs.get(link);
          // The link is of the run it names, before anything else is weighed.
          const entry =
            named?.environmentId === environmentId &&
            named.epoch === epoch &&
            named.incarnation === incarnation
              ? known
              : {
                  ...known,
                  runs: new Map(known.runs).set(link, { environmentId, epoch, incarnation }),
                };
          /** Only the run the link named, where that is news: which link HQ hears may move. */
          const noted = entry === known ? Effect.void : update(projectId, () => entry);
          const prior = entry.attention;
          const live = link === heardOf(entry);
          const attention = acceptAttention(prior, read.value, live);
          if (attention === prior) {
            // Nothing newer: only the same run's word on the link HQ hears makes it live again.
            if (
              entry.attentionOn === link ||
              prior === null ||
              !live ||
              !sameRun(prior, read.value)
            )
              return yield* noted;
          } else if (entry.attentionOn === link && prior !== null && !sameRun(prior, read.value)) {
            // One link carries one run.
            return yield* noted;
          }
          yield* update(projectId, () => ({ ...entry, attention, attentionOn: link }));
        }),
      restore: Effect.gen(function* () {
        if (store.loadHealth !== undefined)
          for (const row of yield* store.loadHealth) {
            const entry = entries.get(row.projectId);
            if (entry?.health != null || (entry !== undefined && entry.links.length > 0)) continue;
            yield* update(row.projectId, (before) => ({
              ...before,
              health: row.health,
              healthOn: null,
              since: row.reportedAt,
            }));
          }
        for (const row of yield* store.load) {
          const entry = entries.get(row.projectId);
          if (entry !== undefined && (entry.links.length > 0 || entry.overview !== null)) continue;
          entries.set(row.projectId, {
            links: [],
            since: row.reportedAt,
            overview: row.overview,
            fullOn: null,
            attention: null,
            attentionOn: null,
            health: entry?.health ?? null,
            healthOn: null,
            runs: new Map(),
          });
          yield* PubSub.publish(changed, row.projectId);
        }
      }),
      forget: (projectIds) =>
        Effect.gen(function* () {
          if (store.forgetSeen !== undefined) yield* store.forgetSeen(projectIds);
          seenEpoch += 1;
          for (const projectId of projectIds) {
            entries.delete(projectId);
            yield* PubSub.publish(forgotten, projectId);
            yield* PubSub.publish(changed, projectId);
          }
        }),
      all: Effect.sync(
        () =>
          new Map(
            [...entries].map(([projectId, entry]) => [
              projectId,
              {
                health: entry.health,
                healthState:
                  entry.health === null
                    ? "none"
                    : entry.healthOn === heardOf(entry) && entry.links.length > 0
                      ? "live"
                      : "stored",
                presence: presenceOf(entry),
                overview: entry.overview,
                attention: entry.attention,
                attentionState:
                  entry.attention === null
                    ? "none"
                    : entry.attentionOn === heardOf(entry) && entry.links.length > 0
                      ? "live"
                      : "stored",
              },
            ]),
          ),
      ),
      changes: Stream.fromPubSub(changed),
      forgotten: Stream.fromPubSub(forgotten),
      seenEpoch: Effect.sync(() => seenEpoch),
    });
  });

const decodeOverview = Schema.decodeUnknownOption(MateOverview);
const decodeHealth = Schema.decodeUnknownOption(MateHealth);
const encodeHealth = Schema.encodeSync(Schema.fromJsonString(MateHealth));
const encodeOverview = Schema.encodeSync(Schema.fromJsonString(MateOverview));

/**
 * `hq_mate_overview`, written as the leader. A read or a write that fails is logged and lets the
 * Mates be: the next transition or link writes again.
 */
const postgresStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const leader = yield* Leader;
  const store: OverviewStore = {
    loadHealth: sql<{
      readonly project_id: string;
      readonly health: unknown;
      readonly at: string;
    }>`SELECT project_id, health, to_char(reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM hq_mate_health`.pipe(
      Effect.map((rows) =>
        rows.flatMap((row) =>
          Option.match(decodeHealth(row.health), {
            onNone: () => [],
            onSome: (health) => [{ projectId: row.project_id, health, reportedAt: row.at }],
          }),
        ),
      ),
      Effect.catch((error) => Effect.as(Effect.logWarning("health not read back", error), [])),
    ),
    saveHealth: (projectId, health) =>
      leader
        .write(
          sql`INSERT INTO hq_mate_health (project_id, health, reported_at) VALUES (${projectId}, ${encodeHealth(health)}::jsonb, now()) ON CONFLICT (project_id) DO UPDATE SET health = EXCLUDED.health, reported_at = EXCLUDED.reported_at`,
        )
        .pipe(
          Effect.asVoid,
          Effect.catch((error) => Effect.logWarning("health not kept", error)),
        ),
    forgetSeen: (projectIds) =>
      Effect.forEach(
        projectIds,
        (projectId) =>
          leader.write(sql`DELETE FROM hq_attention_seen WHERE project_id = ${projectId}`).pipe(
            Effect.asVoid,
            Effect.catch((error) => Effect.logWarning("seen results not forgotten", error)),
          ),
        { discard: true },
      ),
    load: sql<{ readonly project_id: string; readonly overview: unknown; readonly at: string }>`
      SELECT project_id, overview,
             to_char(reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
      FROM hq_mate_overview`.pipe(
      Effect.map((rows) =>
        rows.flatMap((row) =>
          Option.match(decodeOverview(row.overview), {
            // A row an older build wrote in a shape this one does not read waits for its Mate.
            onNone: () => [],
            onSome: (overview) => [{ projectId: row.project_id, overview, reportedAt: row.at }],
          }),
        ),
      ),
      Effect.catch((error) => Effect.as(Effect.logWarning("overviews not read back", error), [])),
    ),
    save: (projectId, overview) =>
      leader
        .write(
          sql`
            INSERT INTO hq_mate_overview (project_id, overview, reported_at)
            VALUES (${projectId}, ${encodeOverview(overview)}::jsonb, now())
            ON CONFLICT (project_id)
            DO UPDATE SET overview = EXCLUDED.overview, reported_at = EXCLUDED.reported_at`,
        )
        .pipe(
          Effect.asVoid,
          Effect.catch((error) => Effect.logWarning("overview not kept", error)),
        ),
  };
  return store;
});

/** The Mates' overviews over HQ's store, read back at every takeover. */
export const mateOverviewsLayer = Layer.effect(
  MateOverviews,
  Effect.gen(function* () {
    const leader = yield* Leader;
    const overviews = yield* makeMateOverviews(yield* postgresStore);
    yield* Effect.forkScoped(
      leader.changes.pipe(
        Stream.filter((status) => status.state === "active"),
        Stream.runForEach(() => overviews.restore),
      ),
    );
    return overviews;
  }),
);
