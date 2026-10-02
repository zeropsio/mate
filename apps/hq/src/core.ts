/**
 * Core, composed once for `main.ts` and the tests: the routes served over its services, and the
 * drain that ends it. What it still needs is the HTTP server and the Zerops port (`ZeropsApi`,
 * `ZeropsDeploy`): HTTP in production, the fake in tests.
 *
 * On shutdown (`SIGTERM`, a deploy replacing this container) the drain runs before the server
 * stops: git closes, then the lead goes at once, so the next Core takes it within milliseconds and
 * finds no git of this one still writing on the shared volume (`gitHost.ts`); every open socket
 * is closed `1001 going away`, so its client reconnects to the next Core; and for `drainFor` more
 * the server still answers — a request the balancer still routes here gets an answer (`/health` a
 * standby's 200, the API `503 not_active`), not a reset.
 *
 * @module core
 */
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { apiRoutes } from "./api.ts";
import { type BackupOptions, backupLayer } from "./backup.ts";
import { changesLayer } from "./changes.ts";
import { deploysLayer } from "./deploys.ts";
import { doorLayer } from "./door.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { healthRoute } from "./health.ts";
import { importsLayer } from "./importJob.ts";
import { Leader, leaderLayer } from "./leader.ts";
import { mateCredentialsLayer } from "./mateCredentials.ts";
import { mateLiveLayer } from "./mateLive.ts";
import type { Migration } from "./migrations.ts";
import { officialLayer } from "./official.ts";
import { recipeTiersLayer } from "./recipeTiers.ts";
import { releasesLayer } from "./releases.ts";
import { doorRateLimitLayer } from "./rateLimit.ts";
import { rolesLayer } from "./roles.ts";
import { sessionsLayer } from "./sessions.ts";
import {
  LiveSockets,
  liveSocketsLayer,
  mateLinkTicketsLayer,
  streamTicketsLayer,
} from "./stream.ts";
import { structureLayer } from "./structure.ts";

export interface CoreOptions {
  readonly databaseUrl: Redacted.Redacted;
  /** Where the bare repositories live: the volume's `/mnt/vol/git` in the container. */
  readonly gitRoot: string;
  /** Where the migration's bundles lie: the volume's `/mnt/vol/import`; none takes no import. */
  readonly importRoot?: string;
  /** Where a backup set is staged, the store it is kept in, and how often (`backup.ts`). */
  readonly backup: Omit<BackupOptions, "databaseUrl">;
  readonly migrations: ReadonlyArray<Migration>;
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  readonly clientOrigins: ReadonlyArray<string>;
  readonly build: string;
  /** How long the server still answers after the lead is given up on shutdown; 10 s. */
  readonly drainFor?: Duration.Duration;
  /** Shorter intervals, for tests. */
  readonly heartbeat?: Duration.Duration;
  readonly retryAfter?: Duration.Duration;
  readonly viewTtl?: Duration.Duration;
  readonly reconcileEvery?: Duration.Duration;
  readonly streamRecheck?: Duration.Duration;
  readonly pingEvery?: Duration.Duration;
  readonly importPoll?: Duration.Duration;
}

const routes = (options: CoreOptions) =>
  Layer.mergeAll(
    healthRoute(options.build),
    apiRoutes({
      clientOrigins: options.clientOrigins,
      ...(options.streamRecheck === undefined ? {} : { recheck: options.streamRecheck }),
      ...(options.pingEvery === undefined ? {} : { pingEvery: options.pingEvery }),
      link: {
        ...(options.pingEvery === undefined ? {} : { pingEvery: options.pingEvery }),
        ...(options.streamRecheck === undefined ? {} : { recheck: options.streamRecheck }),
      },
    }),
  );

const services = (options: CoreOptions) => {
  const leader = leaderLayer({
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  }).pipe(
    Layer.provideMerge(
      officialLayer({
        projectId: options.hqProjectId,
        credential: options.credential,
      }),
    ),
  );
  return Layer.mergeAll(
    sessionsLayer,
    structureLayer({
      hqProjectId: options.hqProjectId,
      reconcileEvery: options.reconcileEvery ?? Duration.seconds(60),
    }),
    doorLayer({ hqProjectId: options.hqProjectId }),
    mateCredentialsLayer({ credential: options.credential }),
    doorRateLimitLayer,
    streamTicketsLayer,
    mateLinkTicketsLayer,
    liveSocketsLayer,
    Layer.mergeAll(
      importsLayer({
        importRoot: options.importRoot,
        hqProjectId: options.hqProjectId,
        credential: options.credential,
        ...(options.importPoll === undefined ? {} : { poll: options.importPoll }),
      }),
      backupLayer({ databaseUrl: options.databaseUrl, ...options.backup }),
    ).pipe(
      Layer.provideMerge(
        deploysLayer().pipe(
          Layer.provideMerge(releasesLayer),
          Layer.provide(recipeTiersLayer),
          Layer.provideMerge(changesLayer),
        ),
      ),
      Layer.provideMerge(
        gitHostLayer({
          rootDir: options.gitRoot,
          ...(options.importRoot === undefined ? {} : { importRoots: [options.importRoot] }),
        }),
      ),
    ),
  ).pipe(
    Layer.provideMerge(mateLiveLayer),
    Layer.provideMerge(
      rolesLayer({
        hqProjectId: options.hqProjectId,
        credential: options.credential,
        ...(options.viewTtl === undefined ? {} : { viewTtl: options.viewTtl }),
      }),
    ),
    Layer.provideMerge(leader),
    Layer.provideMerge(
      PgClient.layer({ url: options.databaseUrl, applicationName: "hq", maxConnections: 4 }),
    ),
  );
};

/**
 * On shutdown, before the server stops: git, the lead and the sockets go, the server answers
 * `drainFor` more.
 */
export const drainLayer = (drainFor: Duration.Duration) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const leader = yield* Leader;
      const git = yield* GitHost;
      const sockets = yield* LiveSockets;
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          yield* Effect.logInfo("draining");
          yield* git.close;
          yield* leader.release;
          yield* sockets.closeAll(1001, "going away");
          yield* Effect.sleep(drainFor);
        }),
      );
    }),
  );

/**
 * The whole Core. Built in this order — services, the served routes, the drain — so it ends in the
 * reverse: the drain first, while the routes still answer.
 */
export const coreApp = (options: CoreOptions) =>
  drainLayer(options.drainFor ?? Duration.seconds(10)).pipe(
    Layer.provide(HttpRouter.serve(routes(options))),
    Layer.provideMerge(services(options)),
  );
