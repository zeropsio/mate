import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsIdentityStatusModule from "./ZeropsIdentityStatus.ts";
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import * as ZeropsProjectAccessModule from "./ZeropsProjectAccess.ts";
import { readOwnAccess } from "./ZeropsProjectAccess.ts";
import { ORG_READ_MAX_AGE } from "./ZeropsOrgRead.ts";
import { make as makeProjectSigners } from "./ZeropsProjectSigners.ts";
import { verifyThrowawayCaller } from "./ZeropsThrowawayIdentity.ts";
import { memorySignInStore, ZeropsSignIns } from "./zeropsSignIns.ts";

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const USER_ID = "8yLPr0kbTA6MZKfMLBQe0A";
const TOKEN_ID = "tok-throwaway";
const MATE_KEY = "the-mates-own-zerops-key";
const PRESENTED = "the-presented-throwaway";
const API_NOW = "Tue, 16 Sep 2026 10:00:00 GMT";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  apiToken: MATE_KEY,
})!;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/**
 * A Zerops API that admits the person's throwaway, counting every request by its path's end. With
 * `held`, the member list answers only once it is done.
 */
function platform(held?: Deferred.Deferred<void>) {
  const seen: Array<string> = [];
  const route = (url: string): Response => {
    if (url.endsWith(`/project/${PROJECT_ID}`))
      return json({ id: PROJECT_ID, clientId: CLIENT_ID });
    if (url.endsWith("/user/info")) return json({ id: TOKEN_ID });
    if (url.includes("/integration-token/")) {
      return json(
        {
          id: TOKEN_ID,
          name: `mate-door:${PROJECT_ID}:a1b2c3`,
          created: DateTime.formatIso(DateTime.makeUnsafe(Date.parse(API_NOW) - 10_000)),
          createdByUser: USER_ID,
          roleCode: "NO_ACCESS",
          projects: [],
        },
        200,
        { date: API_NOW },
      );
    }
    if (url.endsWith("/user/list")) {
      return json({
        clientUserList: [{ id: "cu-1", userId: USER_ID, roleCode: "OWNER", status: "ACTIVE" }],
      });
    }
    return json({ message: "unexpected route" }, 500);
  };
  const layer = ZeropsProjectAccessModule.layer.pipe(
    Layer.provideMerge(
      ZeropsOrgReadModule.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.gen(function* () {
                  seen.push(new URL(request.url).pathname);
                  if (held !== undefined && request.url.endsWith("/user/list")) {
                    yield* Deferred.await(held);
                  }
                  return HttpClientResponse.fromWeb(request, route(request.url));
                }),
              ),
            ),
            Layer.succeed(
              ZeropsMateKeyModule.ZeropsMateKey,
              ZeropsMateKeyModule.snapshotOnlyReader(MATE_KEY),
            ),
            ZeropsIdentityStatusModule.layer,
            ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
          ),
        ),
      ),
    ),
  );
  const count = (end: string) => seen.filter((path) => path.endsWith(end)).length;
  return { layer, count };
}

/** The signers gate over no recorded sign-in. */
const signersGate = Effect.gen(function* () {
  const signIns = yield* memorySignInStore();
  return yield* makeProjectSigners.pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
        NodeServices.layer,
        Layer.succeed(ZeropsSignIns, signIns),
      ),
    ),
  );
});

describe("the org, as this Mate reads it", () => {
  // KRLS's list carries every integration token as a member (181 rows, 2026-10-03), and a slow
  // Zerops took up to 35 s to answer it: read once for all three.
  it.effect(
    "reads the member list once for a door, the membership watch and a signer check within 30 s",
    () => {
      const zerops = platform();
      return Effect.gen(function* () {
        const signers = yield* signersGate;
        yield* verifyThrowawayCaller({ environment, token: PRESENTED });
        const watched = yield* readOwnAccess({ environment });
        assert.isTrue(watched.ok);
        assert.isTrue(yield* signers.hasProjectAccess(USER_ID));
        assert.strictEqual(zerops.count("/user/list"), 1);
      }).pipe(Effect.scoped, Effect.provide(zerops.layer));
    },
  );

  it.effect("reads this Mate's own project once for all three as well", () => {
    const zerops = platform();
    return Effect.gen(function* () {
      const signers = yield* signersGate;
      yield* verifyThrowawayCaller({ environment, token: PRESENTED });
      yield* readOwnAccess({ environment });
      yield* signers.hasProjectAccess(USER_ID);
      assert.strictEqual(zerops.count(`/project/${PROJECT_ID}`), 1);
    }).pipe(Effect.scoped, Effect.provide(zerops.layer));
  });

  it.effect("reads again once the answer it kept is 30 s old", () => {
    const zerops = platform();
    return Effect.gen(function* () {
      yield* verifyThrowawayCaller({ environment, token: PRESENTED });
      yield* TestClock.adjust(Duration.subtract(ORG_READ_MAX_AGE, Duration.millis(1)));
      yield* readOwnAccess({ environment });
      assert.strictEqual(zerops.count("/user/list"), 1);
      yield* TestClock.adjust(Duration.millis(1));
      yield* readOwnAccess({ environment });
      assert.strictEqual(zerops.count("/user/list"), 2);
    }).pipe(Effect.provide(zerops.layer));
  });

  it.effect("joins a read under way rather than asking again", () =>
    Effect.gen(function* () {
      const held = yield* Deferred.make<void>();
      const zerops = platform(held);
      return yield* Effect.gen(function* () {
        const both = yield* Effect.forkChild(
          Effect.all([readOwnAccess({ environment }), readOwnAccess({ environment })], {
            concurrency: "unbounded",
          }),
        );
        yield* TestClock.adjust(Duration.zero);
        assert.strictEqual(zerops.count("/user/list"), 1);
        yield* Deferred.succeed(held, undefined);
        const [first, second] = yield* Fiber.join(both);
        assert.deepStrictEqual([first.ok, second.ok], [true, true]);
        assert.strictEqual(zerops.count("/user/list"), 1);
      }).pipe(Effect.provide(zerops.layer));
    }),
  );
});
