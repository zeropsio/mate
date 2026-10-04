import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { drainLayer, runCore } from "./core.ts";
import { GitHost, type PushedChange } from "./gitHost.ts";
import { Leader, NotLeader } from "./leader.ts";
import { LiveSockets } from "./stream.ts";

describe("the drain", () => {
  it.effect.each(["shutdown", "leader failure", "git failure"] as const)(
    "%s closes git before releasing the lead and sending sockets away",
    (outcome) =>
      Effect.gen(function* () {
        const done: Array<string> = [];
        const failure = new Error(outcome);
        const note = (what: string) => Effect.sync(() => void done.push(what));
        const services = Layer.mergeAll(
          Layer.succeed(Leader, {
            status: Effect.succeed({ state: "active" as const, epoch: 1 }),
            failure: outcome === "leader failure" ? Effect.fail(failure) : Effect.never,
            changes: Stream.empty,
            release: note("lead released"),
            hold: () => Effect.die("no hold"),
            held: Effect.succeed(null),
            write: () => Effect.die("no writes"),
          }),
          Layer.succeed(GitHost, {
            failure: outcome === "git failure" ? Effect.fail(failure) : Effect.never,
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
        const core = drainLayer(Duration.zero).pipe(Layer.provideMerge(services));
        if (outcome === "shutdown") {
          const scope = yield* Scope.make();
          yield* Layer.buildWithScope(core, scope);
          assert.deepStrictEqual(done, []);
          yield* Scope.close(scope, Exit.void);
        } else {
          const exit = yield* Effect.exit(runCore(core));
          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            assert.strictEqual(Option.getOrUndefined(Cause.findErrorOption(exit.cause)), failure);
          }
        }
        assert.deepStrictEqual(done, ["git closed", "lead released", "sockets sent away"]);
      }),
  );
});
