/** Test-only composition of the real Core layers with configurable Deploys timings.
 * Production coreApp hard-codes deploysLayer(); retain its graph and real routes/services here
 * until Core exposes that option. Default startCore still uses production coreApp unchanged.
 */
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { apiRoutes } from "../../src/api.ts";
import { backupLayer } from "../../src/backup.ts";
import { changesLayer } from "../../src/changes.ts";
import { deployKeysLayer, keySecretOf, sealPlainTokens } from "../../src/deployKeys.ts";
import { deploysLayer, type DeploysOptions } from "../../src/deploys.ts";
import { doorLayer } from "../../src/door.ts";
import { gitHostLayer } from "../../src/gitHost.ts";
import { healthRoute } from "../../src/health.ts";
import { leaderLayer } from "../../src/leader.ts";
import { loopWatchLayer } from "../../src/loopWatch.ts";
import { personGitCredentialsLayer } from "../../src/personGitCredentials.ts";
import { mateCredentialsLayer } from "../../src/mateCredentials.ts";
import { mateAccessLayer } from "../../src/mateAccess.ts";
import { mateOverviewsLayer } from "../../src/mateOverviews.ts";
import { observationLayer } from "../../src/observation.ts";
import { officialLayer } from "../../src/official.ts";
import { recomputesLayer } from "../../src/recomputes.ts";
import { recipeTiersLayer } from "../../src/recipeTiers.ts";
import { releasesLayer } from "../../src/releases.ts";
import { rolloutsLayer } from "../../src/rollouts.ts";
import { doorRateLimitLayer } from "../../src/rateLimit.ts";
import { writesLayer } from "../../src/writes.ts";
import { rolesLayer } from "../../src/roles.ts";
import { sessionsLayer } from "../../src/sessions.ts";
import { liveSocketsLayer, mateLinkTicketsLayer, streamTicketsLayer } from "../../src/stream.ts";
import { structureLayer } from "../../src/structure.ts";

import { drainLayer, type CoreOptions } from "../../src/core.ts";

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

const services = (
  options: CoreOptions,
  deployTimings: Pick<DeploysOptions, "followFor" | "pollEvery">,
) => {
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
    sessionsLayer,
    observationLayer,
    personGitCredentialsLayer,
    structureLayer({
      hqProjectId: options.hqProjectId,
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
        deploysLayer(deployTimings).pipe(
          Layer.provideMerge(releasesLayer),
          Layer.provide(recipeTiersLayer),
          Layer.provideMerge(changesLayer),
        ),
      ),
      Layer.provideMerge(gitHostLayer({ rootDir: options.gitRoot })),
    ),
  ).pipe(
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
  );
};

/**
 * The whole Core. Built in this order — services, the served routes, the drain — so it ends in the
 * reverse: the drain first, while the routes still answer.
 */
export const coreWithDeployTimings = (
  options: CoreOptions,
  deployTimings: Pick<DeploysOptions, "followFor" | "pollEvery">,
) =>
  drainLayer(options.drainFor ?? Duration.seconds(10)).pipe(
    Layer.provide(HttpRouter.serve(routes(options))),
    Layer.provideMerge(services(options, deployTimings)),
  );
