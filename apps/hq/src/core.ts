import { usageLedgerLayer } from "./usageLedger.ts";
import { hqUsageReaderLayer } from "./hqUsage.ts";
import { hqScopesLayer } from "./hqScopes.ts";
import { hqOperationReaderLayer } from "./hqOperations.ts";
import { observationLayer } from "./observation.ts";
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
import * as HttpRouter from "effect/http/HttpRouter";

import { apiRoutes } from "./api.ts";
import { type BackupOptions, backupLayer } from "./backup.ts";
import { changesLayer } from "./changes.ts";
import { deployKeysLayer, keySecretOf, sealPlainTokens } from "./deployKeys.ts";
import { deploysLayer } from "./deploys.ts";
import { doorLayer } from "./door.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { healthRoute } from "./health.ts";
import { Leader, leaderLayer } from "./leader.ts";
import { loopWatchLayer } from "./loopWatch.ts";
import { personGitCredentialsLayer } from "./personGitCredentials.ts";
import { mateCredentialsLayer } from "./mateCredentials.ts";
import { mateAccessLayer } from "./mateAccess.ts";
import { mateOverviewsLayer } from "./mateOverviews.ts";
import type { Migration } from "./migrations.ts";
import { officialLayer } from "./official.ts";
import { recomputesLayer } from "./recomputes.ts";
import { recipeTiersLayer } from "./recipeTiers.ts";
import { releasesLayer } from "./releases.ts";
import { rolloutsLayer } from "./rollouts.ts";
import { doorRateLimitLayer } from "./rateLimit.ts";
import { writesLayer } from "./writes.ts";
import { rolesLayer } from "./roles.ts";
import { sessionsLayer } from "./sessions.ts";
import {
  LiveSockets,
  liveSocketsLayer,
  mateLinkTicketsLayer,
  streamTicketsLayer,
} from "./stream.ts";
import { structureLayer } from "./structure.ts";
import { autoUpdatePolicyLayer } from "./autoUpdate.ts";

export interface CoreOptions {
  readonly databaseUrl: Redacted.Redacted;
  /** Where the bare repositories live: the volume's `/mnt/vol/git` in the container. */
  readonly gitRoot: string;
  /** Where a backup set is staged, the store it is kept in, and how often (`backup.ts`). */
  readonly backup: Omit<BackupOptions, "databaseUrl">;
  readonly migrations: ReadonlyArray<Migration>;
  readonly hqProjectId: string;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  /** `HQ_KEY_SECRET`, the key HQ seals its environments' deploy tokens with (`deployKeys.ts`). */
  readonly keySecret: Option.Option<Redacted.Redacted>;
  readonly build: string;
  /** How long the server still answers after the lead is given up on shutdown; 10 s. */
  readonly drainFor?: Duration.Duration;
  /** Shorter intervals, for tests. */
  readonly heartbeat?: Duration.Duration;
  readonly retryAfter?: Duration.Duration;
  readonly officialRecheck?: Duration.Duration;
  readonly viewTtl?: Duration.Duration;
  readonly reconcileEvery?: Duration.Duration;
  readonly streamRecheck?: Duration.Duration;
  readonly pingEvery?: Duration.Duration;
}

const routes = (options: CoreOptions) =>
  Layer.mergeAll(
    healthRoute(options.build),
    apiRoutes({
      build: options.build,
      ...(options.streamRecheck === undefined ? {} : { recheck: options.streamRecheck }),
      ...(options.pingEvery === undefined ? {} : { pingEvery: options.pingEvery }),
      link: {
        ...(options.pingEvery === undefined ? {} : { pingEvery: options.pingEvery }),
        ...(options.streamRecheck === undefined ? {} : { recheck: options.streamRecheck }),
      },
    }),
  );

const services = (options: CoreOptions) => {
  const keySecret = keySecretOf(options.keySecret);
  const leader = leaderLayer({
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    afterMigrations: sealPlainTokens(keySecret),
    ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  }).pipe(
    Layer.provideMerge(
      officialLayer({
        projectId: options.hqProjectId,
        credential: options.credential,
        ...(options.officialRecheck === undefined ? {} : { recheck: options.officialRecheck }),
      }),
    ),
  );
  return Layer.mergeAll(
    autoUpdatePolicyLayer,
    sessionsLayer,
    observationLayer,
    personGitCredentialsLayer,
    structureLayer({
      hqProjectId: options.hqProjectId,
      credential: options.credential,
      reconcileEvery: options.reconcileEvery ?? Duration.seconds(60),
    }),
    doorLayer({ hqProjectId: options.hqProjectId }),
    mateCredentialsLayer({ credential: options.credential }),
    streamTicketsLayer,
    mateLinkTicketsLayer,
    writesLayer,
    liveSocketsLayer,
    mateAccessLayer,
    loopWatchLayer,
    recomputesLayer,
    backupLayer({ databaseUrl: options.databaseUrl, ...options.backup }).pipe(
      Layer.provideMerge(
        deploysLayer().pipe(
          Layer.provideMerge(releasesLayer),
          Layer.provide(recipeTiersLayer),
          Layer.provideMerge(changesLayer),
        ),
      ),
      Layer.provideMerge(gitHostLayer({ rootDir: options.gitRoot })),
    ),
  )
    .pipe(
      Layer.provideMerge(usageLedgerLayer),
      Layer.provideMerge(mateOverviewsLayer),
      // One set of buckets for the API's addresses and the door's people.
      Layer.provideMerge(doorRateLimitLayer),
      Layer.provideMerge(leader),
      Layer.provideMerge(deployKeysLayer(keySecret)),
      Layer.provideMerge(rolloutsLayer),
      // Below the leader: its official check reads the org through the view every reader shares.
      Layer.provideMerge(
        rolesLayer({
          hqProjectId: options.hqProjectId,
          credential: options.credential,
          ...(options.viewTtl === undefined ? {} : { viewTtl: options.viewTtl }),
        }),
      ),
      Layer.provideMerge(
        PgClient.layer({ url: options.databaseUrl, applicationName: "hq", maxConnections: 4 }),
      ),
    )
    .pipe((base) =>
      hqScopesLayer(options.build, options.streamRecheck).pipe(
        Layer.provideMerge(
          Layer.mergeAll(hqOperationReaderLayer, hqUsageReaderLayer).pipe(Layer.provideMerge(base)),
        ),
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
