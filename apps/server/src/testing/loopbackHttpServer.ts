// @effect-diagnostics nodeBuiltinImport:off - the test server is a Node HTTP listener.
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { FetchHttpClient, HttpServer } from "effect/http";
import * as Layer from "effect/Layer";

/**
 * `NodeHttpServer.layerTest` bound to 127.0.0.1 instead of every address. Tests dial 127.0.0.1; on
 * macOS another process may bind 127.0.0.1 to a port a wildcard listener holds and then receives
 * that port's loopback traffic. Binding 127.0.0.1 makes such a bind fail with EADDRINUSE.
 */
export const layerLoopbackTest = (options?: Pick<NodeHttpServer.Options, "websocket">) =>
  HttpServer.layerTestClient.pipe(
    Layer.provide(
      Layer.fresh(FetchHttpClient.layer).pipe(
        Layer.provide(Layer.succeed(FetchHttpClient.RequestInit)({ keepalive: false })),
      ),
    ),
    Layer.provideMerge(
      NodeHttpServer.layer(NodeHttp.createServer, { ...options, port: 0, host: "127.0.0.1" }),
    ),
  );
