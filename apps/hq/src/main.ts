// @effect-diagnostics nodeBuiltinImport:off -- `node:http` is the server NodeHttpServer.layer wraps.
/**
 * HQ Core's entry. From the environment: `DATABASE_URL`, a direct connection to Postgres (an
 * advisory lock does not survive the pooler on 6432); `PORT` (8080); the platform's `projectId`
 * and `zeropsSubdomain` (this Core's own address, absent while the subdomain is off), which the
 * anchor must name; `HQ_ORG_TOKEN`, the org Read only credential the anchor is read with (absent
 * means `credentials_wrong`); `HQ_ZEROPS_API`, the region's REST API. The server answers from the
 * first moment; the official check and the leader work behind it.
 *
 * @module main
 */
import * as NodeHttp from "node:http";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { healthRoute } from "./health.ts";
import { leaderLayer } from "./leader.ts";
import { bundledMigrations } from "./migrationFiles.ts";
import { officialLayer } from "./official.ts";
import { ZeropsApi } from "./zerops/api.ts";
import { makeZeropsApiHttp } from "./zerops/http.ts";

/** The build stamp the bundle carries (`vite.config.ts`); an unbundled run is `dev`. */
declare const __HQ_BUILD__: string | undefined;
const BUILD = typeof __HQ_BUILD__ === "undefined" ? "dev" : __HQ_BUILD__;

const core = Layer.unwrap(
  Effect.gen(function* () {
    const databaseUrl = yield* Config.Redacted("DATABASE_URL");
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(8080));
    const projectId = yield* Config.String("projectId");
    const address = yield* Config.option(Config.String("zeropsSubdomain"));
    const credential = yield* Config.option(Config.Redacted("HQ_ORG_TOKEN"));
    const api = yield* Config.String("HQ_ZEROPS_API").pipe(
      Config.withDefault("https://api.app-prg1.zerops.io/api/rest/public"),
    );
    const pool = PgClient.layer({ url: databaseUrl, applicationName: "hq", maxConnections: 4 });
    const zerops = Layer.effect(ZeropsApi, makeZeropsApiHttp(api)).pipe(
      Layer.provide(NodeHttpClient.layerNodeHttp),
    );
    const official = officialLayer({
      projectId,
      address: Option.getOrUndefined(address),
      credential,
    }).pipe(Layer.provide(zerops));
    return HttpRouter.serve(healthRoute(BUILD)).pipe(
      Layer.provide(leaderLayer({ databaseUrl, migrations: bundledMigrations() })),
      Layer.provideMerge(official),
      Layer.provide(pool),
      Layer.provide(NodeHttpServer.layer(() => NodeHttp.createServer(), { port })),
    );
  }),
);

Layer.launch(core).pipe(NodeRuntime.runMain);
