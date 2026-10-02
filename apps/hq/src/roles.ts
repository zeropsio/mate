/**
 * The facts every permission is decided over, from Zerops at the moment of use: HQ reads its org's
 * members and projects with its own Read only credential and keeps that view for at most 30 s
 * (SPEC §4). `view` serves it up to that age as `Facts<"cached">`, `fresh` reads it now as
 * `Facts<"fresh">` — what every writing verb of `can` (`@t3tools/shared/zeropsPermissions`)
 * requires. The decisions themselves are `can`'s; nothing about people is stored in HQ.
 *
 * @module roles
 */
import type { Facts, Freshness } from "@t3tools/shared/zeropsPermissions";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
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

/** HQ's org as read, and how: read for this call (`fresh`) or up to 30 s old (`cached`). */
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
    /** The org's view read now, for a write. */
    readonly fresh: Effect.Effect<OrgView<"fresh">, ZeropsError>;
    /**
     * Whether Zerops still has a project, read by its id: a `not_found` refusal is gone, any other
     * failure no answer.
     */
    readonly exists: (projectId: string) => Effect.Effect<boolean, ZeropsError>;
  }
>()("@t3tools/hq/roles") {}

const VIEW_TTL = Duration.seconds(30);

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
      const cached = yield* Ref.make<{ readonly view: OrgRead; readonly at: number } | undefined>(
        undefined,
      );
      const permit = yield* Semaphore.make(1);
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
       * A view read no earlier than `since`. One read at a time: whoever waited for it takes the
       * one that just finished, if it started late enough. A failure is never kept.
       */
      const readSince = (since: number) =>
        Semaphore.withPermits(
          permit,
          1,
        )(
          Effect.gen(function* () {
            const hit = yield* Ref.get(cached);
            if (hit !== undefined && hit.at >= since) return hit.view;
            const at = yield* Clock.currentTimeMillis;
            const view = yield* read;
            yield* Ref.set(cached, { view, at });
            return view;
          }),
        );
      const fresh = Effect.flatMap(Clock.currentTimeMillis, readSince).pipe(
        Effect.map((read): OrgView<"fresh"> => ({ ...read, freshness: "fresh" })),
      );
      const view = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        readSince(now - Duration.toMillis(options.viewTtl ?? VIEW_TTL) + 1),
      ).pipe(Effect.map((read): OrgView<"cached"> => ({ ...read, freshness: "cached" })));
      return Roles.of({ view, fresh, exists });
    }),
  );
