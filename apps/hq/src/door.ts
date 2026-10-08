/**
 * HQ's door for a person: the rules of `@t3tools/shared/zeropsDoor`, over facts read here. The
 * presented throwaway reads only itself — `/user/info` and its own token record, with the API's
 * `Date` header — and is judged on that first (`checkDoorTokenShape`), so a token that cannot pass
 * spends nothing of HQ's own credential, and then on the person it names, twenty a minute
 * (`rateLimit.ts`). Only then does HQ check its org and members, as read at
 * most 30 s ago (`roles.ts`'s `recent`): a reload's door after another waits on Zerops only once,
 * and one whose read fails is unavailable — never admitted by an older view. HQ deletes nothing:
 * the client deletes its throwaway; the token's id goes with the caller so that it opens one
 * session only (`sessions.ts`).
 *
 * A door answers within {@link DOOR_BUDGET}: one whose reads of Zerops take longer is unavailable
 * (`503` with `Retry-After`), inside the 45 s the client waits for it, so the client asks again
 * rather than abandoning it mid-way. The org read it gave up on goes on, and lands for the door
 * asked again.
 *
 * @module door
 */
import { type DoorVerdict, checkDoorToken, checkDoorTokenShape } from "@t3tools/shared/zeropsDoor";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { DoorRateLimit, PERSON_LIMIT, TooManyRequests } from "./rateLimit.ts";
import { Roles } from "./roles.ts";
import type { Principal } from "./sessions.ts";
import { ZeropsApi, ZeropsUnavailable } from "./zerops/api.ts";

/** The presented credential is no throwaway for this HQ; `rule` is for the log only. */
export class DoorRefused extends Schema.TaggedError<DoorRefused>()("DoorRefused", {
  rule: Schema.String,
}) {}

export class Door extends Context.Service<
  Door,
  {
    readonly admit: (
      presented: Redacted.Redacted,
    ) => Effect.Effect<
      Principal & { readonly doorTokenId: string },
      DoorRefused | ZeropsUnavailable | TooManyRequests
    >;
  }
>()("@t3tools/hq/door") {}

const failWith = (verdict: Exclude<DoorVerdict, { readonly kind: "admitted" }>) =>
  verdict.kind === "refused"
    ? new DoorRefused({ rule: verdict.rule })
    : new ZeropsUnavailable({ operation: "door", message: verdict.reason });

/** How long a door may take: under the 45 s the client waits for it, with room for its answer. */
export const DOOR_BUDGET = Duration.seconds(35);

export const doorLayer = (options: {
  readonly hqProjectId: string;
}): Layer.Layer<Door, never, ZeropsApi | Roles | DoorRateLimit> =>
  Layer.effect(
    Door,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      const roles = yield* Roles;
      const limits = yield* DoorRateLimit;
      const scope = yield* Effect.scope;
      return Door.of({
        admit: (presented) =>
          Effect.gen(function* () {
            const token = yield* api.ownToken(presented).pipe(
              Effect.catchTags({
                ZeropsRefused: (refusal) =>
                  Effect.fail(
                    new DoorRefused({
                      rule: refusal.reason === "unauthorized" ? "token_dead" : "wrong_org",
                    }),
                  ),
              }),
            );
            const facts = {
              doorProjectId: options.hqProjectId,
              token: { ...token, projectGrants: token.projects.length },
              apiNowMs: token.readAtMs,
            };
            const shape = checkDoorTokenShape(facts);
            if (shape !== undefined) return yield* failWith(shape);
            // The person the throwaway names, before HQ reads its org for them: one person's flood
            // stops at them, never at their colleagues behind the same address (`rateLimit.ts`).
            if (!(yield* limits.take(`person ${token.createdByUser ?? "none"}`, PERSON_LIMIT))) {
              return yield* new TooManyRequests();
            }
            // HQ's own reads failing is HQ's trouble, never the caller's verdict. The read outlives
            // a door that gives up on it: what it reads is the next door's.
            const reading = yield* Effect.forkIn(roles.recent, scope);
            const view = yield* Fiber.join(reading).pipe(
              Effect.catchTags({
                ZeropsRefused: () =>
                  Effect.fail(
                    new ZeropsUnavailable({ operation: "door", message: "own credential" }),
                  ),
              }),
            );
            const verdict = checkDoorToken({ ...facts, orgId: view.orgId, members: view.members });
            if (verdict.kind !== "admitted") return yield* failWith(verdict);
            return { userId: verdict.userId, orgId: view.orgId, doorTokenId: token.id };
          }).pipe(
            Effect.timeoutOrElse({
              duration: DOOR_BUDGET,
              orElse: () =>
                Effect.fail(
                  new ZeropsUnavailable({
                    operation: "door",
                    message: "Zerops did not answer within the door's budget.",
                  }),
                ),
            }),
          ),
      });
    }),
  );
