import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { startCore, untilHealth, sessionFor } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

describe("HQ's organization auto-update switch", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("refuses a bearer issued for another organization before changing this org", () =>
      Effect.gen(function* () {
        const { call, sql } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        yield* sql`UPDATE hq_session SET org_id = 'OTHER'`;
        const result = yield* call("PUT", "/api/auto-update", {
          session,
          body: { enabled: false },
        });
        assert.strictEqual(result.status, 401);
        const owner = yield* sessionFor(call, "door-owner-2");
        assert.deepStrictEqual((yield* call("GET", "/api/auto-update", { session: owner })).body, {
          orgId: "ORG",
          enabled: true,
          revision: 0,
        });
      }),
    );
    it.effect("defaults on, holds every Mate, and lets an organization writer reopen updates", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const session = yield* sessionFor(call, "door-owner");
        assert.deepStrictEqual((yield* call("GET", "/api/auto-update", { session })).body, {
          orgId: "ORG",
          enabled: true,
          revision: 0,
        });
        for (const [enabled, revision] of [
          [false, 1],
          [true, 2],
          [false, 3],
        ] as const) {
          const result = yield* call("PUT", "/api/auto-update", { session, body: { enabled } });
          assert.strictEqual(result.status, 200);
          assert.deepStrictEqual(result.body, { orgId: "ORG", enabled, revision });
          assert.deepStrictEqual(
            (yield* call("GET", "/api/auto-update", { session })).body,
            result.body,
          );
        }
      }),
    );

    for (const door of [undefined, "door-dev", "door-reader"] as const) {
      it.effect(`refuses an organization-wide change from ${door ?? "no identity"}`, () =>
        Effect.gen(function* () {
          const { call } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const session = door === undefined ? undefined : yield* sessionFor(call, door);
          const result = yield* call("PUT", "/api/auto-update", {
            ...(session === undefined ? {} : { session }),
            body: { enabled: false },
          });
          assert.strictEqual(result.status, door === undefined ? 401 : 403);
          const owner = yield* sessionFor(call, "door-owner");
          assert.deepStrictEqual(
            (yield* call("GET", "/api/auto-update", { session: owner })).body,
            {
              orgId: "ORG",
              enabled: true,
              revision: 0,
            },
          );
        }),
      );
    }
  });
});
