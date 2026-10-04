// @effect-diagnostics nodeBuiltinImport:off -- `node:http` is the server NodeHttpServer.layer wraps.
/**
 * HQ Core's entry. From the environment: `DATABASE_URL`, a direct connection to Postgres (an
 * advisory lock does not survive the pooler on 6432); `PORT` (8080); the platform's `projectId`,
 * whose own domain is this Core's address, which the anchor must name (`official.ts`); `HQ_ORG_TOKEN`, the org Read only credential HQ reads Zerops with (absent
 * means `credentials_wrong`); `HQ_KEY_SECRET`, the key its environments' deploy tokens are sealed
 * with (`deployKeys.ts`; absent, HQ deploys nothing); `HQ_ZEROPS_API`, the region's REST API; `HQ_CLIENT_ORIGINS`, the
 * client origins the API answers; `HQ_DRAIN_SECONDS`, how long the server still answers on shutdown (`core.ts`);
 * `HQ_BACKUP_*`, the bucket backup sets are kept in (`bucketStore.ts`; without it backup is off). The
 * server answers from the first moment; the official check and the leader work behind it. The
 * leading Core takes a backup set every hour (`backup.ts`).
 *
 * `sets` lists the backup sets staged on the volume and kept in the bucket, each whole or not, with
 * its bytes. `restore <set> [--from-volume] [--replace]` makes HQ again from set `<set>`
 * (`restore.ts`), from the bucket, or from the sets staged on the volume (with no bucket, or
 * `--from-volume`), and ends. It writes only while no Core holds the database (`hq` started as
 * `zsc noop`), into an empty database and `/mnt/vol/git`, or with `--replace` over the live ones,
 * kept first (`/mnt/vol/restore/before-<time>.dump`, `/mnt/vol/git.before-<time>`); then `hq`
 * deploys as it was (vysledky/hq-backup.md §10).
 *
 * `main.mjs import …` is no server but the migration's command (`importCli.ts`): its lines on the
 * standard output, its outcome the exit code.
 *
 * @module main
 */
import * as NodeHttp from "node:http";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { directoryStore, setsIn } from "./backup.ts";
import { BUCKET_ENV, bucketFromEnv, bucketStore } from "./bucketStore.ts";
import { type CoreOptions, coreApp, runCore } from "./core.ts";
import { USAGE, checkCommand, importArgs, queueCommand } from "./importCli.ts";
import { bundledMigrations } from "./migrationFiles.ts";
import { restoreSet } from "./restore.ts";
import { ZeropsApi, ZeropsDeploy, ZeropsObservation } from "./zerops/api.ts";
import {
  makeZeropsApiHttp,
  makeZeropsDeployHttp,
  makeZeropsObservationHttp,
} from "./zerops/http.ts";

/** The build stamp the bundle carries (`vite.config.ts`); an unbundled run is `dev`. */
declare const __HQ_BUILD__: string | undefined;
const BUILD = typeof __HQ_BUILD__ === "undefined" ? "dev" : __HQ_BUILD__;

/** Every repository on the volume `vol` (zerops.yml), which survives a deploy. */
const GIT_ROOT = "/mnt/vol/git";
/** Where backup sets are staged, beside the repositories. */
const STAGING_DIR = "/mnt/vol/backup";

/** The bucket backup sets are kept in, if HQ's environment names it. */
const bucketOfEnv = Effect.gen(function* () {
  const env: Record<string, string | undefined> = {};
  for (const name of BUCKET_ENV) {
    env[name] = Option.getOrUndefined(yield* Config.option(Config.String(name)));
  }
  return bucketFromEnv(env);
});

