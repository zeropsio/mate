// @effect-diagnostics nodeBuiltinImport:off - the probe is a second, raw Node listener.
import * as NodeHttp from "node:http";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpServer } from "effect/http";
import type * as NetAddress from "effect/net/NetAddress";

import { layerLoopbackTest } from "./loopbackHttpServer.ts";

it.effect(
  "no other listener can take the test server's loopback port and answer its requests",
  () =>
    Effect.gen(function* () {
      const server = yield* HttpServer.HttpServer;
      const { port } = server.address as NetAddress.InetAddress;
      const impostor = NodeHttp.createServer();
      const outcome = yield* Effect.callback<string>((resume) => {
        impostor.once("error", (error: NodeJS.ErrnoException) =>
          resume(Effect.succeed(error.code ?? "error")),
        );
        impostor.listen({ port, host: "127.0.0.1" }, () => resume(Effect.succeed("bound")));
        return Effect.sync(() => impostor.close());
      });
      impostor.close();
      assert.equal(outcome, "EADDRINUSE");
    }).pipe(Effect.provide(layerLoopbackTest())),
);
