import type { HqAutoUpdatePolicy } from "@t3tools/shared/mateAutoUpdatePolicy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { StructureRefused } from "./structure.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class AutoUpdatePolicy extends Context.Service<
  AutoUpdatePolicy,
  {
    readonly current: Effect.Effect<HqAutoUpdatePolicy, SqlError | ZeropsError>;
    /** Initial tick and a tick after each committed policy change. */
    readonly changes: Stream.Stream<number>;
    readonly read: (
      userId: string,
    ) => Effect.Effect<HqAutoUpdatePolicy, SqlError | ZeropsError | StructureRefused>;
    readonly set: (
      userId: string,
      enabled: boolean,
    ) => Effect.Effect<HqAutoUpdatePolicy, SqlError | ZeropsError | StructureRefused | NotLeader>;
  }
>()("@t3tools/hq/autoUpdate/AutoUpdatePolicy") {}

export const autoUpdatePolicyLayer = Layer.effect(
  AutoUpdatePolicy,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const roles = yield* Roles;
    const leader = yield* Leader;
    const ticks = yield* SubscriptionRef.make(0);
    const readOrg = Effect.fnUntraced(function* (orgId: string) {
      const rows = yield* sql<{ readonly enabled: boolean; readonly revision: number }>`
        SELECT enabled, revision FROM hq_auto_update_policy WHERE org_id = ${orgId}`;
      return { orgId, enabled: rows[0]?.enabled ?? true, revision: rows[0]?.revision ?? 0 };
    });
    // The org-wide switch uses the same authority as HQ's structure administration.
    const authorize = Effect.fnUntraced(function* (userId: string) {
      const view = yield* roles.forWrite;
      const decision = can({ kind: "person", userId }, "rename_app", null, view);
      if (!decision.allow) {
        return yield* new StructureRefused({ code: "forbidden", reason: decision.reason });
      }
      return view.orgId;
    });
    return AutoUpdatePolicy.of({
      current: Effect.flatMap(roles.view, (view) => readOrg(view.orgId)),
      changes: SubscriptionRef.changes(ticks),
      read: (userId) => confirmingRefusal(Effect.flatMap(authorize(userId), readOrg)),
      set: (userId, enabled) =>
        confirmingRefusal(
          Effect.gen(function* () {
            const orgId = yield* authorize(userId);
            const rows = yield* leader.write(sql<{
              readonly enabled: boolean;
              readonly revision: number;
            }>`
          INSERT INTO hq_auto_update_policy (org_id, enabled, revision, updated_by)
          VALUES (${orgId}, ${enabled}, 1, ${userId})
          ON CONFLICT (org_id) DO UPDATE
          SET enabled = EXCLUDED.enabled, revision = hq_auto_update_policy.revision + 1,
            updated_by = EXCLUDED.updated_by
          RETURNING enabled, revision`);
            yield* SubscriptionRef.update(ticks, (n) => n + 1);
            return { orgId, enabled: rows[0]!.enabled, revision: rows[0]!.revision };
          }),
        ),
    });
  }),
);