const core = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Port("PORT").pipe(Config.withDefault(8080));
    const api = yield* Config.String("HQ_ZEROPS_API").pipe(
      Config.withDefault("https://api.app-prg1.zerops.io/api/rest/public"),
    );
    const origins = yield* Config.String("HQ_CLIENT_ORIGINS").pipe(
      Config.withDefault("https://mate.zerops.io,http://localhost:4380"),
    );
    const bucket = yield* bucketOfEnv;
    const zerops = Layer.mergeAll(
      Layer.effect(ZeropsApi, makeZeropsApiHttp(api)),
      Layer.effect(ZeropsDeploy, makeZeropsDeployHttp(api)),
      Layer.effect(ZeropsObservation, makeZeropsObservationHttp(api)),
    ).pipe(Layer.provide(NodeHttpClient.layerNodeHttp));
    const options: CoreOptions = {
      drainFor: Duration.seconds(
        yield* Config.Int("HQ_DRAIN_SECONDS").pipe(Config.withDefault(10)),
      ),
      databaseUrl: yield* Config.Redacted("DATABASE_URL"),
      gitRoot: GIT_ROOT,
      // The migration's bundles, copied beside the repositories (`importJob.ts`).
      importRoot: "/mnt/vol/import",
      backup: {
        stagingDir: STAGING_DIR,
        store: bucket === null ? null : bucketStore(bucket.access),
        ...(bucket === null ? {} : { quotaGb: bucket.quotaGb }),
        every: Duration.hours(1),
      },
      migrations: bundledMigrations(),
      hqProjectId: yield* Config.String("projectId"),
      credential: yield* Config.option(Config.Redacted("HQ_ORG_TOKEN")),
      keySecret: yield* Config.option(Config.Redacted("HQ_KEY_SECRET")),
      clientOrigins: origins.split(",").map((origin) => origin.trim()),
      build: BUILD,
    };
    return coreApp(options).pipe(
      Layer.provide(zerops),
      Layer.provide(
        NodeHttpServer.layer(
          // A push may stream for as long as the git layer's own deadline (30 min); a request's
          // headers still come within Node's 60 s.
          () => NodeHttp.createServer({ requestTimeout: 30 * 60 * 1000 }),
          { port },
        ),
      ),
    );
  }),
);

const restore = (set: string, flags: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const bucket = yield* bucketOfEnv;
    const { manifest, kept } = yield* restoreSet(
      flags.has("--from-volume") || bucket === null
        ? directoryStore(STAGING_DIR)
        : bucketStore(bucket.access),
      set,
      {
        databaseUrl: yield* Config.Redacted("DATABASE_URL"),
        gitRoot: GIT_ROOT,
        workDir: "/mnt/vol/restore",
        replace: flags.has("--replace"),
      },
    );
    yield* Effect.logInfo("restored", {
      set: manifest.id,
      takenAt: manifest.takenAt,
      repos: manifest.repos.length,
      ...(kept.dump === null ? {} : { keptDatabase: kept.dump }),
      ...(kept.git === null ? {} : { keptGit: kept.git }),
    });
  });

const [command, ...args] = process.argv.slice(2);
if (command === "import") {
  const asked = importArgs(args);
  Effect.gen(function* () {
    const result =
      asked.kind === "check"
        ? yield* checkCommand(asked.dir)
        : asked.kind === "import"
          ? yield* queueCommand(asked.dir).pipe(
              Effect.provide(
                Layer.unwrap(
                  Effect.map(Config.Redacted("DATABASE_URL"), (url) =>
                    PgClient.layer({ url, applicationName: "hq-import" }),
                  ),
                ),
              ),
            )
          : USAGE;
    for (const line of result.lines) yield* Console.log(line);
    process.exitCode = result.code;
  }).pipe(NodeRuntime.runMain);
} else if (command === "sets") {
  Effect.gen(function* () {
    const bucket = yield* bucketOfEnv;
    const stores = [
      ["volume", directoryStore(STAGING_DIR)] as const,
      ...(bucket === null ? [] : [["bucket", bucketStore(bucket.access)] as const]),
    ];
    for (const [where, store] of stores) {
      for (const set of setsIn(yield* store.list("sets/"))) {
        yield* Console.log(
          `${where} ${set.id} ${set.whole ? "whole" : "incomplete"} ${String(set.bytes)}`,
        );
      }
    }
  }).pipe(NodeRuntime.runMain);
} else if (command === "restore") {
  const [set, ...flags] = args;
  (set === undefined || flags.some((flag) => flag !== "--from-volume" && flag !== "--replace")
    ? Effect.andThen(
        Console.log("usage: main.mjs restore <set> [--from-volume] [--replace]"),
        Effect.sync(() => {
          process.exitCode = 2;
        }),
      )
    : restore(set, new Set(flags))
  ).pipe(NodeRuntime.runMain);
} else {
  runCore(core).pipe(NodeRuntime.runMain);
}
