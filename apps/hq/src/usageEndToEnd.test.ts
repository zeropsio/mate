// @effect-diagnostics nodeBuiltinImport:off -- the Mate's disposable home: its transcripts and usage.sqlite.
/**
 * A Mate's usage capture against a running Core: the Mate's own ledger, replication and transcript
 * meter (apps/server) over HQ's real link socket, ledger and Postgres. Each Mate link here is one
 * socket with a ticket, as `ZeropsHqLink` opens it; the lane is driven the way `UsageLink` drives it.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import {
  USAGE_GENESIS_DIGEST,
  usageCanonical,
  type UsageLinkDown,
} from "@t3tools/shared/agentUsage";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as MateSqlite from "../../server/src/persistence/NodeSqliteClient.ts";
import { captureSource } from "../../server/src/usage/usageCapture.ts";
import {
  makeUsageLedger,
  UsageLedgerError,
  type UsageBinding,
  type UsageLedger,
} from "../../server/src/usage/UsageLedger.ts";
import { makeUsageReplication, renewsLedger } from "../../server/src/usage/usageReplication.ts";
import {
  enrollMate,
  setUpMate,
  startCore,
  untilHealth,
  type SocketMessage,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

const PROJECT = "P_MATE";
const isLedgerError = Schema.is(UsageLedgerError);

/** One Claude request as its transcript records it, stamped now. */
const request = (id: string, tokens: number) =>
  usageCanonical({
    type: "assistant",
    sessionId: "session",
    requestId: id,
    timestamp: DateTime.formatIso(DateTime.nowUnsafe()),
    message: {
      id,
      model: "claude-sonnet-4-5",
      usage: {
        input_tokens: tokens,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }) + "\n";

const temporary = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-e2e-"))),
  (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
);

/** A running Core, one Mate enrolled in it, and that Mate's home. */
const world = Effect.gen(function* () {
  const core = yield* startCore(true);
  yield* untilHealth(core.call, "active");
  yield* setUpMate(core.call, PROJECT);
  const credential = yield* enrollMate(core.call, core.fake, PROJECT);
  const home = yield* temporary;
  const transcripts = NodePath.join(home, "projects");
  yield* Effect.promise(() => NodeFSP.mkdir(transcripts, { recursive: true }));
  const database = NodePath.join(home, "usage.sqlite");
  /** A new link of the Mate: its socket and HQ's capture offer from its first state. */
  const link = Effect.gen(function* () {
    const { ticket } = (yield* core.call("POST", "/api/mate/link-ticket", {
      headers: { authorization: `Mate ${credential}` },
    })).body as { readonly ticket: string };
    const socket = yield* core.socket(`/api/mate/link?ticket=${ticket}`);
    const state = yield* socket.next("state");
    const usage = state["usage"] as { mateId: string; orgId: string };
    const binding: UsageBinding = { orgId: usage.orgId, projectId: PROJECT, mateId: usage.mateId };
    return { socket, binding };
  });
  /** The Mate's ledger as one process opens `usage.sqlite`; closed with the scope. */
  const ledger = Effect.flatMap(Layer.build(MateSqlite.layer({ filename: database })), (context) =>
    makeUsageLedger.pipe(Effect.provide(context)),
  );
  /** Transcript growth the Mate's scan reads (`floor` and `baseline` as the lane passes them). */
  const append = (body: string) =>
    Effect.promise(() => NodeFSP.appendFile(NodePath.join(transcripts, "session.jsonl"), body));
  const scan = (mate: UsageLedger, binding: UsageBinding) =>
    Effect.gen(function* () {
      const meta = yield* mate.metadata;
      yield* captureSource(
        mate,
        binding,
        { provider: "claude", directory: transcripts },
        {
          ...(meta.startedAt === undefined ? {} : { floor: Date.parse(meta.startedAt) }),
          baseline: meta.baselined === false,
          ledgerId: meta.ledgerId,
        },
      );
      if (meta.baselined === false) yield* mate.markBaselined;
    });
  /** What HQ has recorded for every Mate, in tokens. */
  const recorded = Effect.map(
    core.sql<{
      readonly tokens: string;
    }>`SELECT coalesce(sum((statistics->>'tokens')::numeric),0)::text AS tokens FROM hq_usage_daily`,
    (rows) => rows[0]!.tokens,
  );
  return { core, link, ledger, append, scan, recorded, database };
});

type Socket = Effect.Success<Effect.Success<typeof world>["link"]>["socket"];
const usageAnswer = (socket: Socket) =>
  socket
    .takeWhere("a usage answer", (message: SocketMessage) => message.type.startsWith("usage-"))
    .pipe(Effect.map((message) => message as unknown as UsageLinkDown));

/** The lane on one link: hello, then HQ's answers until HQ has acknowledged the whole journal. */
const replicate = (mate: UsageLedger, socket: Socket) =>
  Effect.gen(function* () {
    const lane = makeUsageReplication(mate);
    yield* socket.send(yield* lane.hello);
    for (;;) {
      const sent = yield* lane.receive(yield* usageAnswer(socket));
      if (sent !== undefined) {
        yield* socket.send(sent);
        continue;
      }
      const meta = yield* mate.metadata;
      if (meta.ack === meta.highWater) return lane;
    }
  });

describe("a Mate's usage reaching HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a Mate's journal reaches HQ exactly once across a dropped link, a restart, a fenced link and a snapshot",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { core, link, ledger, append, scan, recorded } = yield* world;
            const first = yield* link;
            yield* Effect.scoped(
              Effect.gen(function* () {
                const mate = yield* ledger;
                yield* mate.begin(first.binding);
                yield* scan(mate, first.binding);
                yield* append(request("one", 100) + request("two", 20));
                yield* scan(mate, first.binding);
                const lane = yield* replicate(mate, first.socket);
                assert.strictEqual(yield* recorded, "120");

                // The link drops with a batch in flight: HQ commits it, the ACK never arrives.
                yield* append(request("three", 30));
                yield* scan(mate, first.binding);
                yield* first.socket.send((yield* lane.next)!);
                yield* first.socket.close;
                const second = yield* link;
                yield* replicate(mate, second.socket);
                assert.strictEqual(yield* recorded, "150");
              }),
            );

            // A restart: the same usage.sqlite opened again replays nothing HQ holds.
            const third = yield* link;
            const mate = yield* ledger;
            const restarted = yield* replicate(mate, third.socket);
            assert.strictEqual(yield* recorded, "150");

            // A newer link fences the older one; the older lane stops without a refusal.
            const fourth = yield* link;
            yield* third.socket.send(yield* restarted.hello);
            const fenced = yield* usageAnswer(third.socket);
            assert.strictEqual(fenced.type === "usage-error" ? fenced.disposition : "", "fenced");
            assert.isUndefined(yield* restarted.receive(fenced));

            // HQ restored behind the Mate's compacted journal asks for a snapshot: no recount.
            yield* core.sql`UPDATE hq_usage_producer SET cursor=0, digest=${USAGE_GENESIS_DIGEST}`;
            yield* core.sql`DELETE FROM hq_usage_prefix`;
            yield* replicate(mate, fourth.socket);
            assert.strictEqual(yield* recorded, "150");
          }),
        ),
    );

    it.effect(
      "a restored usage.sqlite is refused by HQ and a new ledger counts only what follows",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { link, ledger, append, scan, recorded, database } = yield* world;
            const first = yield* link;
            yield* Effect.scoped(
              Effect.gen(function* () {
                const mate = yield* ledger;
                yield* mate.begin(first.binding);
                yield* scan(mate, first.binding);
                yield* append(request("one", 100));
                yield* scan(mate, first.binding);
                yield* replicate(mate, first.socket);
              }),
            );
            // Both connections closed: the copied file is a coherent backup of this cut.
            yield* Effect.promise(() => NodeFSP.copyFile(database, `${database}.backup`));
            const second = yield* link;
            yield* Effect.scoped(
              Effect.gen(function* () {
                const mate = yield* ledger;
                yield* append(request("two", 20));
                yield* scan(mate, second.binding);
                yield* replicate(mate, second.socket);
              }),
            );
            assert.strictEqual(yield* recorded, "120");

            yield* Effect.promise(() => NodeFSP.copyFile(`${database}.backup`, database));
            const third = yield* link;
            const mate = yield* ledger;
            const refusal = yield* replicate(mate, third.socket).pipe(Effect.flip);
            assert.isTrue(isLedgerError(refusal) && refusal.code === "ledger_rollback_conflict");
            assert.isTrue(isLedgerError(refusal) && renewsLedger(refusal.code));
            yield* mate.restart(third.binding);
            yield* scan(mate, third.binding);
            yield* append(request("three", 30));
            yield* scan(mate, third.binding);
            yield* replicate(mate, third.socket);
            // "two" fell between the backup and the restore: unknown, never counted twice.
            assert.strictEqual(yield* recorded, "150");
          }),
        ),
    );

    it.effect(
      "a lost usage.sqlite starts a new ledger HQ accepts, counting only what follows",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const { link, ledger, append, scan, recorded, database } = yield* world;
            const first = yield* link;
            yield* Effect.scoped(
              Effect.gen(function* () {
                const mate = yield* ledger;
                yield* mate.begin(first.binding);
                yield* scan(mate, first.binding);
                yield* append(request("one", 100));
                yield* scan(mate, first.binding);
                yield* replicate(mate, first.socket);
              }),
            );
            for (const suffix of ["", "-wal", "-shm"])
              yield* Effect.promise(() => NodeFSP.rm(`${database}${suffix}`, { force: true }));
            const second = yield* link;
            const mate = yield* ledger;
            yield* mate.begin(second.binding);
            yield* scan(mate, second.binding);
            yield* append(request("two", 20));
            yield* scan(mate, second.binding);
            yield* replicate(mate, second.socket);
            assert.strictEqual(yield* recorded, "120");
          }),
        ),
    );
  });
});
