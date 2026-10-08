// @effect-diagnostics nodeBuiltinImport:off -- the Mate's disposable usage.sqlite.
/** Native completed turns traverse the local outbox and Core's actual authenticated link. */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { type UsageLinkDown } from "@t3tools/shared/agentUsage";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as MateSqlite from "../../server/src/persistence/NodeSqliteClient.ts";
import { makeClaudeTurnUsage } from "../../server/src/spi/responseUsage.ts";
import {
  makeUsageOutbox,
  type CompletedUsage,
  type UsageBinding,
} from "../../server/src/usage/UsageOutbox.ts";
import { enrollMate, setUpMate, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const PROJECT = "P_MATE";
const temporary = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-e2e-"))),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);
const turn = (nativeTurnId: string, amount: string): CompletedUsage => ({
  provider: "claude",
  at: DateTime.formatIso(DateTime.nowUnsafe()),
  nativeThreadId: "native-session",
  nativeTurnId,
  parentId: null,
  nativeCost: null,
  models: [
    {
      model: "claude-sonnet-4-6",
      nativeCost: null,
      components: {
        uncachedInput: amount,
        cachedInput: "0",
        cacheCreation: "0",
        output: "0",
        reasoning: null,
        inclusiveTotal: amount,
      },
    },
  ],
});
const world = Effect.gen(function* () {
  const core = yield* startCore(true);
  yield* untilHealth(core.call, "active");
  yield* setUpMate(core.call, PROJECT);
  const credential = yield* enrollMate(core.call, core.fake, PROJECT);
  const home = yield* temporary;
  const database = NodePath.join(home, "usage.sqlite");
  const link = Effect.gen(function* () {
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { readonly ticket: string };
    const socket = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    const state = yield* socket.takeWhere(
      "a state offering capture",
      (message) => message.type === "state" && message["usage"] !== undefined,
    );
    const usage = state["usage"] as { mateId: string; orgId: string };
    const binding: UsageBinding = { orgId: usage.orgId, projectId: PROJECT, mateId: usage.mateId };
    return { socket, binding };
  });
  const outbox = Effect.flatMap(Layer.build(MateSqlite.layer({ filename: database })), (context) =>
    makeUsageOutbox.pipe(Effect.provide(context)),
  );
  const recorded = core.sql<{ records: string; tokens: string; cost: string }>`SELECT
    coalesce(sum((statistics->>'records')::numeric),0)::text AS records,
    coalesce(sum((statistics->>'tokens')::numeric),0)::text AS tokens,
    (SELECT coalesce(sum(amount::numeric),0)::text FROM hq_usage_daily CROSS JOIN LATERAL jsonb_each_text(native_cost) AS costs(currency,amount)) AS cost FROM hq_usage_daily`;
  return { core, link, outbox, recorded };
});

describe("a Mate's usage reaching HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("refused Claude admissions add no records, tokens or cost to the Usage report", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { link, outbox, recorded } = yield* world;
          const first = yield* link;
          const mate = yield* outbox;
          yield* mate.bind(first.binding);
          const read = makeClaudeTurnUsage({ session: { model_usage: {}, total_cost_usd: 0 } });
          assert.deepStrictEqual(
            read({
              type: "result",
              session_id: "refused-session",
              uuid: "refused",
              modelUsage: {},
              total_cost_usd: 0,
            }),
            [],
          );
          assert.isUndefined(yield* mate.batch);
          assert.deepStrictEqual((yield* recorded)[0], { records: "0", tokens: "0", cost: "0" });
        }),
      ),
    );
    it.effect(
      "native turns reach HQ exactly once after acknowledgement loss and an outbox restart",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { link, outbox, recorded } = yield* world;
            const first = yield* link;
            const mate = yield* outbox;
            yield* mate.bind(first.binding);
            yield* mate.record(turn("one", "100"));
            yield* mate.record(turn("two", "20"));
            const frame = (yield* mate.batch)!;
            yield* first.socket.send(frame);
            yield* first.socket.takeWhere(
              "committed usage",
              (message) => message.type === "usage-ack",
            );
            yield* first.socket.close;
            const second = yield* link;
            const restarted = yield* outbox;
            assert.deepStrictEqual(yield* restarted.batch, frame);
            yield* second.socket.send(frame);
            const answer = (yield* second.socket.takeWhere(
              "replayed usage acknowledgement",
              (message) => message.type === "usage-ack",
            )) as unknown as Extract<UsageLinkDown, { type: "usage-ack" }>;
            yield* restarted.acknowledge(frame, answer.accepted);
            assert.isUndefined(yield* restarted.batch);
            assert.deepStrictEqual((yield* recorded)[0], {
              records: "2",
              tokens: "120",
              cost: "0",
            });
          }),
        ),
    );
  });
});
