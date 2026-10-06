/**
 * The Mates' overviews as their links bring them (SPEC §3.4, `@t3tools/shared/mateLink`): each by
 * its project, in this Core's memory.
 *
 * - A link's first frame is the whole overview; each frame after it replaces the sections it names.
 *   Frames are taken from a Mate's newest link alone: a restarted server's old link, which HQ has
 *   not heard go yet, is passed by.
 * - A Mate is online while one of its links is open.
 * - The store keeps a Mate's overview as it stands when a whole one arrives and when one of its
 *   chats changes kind — a state moving, never a live step — so a Mate that sleeps keeps its last
 *   state for whoever reads it after a restart.
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
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Leader } from "./leader.ts";

/** A frame of a Mate's overview, as its link brings it. */
const readAttention = Schema.decodeUnknownOption(HqAttentionValue);

/** Whether two attention values are of one run of one Mate. */
const sameRun = (left: HqAttentionValue, right: HqAttentionValue) =>
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

interface Entry {
  readonly attentionOn: number | null;
  readonly attention: HqAttentionValue | null;
  /** Its open links, oldest first: the newest is the one HQ hears. */
  readonly links: ReadonlyArray<number>;
  /** When it last went online or offline: ISO. */
  readonly since: string;
  readonly overview: MateOverview | null;
  /** The link whose whole overview HQ holds; sections are taken from it alone. */
  readonly fullOn: number | null;
}

const newestOf = (entry: Entry) => entry.links.at(-1);

/** Each listed chat's kind: what moving says a state moved. */
const kindsOf = (overview: MateOverview | null) =>
  overview?.threads.list.map((thread) => `${thread.id}:${thread.kind}`).join(" ") ?? "";

export const makeMateOverviews = (
  store: OverviewStore,
): Effect.Effect<MateOverviews["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const entries = new Map<string, Entry>();
    let seenEpoch = 0;
    const changed = yield* PubSub.unbounded<string>();
    const forgotten = yield* PubSub.unbounded<string>();
    // Beside the links, one at a time, each save the overview as it stands by then.
    const unsaved = yield* Queue.unbounded<string>();
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.gen(function* () {
          const projectId = yield* Queue.take(unsaved);
          const overview = entries.get(projectId)?.overview ?? null;
          if (overview !== null) yield* store.save(projectId, overview);
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
          ? entry.fullOn !== null && entry.fullOn === newestOf(entry)
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
                return { ...entry, links, since: links.length === 0 ? at : entry.since };
              });
              // Its last link gone: offline from now, as it stands now.
              if (entries.get(projectId)?.links.length === 0) {
                yield* Queue.offer(unsaved, projectId);
              }
            }),
        ),
      report: (projectId, link, frame) =>
        Effect.gen(function* () {
          const entry = entries.get(projectId);
          if (entry === undefined || link !== newestOf(entry)) return;
          const overview = frame.full
            ? frame.overview
            : entry.fullOn === link && entry.overview !== null
              ? { ...entry.overview, ...frame.sections }
              : undefined;
          if (overview === undefined) return;
          yield* update(projectId, () => ({ ...entry, overview, fullOn: link }));
          if (frame.full || kindsOf(entry.overview) !== kindsOf(overview)) {
            yield* Queue.offer(unsaved, projectId);
          }
        }),
      reportAttention: (projectId, link, value) =>
        Effect.gen(function* () {
          const entry = entries.get(projectId);
          if (entry === undefined || link !== newestOf(entry)) return;
          const read = readAttention(value);
          if (Option.isNone(read)) return;
          const prior = entry.attention;
          const attention = acceptAttention(prior, read.value);
          if (attention === prior) {
            // Nothing newer: only the same run's word on a new link makes what is held live again.
            if (entry.attentionOn === link || prior === null || !sameRun(prior, read.value)) return;
          } else if (entry.attentionOn === link && prior !== null && !sameRun(prior, read.value)) {
            // One link carries one run.
            return;
          }
          yield* update(projectId, () => ({ ...entry, attention, attentionOn: link }));
        }),
      restore: Effect.gen(function* () {
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
                presence: presenceOf(entry),
                overview: entry.overview,
                attention: entry.attention,
                attentionState:
                  entry.attention === null
                    ? "none"
                    : entry.attentionOn === newestOf(entry) && entry.links.length > 0
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
const encodeOverview = Schema.encodeSync(Schema.fromJsonString(MateOverview));

/**
 * `hq_mate_overview`, written as the leader. A read or a write that fails is logged and lets the
 * Mates be: the next transition or link writes again.
 */
const postgresStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const leader = yield* Leader;
  const store: OverviewStore = {
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
