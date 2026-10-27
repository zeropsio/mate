import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ConversationId,
  type LeaseReleaseResult,
  type Principal,
  type ThreadLease,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Conversations } from "../Conversations.ts";
import type { Command } from "../domain/command.ts";
import { EffectHandlers, handlersOf, makeEffectWorker } from "../outbox/EffectWorker.ts";
import { LeaseRelease } from "../ports.ts";
import { World, audit, engineLayerWith, newBoot, tempDb } from "../testing/world.ts";
import { makeLeaseRelease } from "./leaseRelease.ts";

const ana = ConversationId.make("ana-chat");
const bo = ConversationId.make("bo-chat");
const person: Principal = { kind: "person", subject: "ana" };
const engine: Principal = { kind: "engine" };

const webpool3: ThreadLease = {
  alias: "webpool-3",
  pool: "webpool",
  branch: "feat-x",
  repo: "https://hq.example/git/app/web.git",
};
const apipool1: ThreadLease = { ...webpool3, alias: "apipool-1", pool: "apipool" };

let commands = 0;
const tell = (conversation: ConversationId, command: Command) =>
  Effect.flatMap(Conversations, (conversations) =>
    conversations.tell({
      commandId: CommandId.make(`lease-test-${++commands}`),
      conversationId: conversation,
      principal: command._tag === "BindLease" ? engine : person,
      command,
    }),
  );

/** The engine with the world's handlers and the server's own `lease.release`, over `port`. */
const leaseEngine = (world: World, port?: LeaseRelease["Service"]) => {
  const handlers = Layer.effect(
    EffectHandlers,
    Effect.map(makeLeaseRelease, (lease) => handlersOf(...world.handlers().values(), lease)),
  );
  return engineLayerWith(
    tempDb("lease"),
    port === undefined ? handlers : handlers.pipe(Layer.provide(Layer.succeed(LeaseRelease, port))),
  );
};

/** A zcp that answers `result`, and the calls it got. */
const answering = (result: LeaseReleaseResult) => {
  const asked: Array<unknown> = [];
  const port = LeaseRelease.of({
    release: (input) => Effect.sync(() => asked.push(input)).pipe(Effect.as(result)),
  });
  return { asked, port };
};

const receipts = (conversation: ConversationId) =>
  Effect.map(audit(conversation), ({ events }) =>
    events.flatMap((event) => (event._tag === "LeaseReleaseSettled" ? [event] : [])),
  );

const drain = Effect.gen(function* () {
  const worker = yield* makeEffectWorker(newBoot());
  while (yield* worker.runOnce) {
    // every effect the archive asked for, and every one it led to
  }
});

describe("lease.release", () => {
  it.effect(
    "an archived conversation's branch is released through zcp once, as its binding names it",
    () =>
      Effect.gen(function* () {
        const world = new World();
        const zcp = answering({
          outcome: "released",
          leases: [{ lease: "webpool-3", outcome: "kept-warm" }],
        });
        const after = yield* Effect.gen(function* () {
          yield* tell(ana, { _tag: "BindLease", lease: webpool3 });
          yield* tell(ana, { _tag: "Archive" });
          yield* drain;
          return {
            receipts: yield* receipts(ana),
            lease: (yield* (yield* Conversations).state(ana)).lease,
          };
        }).pipe(Effect.provide(leaseEngine(world, zcp.port)));
        expect(zcp.asked).toEqual([
          { branch: "feat-x", repo: "https://hq.example/git/app/web.git" },
        ]);
        expect(after.receipts).toMatchObject([
          { alias: "webpool-3", branch: "feat-x", result: { outcome: "released" } },
        ]);
        expect(after.lease).toBeNull();
      }),
  );

  it.effect("outside Zerops nothing releases, and the receipt says so", () =>
    Effect.gen(function* () {
      const world = new World();
      const after = yield* Effect.gen(function* () {
        yield* tell(ana, { _tag: "BindLease", lease: webpool3 });
        yield* tell(ana, { _tag: "Archive" });
        yield* drain;
        return {
          receipts: yield* receipts(ana),
          lease: (yield* (yield* Conversations).state(ana)).lease,
        };
      }).pipe(Effect.provide(leaseEngine(world)));
      expect(after.receipts).toMatchObject([
        { alias: "webpool-3", branch: "feat-x", result: { outcome: "failed" } },
      ]);
      expect(after.lease).toEqual(webpool3);
    }),
  );

  it.effect("a branch-wide release unbinds every conversation bound to a lease it released", () =>
    Effect.gen(function* () {
      const world = new World();
      const zcp = answering({
        outcome: "released",
        leases: [
          { lease: "webpool-3", outcome: "kept-warm" },
          { lease: "apipool-1", outcome: "removed" },
        ],
      });
      const leases = yield* Effect.gen(function* () {
        yield* tell(ana, { _tag: "BindLease", lease: webpool3 });
        yield* tell(bo, { _tag: "BindLease", lease: apipool1 });
        yield* tell(ana, { _tag: "Archive" });
        yield* drain;
        const conversations = yield* Conversations;
        return {
          ana: (yield* conversations.state(ana)).lease,
          bo: (yield* conversations.state(bo)).lease,
        };
      }).pipe(Effect.provide(leaseEngine(world, zcp.port)));
      expect(leases).toEqual({ ana: null, bo: null });
    }),
  );

  it.effect("undoing an archive before its release starts withdraws it: zcp is never asked", () =>
    Effect.gen(function* () {
      const world = new World();
      const zcp = answering({ outcome: "released", leases: [] });
      const after = yield* Effect.gen(function* () {
        yield* tell(ana, { _tag: "BindLease", lease: webpool3 });
        yield* tell(ana, { _tag: "Archive" });
        yield* tell(ana, { _tag: "Unarchive" });
        yield* drain;
        return {
          receipts: yield* receipts(ana),
          lease: (yield* (yield* Conversations).state(ana)).lease,
        };
      }).pipe(Effect.provide(leaseEngine(world, zcp.port)));
      expect(zcp.asked).toEqual([]);
      expect(after.receipts).toMatchObject([{ result: { outcome: "withdrawn" } }]);
      expect(after.lease).toEqual(webpool3);
    }),
  );

  it.effect("a release zcp never answers holds no send of another conversation", () =>
    Effect.gen(function* () {
      const world = new World();
      const hung = yield* Deferred.make<LeaseReleaseResult>();
      const port = LeaseRelease.of({ release: () => Deferred.await(hung) });
      const yieldMany = Effect.forEach(Array.from({ length: 300 }), () => Effect.yieldNow, {
        discard: true,
      });
      yield* Effect.gen(function* () {
        yield* tell(ana, { _tag: "BindLease", lease: webpool3 });
        yield* tell(ana, { _tag: "Archive" });
        const worker = yield* makeEffectWorker(newBoot(), { concurrency: 1, ownerConcurrency: 1 });
        yield* worker.start;
        yield* yieldMany;
        yield* tell(bo, { _tag: "Send", text: "still here" });
        yield* yieldMany;
      }).pipe(Effect.scoped, Effect.provide(leaseEngine(world, port)));
      expect(world.received.map((said) => said.text)).toEqual(["still here"]);
    }),
  );
});
