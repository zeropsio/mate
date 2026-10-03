/**
 * The facts every permission is decided over, from Zerops at the moment of use: HQ reads its org's
 * members and projects with its own Read only credential and keeps that view for at most 30 s
 * (SPEC §4). `view` serves it up to that age as `Facts<"cached">`. A write is decided over
 * `forWrite`, inside `confirmingRefusal`: first over the view at most 30 s old (`recent`), and
 * where the facts refuse it once more over a fresh read, whose refusal stands; its waits on Zerops
 * end within 35 s (F22, 2026-10-03: a release waited on a fresh read while KRLS's org-wide reads
 * stalled 25 s, and went with its client at 20 s). The decisions themselves are `can`'s
 * (`@t3tools/shared/zeropsPermissions`); nothing about people is stored in HQ.
 *
 * While Zerops does not answer, `view` serves the last good view for five minutes from its read,
 * at once, and asks Zerops again behind it at most every 30 s: a read verb is decided over it, a
 * write never (E2E 2026-10-03: KRLS's member list missing HQ's 10 s answered every read of a new
 * application `503` for a minute). Past the five minutes a read fails as a write does.
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
import {
  type Facts,
  type Freshness,
  REASONS,
  type WriteFreshness,
} from "@t3tools/shared/zeropsPermissions";
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

import {
  ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsProject,
  ZeropsRefused,
  ZeropsUnavailable,
} from "./zerops/api.ts";

/**
 * HQ's org as read, and how: read for this call (`fresh`), Zerops' answer at most 30 s old
 * (`recent`), or served from what HQ holds (`cached`).
 */
export interface OrgView<F extends Freshness = Freshness> extends Facts<F> {
  readonly orgId: string;
  readonly members: ReadonlyArray<ZeropsMember>;
  readonly projects: ReadonlyArray<ZeropsProject>;
}

type OrgRead = Omit<OrgView, "freshness">;

export class Roles extends Context.Service<
  Roles,
  {
    /** The org's view, at most 30 s old. */
    readonly view: Effect.Effect<OrgView<"cached">, ZeropsError>;
    /**
     * The org's view a write is decided over: at most 30 s old, or read now where the write is
     * being confirmed (`confirmingRefusal`); never the last good one served. Its wait ends with
     * the write's budget, past which it is `ZeropsUnavailable`; the read it left goes on.
     */
    readonly forWrite: Effect.Effect<OrgView<WriteFreshness>, ZeropsError>;
    /** The org's view at most 30 s old, read now past that — never the last good one served. */
    readonly recent: Effect.Effect<OrgView<"cached">, ZeropsError>;
    /**
     * Whether Zerops still has a project, read by its id: a `not_found` refusal is gone, any other
     * failure no answer.
     */
    readonly exists: (projectId: string) => Effect.Effect<boolean, ZeropsError>;
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
 * A write decided over the org: first over the view at most 30 s old (`Roles.forWrite`), and where
 * its facts refuse it, once more over a fresh read, whose refusal stands — an allow needs no fresh
 * read, a refusal is confirmed by one (F22). Both passes' waits on Zerops end within
 * `WRITE_BUDGET` of the write's start. Its refusal comes before anything is written: the second
 * pass runs the write again whole.
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

/** How long after its read the last good view is served while Zerops does not answer. */
const VIEW_GRACE = Duration.minutes(5);

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
      const cached = yield* Ref.make<
        { readonly view: OrgRead; readonly at: number; readonly answered: number } | undefined
      >(undefined);
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
          const hit = yield* Ref.get(cached);
          if (hit !== undefined && fits(hit)) return hit.view;
          const failure = yield* Ref.get(failed);
          if (failure !== undefined && failure.at >= asked) return yield* failure.error;
          const at = yield* Clock.currentTimeMillis;
          const view = yield* read.pipe(
            Effect.tapError((error) =>
              error._tag === "ZeropsUnavailable"
                ? Effect.flatMap(Clock.currentTimeMillis, (end) =>
                    Ref.set(failed, { at: end, error }),
                  )
                : Effect.void,
            ),
          );
          yield* Ref.set(cached, { view, at, answered: yield* Clock.currentTimeMillis });
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
      const forWrite = Effect.gen(function* () {
        const { fresh, until } = yield* WriteConfirm;
        const now = yield* Clock.currentTimeMillis;
        const ends = until ?? now + Duration.toMillis(WRITE_BUDGET);
        // In the layer's scope: a write that gave up on its read leaves it to land for the next.
        const reading = yield* Effect.forkIn(fresh ? freshAt(now) : recentAt(now), scope);
        const read = yield* Fiber.join(reading).pipe(
          Effect.timeoutOrElse({
            duration: Duration.millis(Math.max(0, ends - now)),
            orElse: () =>
              Effect.fail(
                new ZeropsUnavailable({
                  operation: "write",
                  message: "Zerops did not answer within the write's budget.",
                }),
              ),
          }),
        );
        return { ...read, freshness: fresh ? "fresh" : "recent" } as OrgView<WriteFreshness>;
      });
      const view = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const good = yield* Ref.get(cached);
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
        return yield* recentAt(now).pipe(
          Effect.catchIf(
            (error) => error._tag === "ZeropsUnavailable" && kept !== undefined,
            () => Effect.succeed(kept!),
          ),
        );
      }).pipe(Effect.map((read): OrgView<"cached"> => ({ ...read, freshness: "cached" })));
      return Roles.of({ view, forWrite, recent, exists });
    }),
  );
