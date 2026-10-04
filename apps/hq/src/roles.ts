/**
 * The facts every permission is decided over, from Zerops at the moment of use: HQ reads its org's
 * members and projects with its own Read only credential and keeps that view for at most 30 s
 * (SPEC §4). `view` serves it up to that age as `Facts<"cached">`. A write is decided over
 * `forWrite`, inside `confirmingRefusal`: first over the view at most 30 s old (`recent`), and
 * where the facts refuse it once more over a fresh read, whose refusal stands; its waits on Zerops
 * end within 35 s (F22, 2026-10-03: a release waited on a fresh read while KRLS's org-wide reads
 * stalled 25 s, and went with its client at 20 s). The decisions themselves are `can`'s
 * (`permissions.ts`); nothing about people is stored in HQ.
 *
 * A write that cannot be taken back — a merge, a release, a deletion, a move out of an
 * application, a deploy — is decided inside `decidedFresh` instead: over a read begun after it was
 * asked, alone. Zerops leaving it unanswered within those 35 s refuses it before anything is
 * written (`ROLES_UNANSWERED`, the owner, 2026-10-05): an aged view never allows one. Every
 * write's unanswered roles are that refusal.
 *
 * While Zerops does not answer, `view` serves the last good view for five minutes from its read,
 * at once, and asks Zerops again behind it at most every 30 s (E2E 2026-10-03: KRLS's member list
 * missing HQ's 10 s answered every read of a new application `503` for a minute). A read that
 * Zerops leaves 3 s unanswered — counted from when the read under way began — takes it too, as
 * does a reversible write's first pass; a confirmation never (F22, option A, 2026-10-03: KRLS's
 * member list went unanswered for minutes at a time, and every release and read waited on it).
 * Past the five minutes a read fails as a write does.
 *
 * `recent` is the view at most 30 s old, read now past that, and never the last good one: what
 * HQ's door admits by, so a reload's door after another waits on Zerops only once (t11,
 * 2026-10-03: doors re-entered behind a fresh read of KRLS's slow member list hung 55 s and 77 s).
 *
 * A view's age counts from when Zerops answered it: a read slower than 30 s — one a door gave up
 * on at its budget — lands fresh enough for the door asked again. A write's fresh read is only one
 * begun after it was asked.
 *
 * @module roles
 */
import { REASONS } from "@t3tools/shared/zeropsPermissions";
import { type Facts, type Freshness, type WriteFreshness } from "./permissions.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsProject,
  ZeropsRefused,
  ZeropsUnavailable,
} from "./zerops/api.ts";

/**
 * HQ's org as read, and how: read for this call (`fresh`), Zerops' answer at most 30 s old or the
 * last good one a write took while Zerops did not answer (`recent`), or served from what HQ holds
 * (`cached`).
 */
export interface OrgView<F extends Freshness = Freshness> extends Facts<F> {
  readonly orgId: string;
  readonly members: ReadonlyArray<ZeropsMember>;
  readonly projects: ReadonlyArray<ZeropsProject>;
}

type OrgRead = Omit<OrgView, "freshness">;

/** A view as Zerops answered it, and when (wall ms). */
export interface OrgSeen {
  readonly view: OrgRead;
  readonly answered: number;
}

export class Roles extends Context.Service<
  Roles,
  {
    /** The org's view, at most 30 s old, or the last good one while Zerops does not answer. */
    readonly view: Effect.Effect<OrgView<"cached">, ZeropsError>;
    /**
     * The org's view a write is decided over: at most 30 s old — or the last good one once Zerops
     * leaves its read 3 s unanswered — or read now where the write is being confirmed
     * (`confirmingRefusal`). Its wait ends with the write's budget, past which it is
     * `ZeropsUnavailable`; the read it left goes on.
     */
    readonly forWrite: Effect.Effect<OrgView<WriteFreshness>, ZeropsError>;
    /** The org's view at most 30 s old, read now past that — never the last good one served. */
    readonly recent: Effect.Effect<OrgView<"cached">, ZeropsError>;
    /**
     * Whether Zerops still has a project, read by its id: a `not_found` refusal is gone, any other
     * failure no answer.
     */
    readonly exists: (projectId: string) => Effect.Effect<boolean, ZeropsError>;
    /**
     * Every view Zerops answers, as it lands, starting with the last good one: what HQ relays to
     * its Mates (`mateAccess.ts`). It reads nothing itself — the views are those its readers and
     * the official check (every minute) ask for.
     */
    readonly views: Stream.Stream<OrgSeen>;
  }
