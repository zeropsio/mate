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
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/http/HttpRouter";

import { apiRoutes } from "./api.ts";
import { chiefsLayer } from "./chief.ts";
import { chiefRoutes } from "./chiefApi.ts";
import { automationRoutes } from "./automationApi.ts";
import { discordLayer } from "./discord.ts";
import { discordApiLayer } from "./discordApi.ts";
import { discordRoutes } from "./discordRoutes.ts";
import { slackLayer } from "./slack.ts";
import { slackApiLayer } from "./slackApi.ts";
import { slackRoutes } from "./slackRoutes.ts";
import { orgAiKeysLayer } from "./orgAiKeys.ts";
import { intakeLayer } from "./intake.ts";
import { type MateTasksOptions, mateTasksLayer } from "./mateTasks.ts";
import { appTasksLayer } from "./appTasks.ts";
import { githubIssuesLayer } from "./githubIssues.ts";
import { githubChannelLayer } from "./githubChannel.ts";
import { githubGateLayer } from "./githubGate.ts";
import { githubAppLayer } from "./githubApp.ts";
import { githubAppRoutes } from "./githubAppRoutes.ts";
import { githubEventsLayer } from "./githubEvents.ts";
import { type GithubMirror, githubMirrorLayer } from "./githubMirror.ts";
import { type PullRequestsOptions, pullRequestsLayer } from "./pullRequests.ts";
import { taskIntakeLayer, taskSourceChannelsLayer } from "./taskIntake.ts";
import { taskLimitsLayer } from "./taskLimits.ts";
import { webhooksLayer } from "./webhooks.ts";
import { schedulesLayer } from "./schedules.ts";
import { proposalDecisionsLayer } from "./proposals.ts";
import { type BackupOptions, backupLayer } from "./backup.ts";
import { changesLayer } from "./changes.ts";
import { deployKeysLayer, keySecretOf, sealPlainTokens } from "./deployKeys.ts";
import { deploysLayer } from "./deploys.ts";
import { doorLayer } from "./door.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { type HealthObserver, healthRoute } from "./health.ts";
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
import { repoRemotesLayer } from "./repoRemotes.ts";
import { githubProbesLayer } from "./githubProbes.ts";
import { gitTransportLayer } from "./gitTransport.ts";
import { gitReleasesLayer } from "./releases.ts";
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
import { reconcileEnvironmentIdentity, structureLayer } from "./structure.ts";
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
  /** In-process health stage receipts for test readiness diagnostics. */
  readonly observeHealth?: HealthObserver;
  /** How long the server still answers after the lead is given up on shutdown; 10 s. */
  readonly drainFor?: Duration.Duration;
  /** GitHub's REST API for issues and webhooks, for tests; GitHub's own by default. */
  readonly githubApi?: string;
  /**
   * The git mirror to GitHub as a test stands it in, for a test of what is built on it without
   * git on the fake GitHub's side; the real one (`githubMirrorLayer`) by default.
   */
  readonly githubMirror?: Layer.Layer<GithubMirror, never, SqlClient.SqlClient>;
  /** How often every open change's pull request is looked at (`pullRequests.ts`); for tests. */
  readonly pullRequests?: PullRequestsOptions;
  /** Discord's REST API, for tests; Discord's own by default. */
  readonly discordApi?: string;
  /** Slack's Web API, for tests; Slack's own by default. */
  readonly slackApi?: string;
  /** How long a task's steps may take and how often HQ looks at them (`mateTasks.ts`); for tests. */
  readonly tasks?: MateTasksOptions;
  /** How often the leading Core looks for schedules due (`schedules.ts`); 30 s. */
  readonly scheduleEvery?: Duration.Duration;
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
    healthRoute(options.build, options.observeHealth),
    chiefRoutes,
    automationRoutes,
    discordRoutes,
    slackRoutes,
    githubAppRoutes,
    apiRoutes({
      build: options.build,
      hqProjectId: options.hqProjectId,
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
  // The organization's GitHub app: its tokens (`GithubAuth`) and its webhook's events, one of each.
  const githubApp = githubAppLayer({
    hqProjectId: options.hqProjectId,
    ...(options.githubApi === undefined ? {} : { api: options.githubApi }),
  }).pipe(Layer.provide(NodeHttpClient.layerNodeHttp), Layer.provideMerge(githubEventsLayer));
  const remotes = repoRemotesLayer.pipe(
    Layer.provide(
      githubProbesLayer.pipe(
        Layer.provide(gitTransportLayer.pipe(Layer.provide(NodeHttpClient.layerNodeHttp))),
      ),
    ),
    Layer.provide(githubApp),
  );
  const leader = leaderLayer({
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    afterMigrations: Effect.andThen(reconcileEnvironmentIdentity, sealPlainTokens(keySecret)),
    ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  }).pipe(
    Layer.provideMerge(
      officialLayer({
        projectId: options.hqProjectId,
        credential: options.credential,
        ...(options.officialRecheck === undefined
          ? {}
          : { recheck: options.officialRecheck, recheckOk: options.officialRecheck }),
      }),
    ),
  );
  const github = githubIssuesLayer(options.githubApi).pipe(
    Layer.provide(NodeHttpClient.layerNodeHttp),
  );
  // Tasks from every source come in through one door (`taskIntake.ts`); each source's channel
  // registers itself (`githubChannel.ts`), and `mateTasks.ts` says through it how a task moves.
  const tasks = mateTasksLayer(options.tasks).pipe(
    Layer.provide(orgAiKeysLayer),
    Layer.provide(taskSourceChannelsLayer),
    Layer.provide(githubApp),
  );
  const door = taskIntakeLayer.pipe(Layer.provideMerge(tasks));
  // GitHub's default branch upstream for repositories mirrored through the app: one, as the app;
  // it tells a task's Mate what people added to its change on GitHub.
  const mirror =
    options.githubMirror ??
    githubMirrorLayer().pipe(Layer.provide(githubApp), Layer.provide(tasks));
  const sources = Layer.mergeAll(
    door,
    appTasksLayer.pipe(Layer.provide(door)),
    intakeLayer({ hqProjectId: options.hqProjectId }).pipe(
      Layer.provide(door),
      Layer.provide(githubGateLayer),
    ),
    githubChannelLayer,
    pullRequestsLayer(options.pullRequests).pipe(
      Layer.provide(door),
      Layer.provide(githubGateLayer),
    ),
    webhooksLayer({ hqProjectId: options.hqProjectId }).pipe(Layer.provide(door)),
    schedulesLayer(
      options.scheduleEvery === undefined ? {} : { every: options.scheduleEvery },
    ).pipe(Layer.provide(door)),
    slackLayer({ hqProjectId: options.hqProjectId }).pipe(
      Layer.provide(
        slackApiLayer(options.slackApi).pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
      ),
      Layer.provide(door),
    ),
    discordLayer({ hqProjectId: options.hqProjectId, keySecret }).pipe(
      Layer.provide(
        discordApiLayer(options.discordApi).pipe(Layer.provide(NodeHttpClient.layerNodeHttp)),
      ),
      Layer.provide(door),
    ),
  ).pipe(
    Layer.provide(remotes),
    Layer.provide(githubApp),
    Layer.provide(mirror),
    Layer.provideMerge(github),
    Layer.provideMerge(taskSourceChannelsLayer),
  );
  return Layer.mergeAll(
    autoUpdatePolicyLayer,
    orgAiKeysLayer,
    taskLimitsLayer,
    sources,
    githubApp,
    mirror,
    sessionsLayer,
    observationLayer,
    personGitCredentialsLayer,
    remotes,
    doorLayer({ hqProjectId: options.hqProjectId }),
    mateCredentialsLayer({ credential: options.credential }),
    proposalDecisionsLayer.pipe(
      Layer.provideMerge(
        chiefsLayer({ hqProjectId: options.hqProjectId, credential: options.credential }),
      ),
    ),
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
          Layer.provideMerge(gitReleasesLayer.pipe(Layer.provide(remotes))),
          Layer.provide(recipeTiersLayer),
          Layer.provide(githubApp),
        ),
      ),
    ),
  )
    .pipe(
      Layer.provideMerge(
        structureLayer({
          hqProjectId: options.hqProjectId,
          credential: options.credential,
          reconcileEvery: options.reconcileEvery ?? Duration.seconds(60),
        }),
      ),
      Layer.provideMerge(changesLayer),
      Layer.provideMerge(gitHostLayer({ rootDir: options.gitRoot })),
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
        PgClient.layer({
          url: options.databaseUrl,
          applicationName: "hq",
          maxConnections: 4,
          // HQ's reads are small and frequent: JIT never pays for itself here, and a read whose
          // estimate crosses its threshold is compiled on every run (navigation on CI went from
          // ~20 ms to ~600–1000 ms per tab before its subqueries became joins).
          startupParameters: { jit: "off" },
        }),
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
