// @effect-diagnostics nodeBuiltinImport:off -- a local stub stands in for the platform's flakes.
import * as NodeHttp from "node:http";
import * as NodeNet from "node:net";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import type { ZeropsError } from "./api.ts";
import { makeZeropsApiHttp } from "./http.ts";

const MEMBERS = {
  clientUserList: [
    {
      roleCode: "READ_ONLY",
      status: "ACTIVE",
      user: { fullName: "mate-hq-org:P1", email: "token-abc@zerops.io" },
    },
  ],
};

/** A stub API: the first `failures` requests answer `status` with `code`, the rest `MEMBERS`. */
const stub = (failures: number, status: number, code: string) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly requests: () => number;
          readonly server: NodeHttp.Server;
        }>((resolve) => {
          let requests = 0;
          const server = NodeHttp.createServer((_, response) => {
            requests += 1;
            const failing = requests <= failures;
            response.writeHead(failing ? status : 200, { "content-type": "application/json" });
            response.end(JSON.stringify(failing ? { error: { code } } : MEMBERS));
          });
          server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as NodeNet.AddressInfo;
            resolve({ url: `http://127.0.0.1:${String(port)}`, requests: () => requests, server });
          });
        }),
    ),
    ({ server }) =>
      Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );

const read = (url: string, read: "members" | "project") =>
  Effect.gen(function* () {
    const client = yield* Layer.build(NodeHttpClient.layerNodeHttp);
    const api = yield* makeZeropsApiHttp(url).pipe(Effect.provide(client));
    const credential = Redacted.make("token");
    const effect: Effect.Effect<unknown, ZeropsError> =
      read === "members" ? api.members("ORG")(credential) : api.project("P1")(credential);
    // The rows, or the failure's tag and reason.
    return yield* effect.pipe(
      Effect.match({
        onSuccess: (value): unknown => value,
        onFailure: (error) => (error._tag === "ZeropsRefused" ? error.reason : error._tag),
      }),
    );
  });

describe("makeZeropsApiHttp", () => {
  it.live("reads the member list through user/list's spurious 400 userNotFound", () =>
    Effect.gen(function* () {
      const api = yield* stub(2, 400, "userNotFound");
      assert.deepStrictEqual(yield* read(api.url, "members"), [
        { name: "mate-hq-org:P1", kind: "token", roleCode: "READ_ONLY", status: "ACTIVE" },
      ]);
      assert.strictEqual(api.requests(), 3);
    }),
  );

  it.live("gives up after four tries as unavailable, never as an empty list", () =>
    Effect.gen(function* () {
      const api = yield* stub(100, 400, "userNotFound");
      assert.strictEqual(yield* read(api.url, "members"), "ZeropsUnavailable");
      assert.strictEqual(api.requests(), 4);
    }),
  );

  it.live("retries a 503, and never retries a verdict such as projectNotFound", () =>
    Effect.gen(function* () {
      const flaky = yield* stub(1, 503, "");
      assert.lengthOf((yield* read(flaky.url, "members")) as ReadonlyArray<unknown>, 1);
      assert.strictEqual(flaky.requests(), 2);
      const missing = yield* stub(100, 400, "projectNotFound");
      assert.strictEqual(yield* read(missing.url, "project"), "not_found");
      assert.strictEqual(missing.requests(), 1);
    }),
  );
});