>()("@t3tools/hq/roles") {}

const VIEW_TTL = Duration.seconds(30);

/** How long a write waits on Zerops for its facts: under the client's 45 s, as the door. */
export const WRITE_BUDGET = Duration.seconds(35);

/**
 * The write running: whether it is being confirmed over a fresh read, and when its waits on
 * Zerops end, wall ms (`confirmingRefusal`). Outside one, a write's own read starts its budget.
 */
export const WriteConfirm = Context.Reference<{
  readonly fresh: boolean;
  readonly until: number | undefined;
}>("@t3tools/hq/roles/WriteConfirm", { defaultValue: () => ({ fresh: false, until: undefined }) });

const REASON_SET: ReadonlySet<string> = new Set(REASONS);

/** A refusal the org's facts decided: a permission's reason (`can`), or a Mate's refusal. */
const refusedByFacts = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("reason" in error && typeof error.reason === "string" && REASON_SET.has(error.reason)) ||
    ("_tag" in error && error._tag === "MateRefused"));

/**
 * A write decided over the org: first over the view at most 30 s old, or the last good one Zerops
 * left a read 3 s unanswered (`Roles.forWrite`), and where its facts refuse it, once more over a
 * fresh read, whose refusal stands — an allow needs no fresh read, a refusal is confirmed by one
 * (F22). Both passes' waits on Zerops end within `WRITE_BUDGET` of the write's start. Its refusal
 * comes before anything is written: the second pass runs the write again whole.
 */
export const confirmingRefusal = <A, E, R>(write: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(WRITE_BUDGET);
    return yield* write.pipe(
      Effect.provideService(WriteConfirm, { fresh: false, until }),
      Effect.catchIf(refusedByFacts, () =>
        write.pipe(Effect.provideService(WriteConfirm, { fresh: true, until })),
      ),
    );
  });

/**
 * The operation a write's `ZeropsUnavailable` names when Zerops did not answer its roles: nothing
 * was written, and HQ answers it `503 zerops_unanswered` (`api.ts`), never as a write that may have
 * landed.
 */
export const ROLES_UNANSWERED = "roles";

/**
 * A write that cannot be taken back — a merge, a release, a deletion, a move out of an
 * application, a deploy — decided over roles Zerops answers for it, read after it was asked: never
 * over a view kept from before (the owner, 2026-10-05). A slow answer within `WRITE_BUDGET` decides
 * it; none refuses it before anything is written ({@link ROLES_UNANSWERED}). The writes that can be
 * undone keep `confirmingRefusal`'s last good view.
 */
export const decidedFresh = <A, E, R>(write: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + Duration.toMillis(WRITE_BUDGET);
    return yield* write.pipe(Effect.provideService(WriteConfirm, { fresh: true, until }));
  });

/** How long after its read the last good view is served while Zerops does not answer. */
const VIEW_GRACE = Duration.minutes(5);

/**
 * How long a read, and a write's first pass, wait on Zerops for a view at most 30 s old before
 * they take the last good one.
 */
const RECENT_WAIT = Duration.seconds(3);

