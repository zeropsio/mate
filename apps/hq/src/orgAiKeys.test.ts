import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { mateLinked } from "../test/harness/automated.ts";
import { addProject, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/** A fake Nebius key, built from parts so no scanner takes it for one. */
const KEY = ["v1", "fake", "nebius", "key", "0123456789"].join(".");
const OTHER_KEY = ["v1", "fake", "nebius", "key", "9876543210"].join(".");

describe("the organization's API keys", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "the organization's owner keeps its API key sealed; HQ says it is set and when, never what",
      () =>
        Effect.gen(function* () {
          const { call, url } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const before = yield* call("GET", "/api/org/ai-keys", { session: owner });
          assert.deepStrictEqual(before.body, [{ provider: "nebius", set: false, setAt: null }]);
          const kept = yield* call("PUT", "/api/org/ai-keys/nebius", {
            session: owner,
            body: { value: KEY },
          });
          assert.strictEqual(kept.status, 200);
          const view = kept.body as { provider: string; set: boolean; setAt: string | null };
          assert.deepInclude(view, { provider: "nebius", set: true });
          assert.match(view.setAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
          const listed = yield* call("GET", "/api/org/ai-keys", { session: owner });
          assert.deepStrictEqual(listed.body, [view]);
          for (const answer of [kept, listed])
            assert.notInclude(new TextDecoder().decode(answer.bytes), KEY);
          const [row] = yield* rowsWhere(
            url,
            "SELECT encode(sealed, 'escape') AS sealed, set_by FROM hq_org_ai_key",
            (rows) => rows.length === 1,
          );
          assert.notInclude(String(row!["sealed"]), KEY);
          assert.strictEqual(row!["set_by"], "owner");
          const forgotten = yield* call("DELETE", "/api/org/ai-keys/nebius", { session: owner });
          assert.strictEqual(forgotten.status, 204);
          assert.deepStrictEqual(
            (yield* call("GET", "/api/org/ai-keys", { session: owner })).body,
            [{ provider: "nebius", set: false, setAt: null }],
          );
        }),
    );

    it.effect("only an owner or admin of the organization keeps or forgets its API key", () =>
      Effect.gen(function* () {
        const { call } = yield* startCore(true);
        yield* untilHealth(call, "active");
        for (const door of ["door-dev", "door-reader"]) {
          const session = yield* sessionFor(call, door);
          for (const method of ["PUT", "DELETE"]) {
            const refused = yield* call(method, "/api/org/ai-keys/nebius", {
              session,
              ...(method === "PUT" ? { body: { value: KEY } } : {}),
            });
            assert.deepStrictEqual(
              [refused.status, refused.body],
              [403, { code: "forbidden", reason: "not_structure_writer" }],
            );
          }
        }
        const owner = yield* sessionFor(call, "door-owner");
        const unknown = yield* call("PUT", "/api/org/ai-keys/elsewhere", {
          session: owner,
          body: { value: KEY },
        });
        assert.deepStrictEqual(
          [unknown.status, unknown.body],
          [404, { code: "not_found", reason: "unknown_provider" }],
        );
      }),
    );

    it.effect("any Mate of the organization asks HQ for its key; none kept answers no_key", () =>
      Effect.gen(function* () {
        const core = yield* startCore(true);
        yield* untilHealth(core.call, "active");
        const owner = yield* sessionFor(core.call, "door-owner");
        const { auth } = yield* mateLinked(core, owner, "P_MATE", { automated: false });
        const none = yield* core.call("POST", "/api/mate/ai-key", { headers: auth });
        assert.deepStrictEqual(
          [none.status, none.body],
          [404, { code: "no_key", reason: "no_key" }],
        );
        yield* core.call("PUT", "/api/org/ai-keys/nebius", {
          session: owner,
          body: { value: KEY },
        });
        const handed = yield* core.call("POST", "/api/mate/ai-key", { headers: auth });
        assert.deepStrictEqual(
          [handed.status, handed.body],
          [
            200,
            {
              provider: "nebius",
              env: "NEBIUS_API_KEY",
              value: KEY,
              baseUrl: "https://api.tokenfactory.nebius.com/v1",
            },
          ],
        );
        assert.strictEqual(handed.headers.get("cache-control"), "no-store");
        const stranger = yield* core.call("POST", "/api/mate/ai-key", {
          headers: { authorization: "Mate not-a-credential" },
        });
        assert.strictEqual(stranger.status, 401);
      }),
    );

    it.effect(
      "an automated Mate's link brings the organization's keys at once and on each change; an ordinary Mate's never",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true);
          yield* untilHealth(core.call, "active");
          const owner = yield* sessionFor(core.call, "door-owner");
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: owner,
            body: { value: KEY },
          });
          addProject(core.fake, "P_ROBOT");
          const ordinary = yield* mateLinked(core, owner, "P_MATE", { automated: false });
          const robot = yield* mateLinked(core, owner, "P_ROBOT");
          const keysOf = (value: string | undefined) => (frame: { readonly type: string }) =>
            frame.type === "provider-keys" &&
            JSON.stringify((frame as unknown as { keys: unknown }).keys) ===
              JSON.stringify(value === undefined ? [] : [{ env: "NEBIUS_API_KEY", value }]);
          yield* robot.link.takeWhere("the key at once", keysOf(KEY));
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: owner,
            body: { value: OTHER_KEY },
          });
          yield* robot.link.takeWhere("the changed key", keysOf(OTHER_KEY));
          yield* core.call("DELETE", "/api/org/ai-keys/nebius", { session: owner });
          yield* robot.link.takeWhere("no key", keysOf(undefined));
          // The ordinary Mate's link carried on meanwhile, with none of it.
          yield* core.call("POST", "/api/mates/P_MATE/closed-off", { session: owner });
          yield* ordinary.link.takeWhere(
            "its closed-off state",
            (frame) =>
              frame.type === "state" &&
              (frame["mate"] as { readonly closedOff?: boolean }).closedOff === true,
          );
          assert.isFalse(
            (yield* ordinary.link.collected).some((frame) => frame.type === "provider-keys"),
          );
        }),
    );

    it.effect(
      "an automated Mate's link that cannot read the organization's keys as it opens brings them once HQ can",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true);
          yield* untilHealth(core.call, "active");
          const owner = yield* sessionFor(core.call, "door-owner");
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: owner,
            body: { value: KEY },
          });
          addProject(core.fake, "P_ROBOT");
          // The keys' table out of reach while the link opens: its first read fails.
          yield* core.sql`ALTER TABLE hq_org_ai_key RENAME TO hq_org_ai_key_away`;
          const robot = yield* mateLinked(core, owner, "P_ROBOT");
          yield* robot.link.pinged(1);
          yield* core.sql`ALTER TABLE hq_org_ai_key_away RENAME TO hq_org_ai_key`;
          yield* robot.link.takeWhere(
            "the key once HQ reads it",
            (frame) =>
              frame.type === "provider-keys" &&
              JSON.stringify((frame as unknown as { keys: unknown }).keys) ===
                JSON.stringify([{ env: "NEBIUS_API_KEY", value: KEY }]),
          );
        }),
    );

    it.effect(
      "a Mate HQ names automated only after its link opened gets the organization's keys on that link",
      () =>
        Effect.gen(function* () {
          const core = yield* startCore(true);
          yield* untilHealth(core.call, "active");
          const owner = yield* sessionFor(core.call, "door-owner");
          yield* core.call("PUT", "/api/org/ai-keys/nebius", {
            session: owner,
            body: { value: KEY },
          });
          addProject(core.fake, "P_ROBOT");
          const robot = yield* mateLinked(core, owner, "P_ROBOT", { automated: false });
          // Its record says automated once its state moves, as a birth's attach lands it.
          yield* core.sql`UPDATE hq_mate SET automated = true WHERE project_id = 'P_ROBOT'`;
          yield* core.call("POST", "/api/mates/P_ROBOT/closed-off", { session: owner });
          yield* robot.link.takeWhere(
            "its automated state",
            (frame) =>
              frame.type === "state" &&
              (frame["mate"] as { readonly automated?: boolean }).automated === true,
          );
          yield* robot.link.takeWhere(
            "the key on the same link",
            (frame) =>
              frame.type === "provider-keys" &&
              JSON.stringify((frame as unknown as { keys: unknown }).keys) ===
                JSON.stringify([{ env: "NEBIUS_API_KEY", value: KEY }]),
          );
        }),
    );
  });
});
