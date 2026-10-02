/**
 * Core's routes and the services they run on, one composition for `main.ts` and the tests. The
 * routes take their services per request, so they are provided after `HttpRouter.serve` (or merged
 * into the layer a test's `toWebHandler` builds). What the services still need is the Zerops port
 * (`ZeropsApi`): HTTP in production, the fake in tests.
 *
 * @module core
 */
import * as PgClient from "@effect/sql-pg/PgClient";
import type * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

import { apiRoutes } from "./api.ts";
import { doorLayer } from "./door.ts";
import { healthRoute } from "./health.ts";
import { leaderLayer } from "./leader.ts";
import type { Migration } from "./migrations.ts";
import { officialLayer } from "./official.ts";
import { rolesLayer } from "./roles.ts";
import { doorRateLimitLayer } from "./rateLimit.ts";
import { sessionsLayer } from "./sessions.ts";
import { structureLayer } from "./structure.ts";

export interface CoreOptions {
  readonly databaseUrl: Redacted.Redacted;
  readonly migrations: ReadonlyArray<Migration>;
  readonly hqProjectId: string;
  /** This Core's public address (`zeropsSubdomain`). */
  readonly address: string | undefined;
  /** `HQ_ORG_TOKEN`. */
  readonly credential: Option.Option<Redacted.Redacted>;
  readonly clientOrigins: ReadonlyArray<string>;
  readonly build: string;
  /** Shorter leader intervals, for tests. */
  readonly heartbeat?: Duration.Duration;
  readonly retryAfter?: Duration.Duration;
}

export const coreRoutes = (options: Pick<CoreOptions, "build" | "clientOrigins">) =>
  Layer.mergeAll(healthRoute(options.build), apiRoutes({ clientOrigins: options.clientOrigins }));

export const coreServices = (options: CoreOptions) => {
  const leader = leaderLayer({
    databaseUrl: options.databaseUrl,
    migrations: options.migrations,
    ...(options.heartbeat === undefined ? {} : { heartbeat: options.heartbeat }),
    ...(options.retryAfter === undefined ? {} : { retryAfter: options.retryAfter }),
  }).pipe(
    Layer.provideMerge(
      officialLayer({
        projectId: options.hqProjectId,
        address: options.address,
        credential: options.credential,
      }),
    ),
  );
  return Layer.mergeAll(
    sessionsLayer,
    structureLayer({ hqProjectId: options.hqProjectId }),
    doorLayer({ hqProjectId: options.hqProjectId }),
    doorRateLimitLayer,
  ).pipe(
    Layer.provideMerge(
      rolesLayer({ hqProjectId: options.hqProjectId, credential: options.credential }),
    ),
    Layer.provideMerge(leader),
    Layer.provideMerge(
      PgClient.layer({ url: options.databaseUrl, applicationName: "hq", maxConnections: 4 }),
    ),
  );
};