export const rolesLayer = (options: {
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  /** How old a view may be served; 30 s. */
  readonly viewTtl?: Duration.Duration;
}): Layer.Layer<Roles, never, ZeropsApi> =>
  Layer.effect(
    Roles,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      /** The last good view: when its read began (`at`), and when Zerops answered it. */
      const cached = yield* SubscriptionRef.make<
        { readonly view: OrgRead; readonly at: number; readonly answered: number } | undefined
      >(undefined);
      /** When the read under way began; none while no read is. */
      const underWay = yield* Ref.make<number | undefined>(undefined);
      /** The last read Zerops did not answer: when it ended, and why. */
      const failed = yield* Ref.make<
        { readonly at: number; readonly error: ZeropsUnavailable } | undefined
      >(undefined);
      const permit = yield* Semaphore.make(1);
      const scope = yield* Effect.scope;
      const ttl = Duration.toMillis(options.viewTtl ?? VIEW_TTL);
      const credential = Effect.fromOption(options.credential).pipe(
        Effect.mapError(
          () =>
            new ZeropsRefused({
              operation: "view",
              reason: "unauthorized",
              status: 0,
              code: "noCredential",
            }),
        ),
      );
      const exists = (projectId: string) =>
        Effect.flatMap(credential, (own) => api.project(projectId)(own)).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error._tag === "ZeropsRefused" && error.reason === "not_found",
            () => Effect.succeed(false),
          ),
        );
      const read = Effect.gen(function* () {
        const own = yield* credential;
        const { orgId } = yield* api.project(options.hqProjectId)(own);
        const [members, projects] = yield* Effect.all(
          [api.members(orgId)(own), api.projects(orgId)(own)],
          { concurrency: 2 },
        );
        // An org always has its owner: an empty list is an outage dressed as an answer.
        if (members.length === 0) {
          return yield* new ZeropsUnavailable({
            operation: "members",
            message: "empty member list",
          });
        }
        return { orgId, members, projects };
      });
      /**
       * A view the caller that asked at `asked` takes (`fits`), read if the last one does not fit.
       * Run one at a time: whoever waited for a read takes the one that just finished — its view if
       * it fits, its failure if it ended after they asked. A failure is never kept for a later ask.
       */
      const readUnderPermit = (
        fits: (hit: { readonly at: number; readonly answered: number }) => boolean,
        asked: number,
      ) =>
        Effect.gen(function* () {
          const hit = yield* SubscriptionRef.get(cached);
          if (hit !== undefined && fits(hit)) return hit.view;
          const failure = yield* Ref.get(failed);
          if (failure !== undefined && failure.at >= asked) return yield* failure.error;
          const at = yield* Clock.currentTimeMillis;
          yield* Ref.set(underWay, at);
          const view = yield* read.pipe(
            Effect.tapError((error) =>
              error._tag === "ZeropsUnavailable"
                ? Effect.flatMap(Clock.currentTimeMillis, (end) =>
                    Ref.set(failed, { at: end, error }),
                  )
                : Effect.void,
            ),
            Effect.ensuring(Ref.set(underWay, undefined)),
          );
          yield* SubscriptionRef.set(cached, {
            view,
            at,
            answered: yield* Clock.currentTimeMillis,
          });
          return view;
        });
      /** A read begun no earlier than `asked`: what a write is decided over. */
      const begunAfter = (asked: number) => (hit: { readonly at: number }) => hit.at >= asked;
      /** A view Zerops answered within the last 30 s. */
      const answeredWithin = (now: number) => (hit: { readonly answered: number }) =>
        hit.answered > now - ttl;
      const freshAt = (now: number) =>
        Semaphore.withPermits(permit, 1)(readUnderPermit(begunAfter(now), now));
      const recentAt = (now: number) =>
        Semaphore.withPermits(permit, 1)(readUnderPermit(answeredWithin(now), now));
      const recent = Effect.flatMap(Clock.currentTimeMillis, recentAt).pipe(
        Effect.map((read): OrgView<"cached"> => ({ ...read, freshness: "cached" })),
      );
      /** The last good view, while Zerops answered it within five minutes. */
      const lastGood = Effect.gen(function* () {
        const good = yield* SubscriptionRef.get(cached);
        const now = yield* Clock.currentTimeMillis;
        return good !== undefined && now - good.answered <= Duration.toMillis(VIEW_GRACE)
          ? good.view
          : undefined;
      });
      /**
       * What `reading` answers — or, once Zerops has left a read {@link RECENT_WAIT} unanswered
       * (counted from when the read under way began) or fails it, the last good view; with none,
       * what it answers still.
       */
      const keptAfterWait = (reading: Fiber.Fiber<OrgRead, ZeropsError>) =>
        Effect.gen(function* () {
          const orKept = (otherwise: Effect.Effect<OrgRead, ZeropsError>) =>
            Effect.flatMap(lastGood, (kept) =>
              kept === undefined ? otherwise : Effect.succeed(kept),
            );
          const now = yield* Clock.currentTimeMillis;
          const since = (yield* Ref.get(underWay)) ?? now;
          return yield* Fiber.join(reading).pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(
                Math.max(0, Duration.toMillis(RECENT_WAIT) - (now - since)),
              ),
              orElse: () => orKept(Fiber.join(reading)),
            }),
            Effect.catchIf(
              (error) => error._tag === "ZeropsUnavailable",
              (error) => orKept(Effect.fail(error)),
            ),
          );
        });
      const forWrite = Effect.gen(function* () {
        const { fresh, until } = yield* WriteConfirm;
        const now = yield* Clock.currentTimeMillis;
        const ends = until ?? now + Duration.toMillis(WRITE_BUDGET);
        // In the layer's scope: a write that gave up on its read leaves it to land for the next.
        const reading = yield* Effect.forkIn(fresh ? freshAt(now) : recentAt(now), scope);
        const read = yield* (fresh ? Fiber.join(reading) : keptAfterWait(reading)).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(Math.max(0, ends - now)),
            orElse: () =>
              Effect.fail(
                new ZeropsUnavailable({
                  operation: ROLES_UNANSWERED,
                  message: "Zerops did not answer within the write's budget.",
                }),
              ),
          }),
          // Whatever Zerops did not answer, the write is refused before it writes anything.
          Effect.mapError((error) =>
            error._tag === "ZeropsUnavailable"
              ? new ZeropsUnavailable({ operation: ROLES_UNANSWERED, message: error.message })
              : error,
          ),
        );
        return { ...read, freshness: fresh ? "fresh" : "recent" } as OrgView<WriteFreshness>;
      });
      const view = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const good = yield* SubscriptionRef.get(cached);
        if (good !== undefined && answeredWithin(now)(good)) return good.view;
        const kept =
          good !== undefined && now - good.answered <= Duration.toMillis(VIEW_GRACE)
            ? good.view
            : undefined;
        const failure = yield* Ref.get(failed);
        if (kept !== undefined && good !== undefined && failure !== undefined) {
          if (failure.at > good.answered) {
            // Zerops failed since that view: it is served at once, and Zerops asked again behind
            // it — unless a read is under way, or the last failed under 30 s ago.
            if (now - failure.at >= ttl) {
              yield* Effect.forkIn(
                Effect.ignore(
                  Semaphore.withPermitsIfAvailable(
                    permit,
                    1,
                  )(readUnderPermit(begunAfter(now), now)),
                ),
                scope,
              );
            }
            return kept;
          }
        }
        // In the layer's scope: a read that took the last good view leaves its own to land.
        return yield* keptAfterWait(yield* Effect.forkIn(recentAt(now), scope));
      }).pipe(Effect.map((read): OrgView<"cached"> => ({ ...read, freshness: "cached" })));
      const views = SubscriptionRef.changes(cached).pipe(
        Stream.filter((seen) => seen !== undefined),
        Stream.map((seen): OrgSeen => ({ view: seen.view, answered: seen.answered })),
      );
      return Roles.of({ view, forWrite, recent, exists, views });
    }),
  );
