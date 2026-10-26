import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import { ZeropsOrgRead } from "./ZeropsOrgRead.ts";

const PROJECT_ID = "TEST000000000000000023";
const CLIENT_ID = "BBBBBBBBBBBBBBBBBBBBBB";

function platform(held?: Deferred.Deferred<void>) {
  let count = 0;
  const layer = ZeropsOrgReadModule.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              count += 1;
              if (held !== undefined) yield* Deferred.await(held);
              assert.strictEqual(request.url, `https://zerops.test/project/${PROJECT_ID}`);
              return HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify({ id: PROJECT_ID, clientId: CLIENT_ID }), {
                  headers: { "content-type": "application/json" },
                }),
              );
            }),
          ),
        ),
        Layer.succeed(
          ZeropsMateKeyModule.ZeropsMateKey,
          ZeropsMateKeyModule.snapshotOnlyReader("mate-key"),
        ),
      ),
    ),
  );
  return { layer, count: () => count };
}

const readProject = Effect.flatMap(ZeropsOrgRead, (read) =>
  read.project({ apiBaseUrl: "https://zerops.test", projectId: PROJECT_ID }),
);

describe("the org, as this Mate reads it", () => {
  it.effect("reads this Mate's own project once for all three as well", () => {
    const zerops = platform();
    return Effect.gen(function* () {
      for (let reader = 0; reader < 3; reader += 1) {
        assert.deepStrictEqual(yield* readProject, {
          kind: "answered",
          status: 200,
          body: { id: PROJECT_ID, clientId: CLIENT_ID },
        });
      }
      assert.strictEqual(zerops.count(), 1);
    }).pipe(Effect.provide(zerops.layer));
  });

  it.effect("reads again once the answer it kept is 30 s old", () => {
    const zerops = platform();
    return Effect.gen(function* () {
      yield* readProject;
      yield* TestClock.adjust(Duration.millis(29_999));
      yield* readProject;
      assert.strictEqual(zerops.count(), 1);
      yield* TestClock.adjust(Duration.millis(1));
      yield* readProject;
      assert.strictEqual(zerops.count(), 2);
    }).pipe(Effect.provide(zerops.layer));
  });

  it.effect("joins a read under way rather than asking again", () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      const zerops = platform(held);
      return yield* Effect.gen(function* () {
        const both = yield* Effect.forkChild(
          Effect.all([readProject, readProject], { concurrency: "unbounded" }),
        );
        yield* TestClock.adjust(Duration.zero);
        assert.strictEqual(zerops.count(), 1);
        yield* Deferred.succeed(held, undefined);
        const [first, second] = yield* Fiber.join(both);
        assert.deepStrictEqual([first.kind, second.kind], ["answered", "answered"]);
        assert.strictEqual(zerops.count(), 1);
      }).pipe(Effect.provide(zerops.layer));
    }),
  );
});
