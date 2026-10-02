// @effect-diagnostics nodeBuiltinImport:off -- `node:http` is the server NodeHttpServer.layer wraps.
/**
 * HQ Core's entry. From the environment: `DATABASE_URL`, a direct connection to Postgres (an
 * advisory lock does not survive the pooler on 6432); `PORT` (8080); the platform's `projectId`
 * and `zeropsSubdomain` (this Core's own address, absent while the subdomain is off), which the
 * anchor must name; `HQ_ORG_TOKEN`, the org Read only credential HQ reads Zerops with (absent
 * means `credentials_wrong`); `HQ_ZEROPS_API`, the region's REST API; `HQ_CLIENT_ORIGINS`, the
 * client origins the API answers; `HQ_DRAIN_SECONDS`, how long the server still answers on shutdown (`core.ts`). The server answers from the first moment; the official check and
 * the leader work behind it.
 *
 * @module main
 */
import * as NodeHttp from "node:http";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { type CoreOptions, coreApp } from "./core.ts";
import { bundledMigrations } from "./migrationFiles.ts";
import { ZeropsApi } from "./zerops/api.ts";
import { makeZeropsApiHttp } from "./zerops/http.ts";

/** The build stamp the bundle carries (`vite.config.ts`); an unbundled run is `dev`. */
declare const __HQ_BUILD__: string | undefined;
const BUILD = typeof __HQ_BUILD__ === "undefined" ? "dev" : __HQ_BUILD__;

const core = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(8080));
    const api = yield* Config.String("HQ_ZEROPS_API").pipe(
      Config.withDefault("https://api.app-prg1.zerops.io/api/rest/public"),
    );
    const origins = yield* Config.String("HQ_CLIENT_ORIGINS").pipe(
      Config.withDefault("https://mate.zerops.io,http://localhost:4380"),
    );
    const zerops = Layer.effect(ZeropsApi, makeZeropsApiHttp(api)).pipe(
      Layer.provide(NodeHttpClient.layerNodeHttp),
    );
    const options: CoreOptions = {
      drainFor: Duration.seconds(
        yield* Config.Int("HQ_DRAIN_SECONDS").pipe(Config.withDefault(10)),
      ),
      databaseUrl: yield* Config.Redacted("DATABASE_URL"),
      migrations: bundledMigrations(),
      hqProjectId: yield* Config.String("projectId"),
      address: Option.getOrUndefined(yield* Config.option(Config.String("zeropsSubdomain"))),
      credential: yield* Config.option(Config.Redacted("HQ_ORG_TOKEN")),
      clientOrigins: origins.split(",").map((origin) => origin.trim()),
      build: BUILD,
    };
    return coreApp(options).pipe(
      Layer.provide(zerops),
      Layer.provide(NodeHttpServer.layer(() => NodeHttp.createServer(), { port })),
    );
  }),
);

Layer.launch(core).pipe(NodeRuntime.runMain);
