/**
 * The Mates' live summaries as their links bring them (SPEC §3.4, `@t3tools/shared/mateLink`): in
 * this Core's memory only — a Mate that reconnects, to this Core or the next, sends its summary
 * again. A Mate is online while one of its links is open; once none is, its last summary stays,
 * marked offline, until this Core stops.
 *
 * @module mateLive
 */
import type { MateSummary } from "@t3tools/shared/mateLink";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export interface MateLiveEntry {
  readonly online: boolean;
  /** When the summary was sent, or the Mate last went online or offline: ISO. */
  readonly at: string;
  readonly summary: MateSummary | null;
}

export class MateLive extends Context.Service<
  MateLive,
  {
    /** Registers an open link of the Mate for the scope's lifetime. */
    readonly connect: (projectId: string) => Effect.Effect<void, never, Scope.Scope>;
    readonly report: (projectId: string, summary: MateSummary) => Effect.Effect<void>;
    /** Every Mate HQ has heard from, by project. */
    readonly all: Effect.Effect<ReadonlyMap<string, MateLiveEntry>>;
    /** Ticks after every change, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/mateLive") {}

export const mateLiveLayer = Layer.effect(
  MateLive,
  Effect.gen(function* () {
    const entries = new Map<
      string,
      { readonly links: number; readonly at: string; readonly summary: MateSummary | null }
    >();
    const version = yield* SubscriptionRef.make(0);
    const now = Effect.map(Clock.currentTimeMillis, (ms) =>
      DateTime.formatIso(DateTime.makeUnsafe(ms)),
    );
    const update = (
      projectId: string,
      change: (entry: { readonly links: number; readonly summary: MateSummary | null }) => {
        readonly links: number;
        readonly summary: MateSummary | null;
      },
    ) =>
      Effect.gen(function* () {
        const at = yield* now;
        const entry = entries.get(projectId) ?? { links: 0, at, summary: null };
        entries.set(projectId, { ...change(entry), at });
        yield* SubscriptionRef.update(version, (tick) => tick + 1);
      });
    return MateLive.of({
      connect: (projectId) =>
        Effect.acquireRelease(
          update(projectId, (entry) => ({ ...entry, links: entry.links + 1 })),
          () => update(projectId, (entry) => ({ ...entry, links: Math.max(0, entry.links - 1) })),
        ),
      report: (projectId, summary) => update(projectId, (entry) => ({ ...entry, summary })),
      all: Effect.sync(
        () =>
          new Map(
            [...entries].map(([projectId, entry]) => [
              projectId,
              { online: entry.links > 0, at: entry.at, summary: entry.summary },
            ]),
          ),
      ),
      changes: SubscriptionRef.changes(version),
    });
  }),
);
