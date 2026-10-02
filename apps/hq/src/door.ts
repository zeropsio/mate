/**
 * HQ's door for a person: the rules of `@t3tools/shared/zeropsDoor`, over facts read here. The
 * presented throwaway reads only itself — `/user/info` and its own token record, with the API's
 * `Date` header — and is judged on that first (`checkDoorTokenShape`), so a token that cannot pass
 * spends nothing of HQ's own credential. Only then does HQ read its org and members, fresh
 * (`roles.ts`), for the whole check. HQ deletes nothing: the client deletes its throwaway; the
 * token's id goes with the caller so that it opens one session only (`sessions.ts`).
 *
 * @module door
 */
import { type DoorVerdict, checkDoorToken, checkDoorTokenShape } from "@t3tools/shared/zeropsDoor";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

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
      DoorRefused | ZeropsUnavailable
    >;
  }
>()("@t3tools/hq/door") {}

const failWith = (verdict: Exclude<DoorVerdict, { readonly kind: "admitted" }>) =>
  verdict.kind === "refused"
    ? new DoorRefused({ rule: verdict.rule })
    : new ZeropsUnavailable({ operation: "door", message: verdict.reason });

export const doorLayer = (options: {
  readonly hqProjectId: string;
}): Layer.Layer<Door, never, ZeropsApi | Roles> =>
  Layer.effect(
    Door,
    Effect.gen(function* () {
      const api = yield* ZeropsApi;
      const roles = yield* Roles;
      return Door.of({
        admit: (presented) =>
          Effect.gen(function* () {
            const token = yield* api.ownToken(presented).pipe(
              Effect.catchTag("ZeropsRefused", (refusal) =>
                Effect.fail(
                  new DoorRefused({
                    rule: refusal.reason === "unauthorized" ? "token_dead" : "wrong_org",
                  }),
                ),
              ),
            );
            const facts = {
              doorProjectId: options.hqProjectId,
              token: { ...token, projectGrants: token.projects.length },
              apiNowMs: token.readAtMs,
            };
            const shape = checkDoorTokenShape(facts);
            if (shape !== undefined) return yield* failWith(shape);
            // HQ's own reads failing is HQ's trouble, never the caller's verdict.
            const view = yield* roles.fresh.pipe(
              Effect.catchTag("ZeropsRefused", () =>
                Effect.fail(
                  new ZeropsUnavailable({ operation: "door", message: "own credential" }),
                ),
              ),
            );
            const verdict = checkDoorToken({ ...facts, orgId: view.orgId, members: view.members });
            if (verdict.kind !== "admitted") return yield* failWith(verdict);
            return { userId: verdict.userId, orgId: view.orgId, doorTokenId: token.id };
          }),
      });
    }),
  );
