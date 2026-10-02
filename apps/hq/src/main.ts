// @effect-diagnostics nodeBuiltinImport:off -- `node:http` is the server NodeHttpServer.layer wraps.
/**
 * HQ Core's entry. From the environment: `DATABASE_URL`, a direct connection to Postgres (an
 * advisory lock does not survive the pooler on 6432), and `PORT` (8080). The server answers from
 * the first moment; the leader works behind it (`leader.ts`).
 *
 * @module main
 */
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { healthRoute } from "./health.ts";
import { leaderLayer } from "./leader.ts";
import { bundledMigrations } from "./migrationFiles.ts";

/** The build stamp the bundle carries (`vite.config.ts`); an unbundled run is `dev`. */
declare const __HQ_BUILD__: string | undefined;
const BUILD = typeof __HQ_BUILD__ === "undefined" ? "dev" : __HQ_BUILD__;

const core = Layer.unwrap(
  Effect.gen(function* () {
    const databaseUrl = yield* Config.Redacted("DATABASE_URL");
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(8080));
    const pool = PgClient.layer({ url: databaseUrl, applicationName: "hq", maxConnections: 4 });
    return HttpRouter.serve(healthRoute(BUILD)).pipe(
      Layer.provide(leaderLayer({ databaseUrl, migrations: bundledMigrations() })),
      Layer.provide(pool),
      Layer.provide(NodeHttpServer.layer(() => NodeHttp.createServer(), { port })),
    );
  }),
);

Layer.launch(core).pipe(NodeRuntime.runMain);
