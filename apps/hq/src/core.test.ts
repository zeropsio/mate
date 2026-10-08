import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { drainLayer } from "./core.ts";
import { GitHost, type PushedChange } from "./gitHost.ts";
import { Leader, NotLeader } from "./leader.ts";
import { LiveSockets } from "./stream.ts";

describe("the drain", () => {
  it.effect("closes git before it gives the lead up, then sends the sockets away", () =>
    Effect.gen(function* () {
      const done: Array<string> = [];
      const note = (what: string) => Effect.sync(() => void done.push(what));
      const services = Layer.mergeAll(
        Layer.succeed(Leader, {
          status: Effect.succeed({ state: "active" as const, epoch: 1 }),
          changes: Stream.empty,
          nextAttempt: Effect.never,
          release: note("lead released"),
          hold: () => Effect.die("no hold"),
          held: Effect.succeed(null),
          write: () => Effect.die("no writes"),
        }),
        Layer.succeed(GitHost, {
          nextAttempt: Effect.never,
          git: Effect.fail(new NotLeader({ reason: "standby" })),
          status: Effect.succeed({ git: "closed" as const, quarantined: [] }),
          opened: () => Effect.fail(new NotLeader({ reason: "standby" })),
          serve: () => Effect.die("no git"),
          close: note("git closed"),
          holdingRepos: (effect) => effect,
          recorded: Stream.empty,
          pushes: yield* Queue.unbounded<PushedChange>(),
        }),
        Layer.succeed(LiveSockets, {
          track: () => Effect.void,
          closeAll: () => note("sockets sent away"),
        }),
      );
      const scope = yield* Scope.make();
      yield* Layer.buildWithScope(drainLayer(Duration.zero).pipe(Layer.provide(services)), scope);
      assert.deepStrictEqual(done, []);
      yield* Scope.close(scope, Exit.void);
      assert.deepStrictEqual(done, ["git closed", "lead released", "sockets sent away"]);
    }),
  );
});
