// @effect-diagnostics nodeBuiltinImport:off — this is the Node entry point
// itself; `node:http` is the concrete server NodeHttpServer.layer wraps.
/**
 * Node entry point for the relay. Builds the same `RelayApi` over
 * `@effect/platform-node`'s HTTP server, backed by direct Postgres — the
 * Cloudflare Worker shell (`worker.ts`, deleted) is gone; the API surface and
 * business logic underneath are unchanged.
 *
 * Config comes entirely from environment variables (`effect/Config` reads
 * `process.env` by default on Node). `PORT` defaults to 8080, `DATABASE_URL`
 * is required (see `db.ts`), `ZEROPS_API_HOST` defaults to
 * `api.app-prg1.zerops.io`.
 */
import * as NodeHttp from "node:http";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiScalar from "effect/unstable/httpapi/HttpApiScalar";

import { httpHeaderRedactionLayer } from "@t3tools/shared/httpObservability";
import { RelayApi } from "@t3tools/contracts/relay";

import {
  healthApi,
  linkApi,
  metadataApi,
  mobileApi,
  relayClientAuthLayer,
  relayCors,
  relayDocsRedirectRoute,
  relayDpopClientAuthLayer,
  relayEnvironmentAuthLayer,
  relayNotFoundRoute,
  serverApi,
  tokenApi,
  traceRelayHttpRequest,
} from "./http/Api.ts";
import * as AgentActivityPublisher from "./agentActivity/AgentActivityPublisher.ts";
import * as AgentActivityRows from "./agentActivity/AgentActivityRows.ts";
import * as ApnsClient from "./agentActivity/ApnsClient.ts";
import * as ApnsDeliveries from "./agentActivity/ApnsDeliveries.ts";
import * as ApnsDeliveryJobs from "./agentActivity/ApnsDeliveryJobStore.ts";
import * as ApnsDeliveryQueue from "./agentActivity/ApnsDeliveryQueue.ts";
import * as ApnsDeliveryWorker from "./agentActivity/ApnsDeliveryWorker.ts";
import * as ApnsProviderTokens from "./agentActivity/ApnsProviderTokens.ts";
import * as DeliveryAttempts from "./agentActivity/DeliveryAttempts.ts";
import * as Devices from "./agentActivity/Devices.ts";
import * as LiveActivities from "./agentActivity/LiveActivities.ts";
import * as MobileRegistrations from "./agentActivity/MobileRegistrations.ts";
import * as DpopProofs from "./auth/DpopProofs.ts";
import * as RelayTokens from "./auth/RelayTokens.ts";
import * as RelayConfiguration from "./Config.ts";
import * as RelayDb from "./db.ts";
import * as EnvironmentCredentials from "./environments/EnvironmentCredentials.ts";
import * as EnvironmentLinker from "./environments/EnvironmentLinker.ts";
import * as EnvironmentLinks from "./environments/EnvironmentLinks.ts";
import * as EnvironmentPublishSignatures from "./environments/EnvironmentPublishSignatures.ts";

// Node exposes the Web Crypto API globally (`globalThis.crypto`); Effect's
// `Crypto` service just needs to be pointed at it — the same construction the
// Cloudflare Worker build used, since Workers expose the same global.
const webcryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.promise(async () => {
        const input = new Uint8Array(data.length);
        input.set(data);
        return new Uint8Array(await globalThis.crypto.subtle.digest(algorithm, input.buffer));
      }),
  }),
);

const relayApiLayer = Layer.mergeAll(
  healthApi,
  metadataApi,
  mobileApi,
  linkApi,
  tokenApi,
  serverApi,
);

const configLayer = Layer.unwrap(
  Effect.gen(function* () {
    // The public HTTPS origin this relay is reachable at — feeds the `iss`/
    // `aud` claims on every relay-signed JWT. Set explicitly in deployment
    // (the container's public Zerops subdomain); defaults to a local origin
    // so `pnpm dev` works without configuration.
    const relayIssuer = yield* Config.String("RELAY_ISSUER").pipe(
      Config.withDefault("http://localhost:8080"),
    );
    const apnsEnvironment = yield* Config.schema(
      RelayConfiguration.ApnsEnvironment,
      "APNS_ENVIRONMENT",
    );
    const apnsTeamId = yield* Config.String("APNS_TEAM_ID");
    const apnsKeyId = yield* Config.String("APNS_KEY_ID");
    const apnsBundleId = yield* Config.String("APNS_BUNDLE_ID");
    const apnsPrivateKey = yield* Config.Redacted("APNS_PRIVATE_KEY");
    const apnsDeliveryJobSigningSecret = yield* Config.Redacted("APNS_DELIVERY_JOB_SIGNING_SECRET");
    const cloudMintPrivateKey = yield* Config.Redacted("CLOUD_MINT_PRIVATE_KEY");
    const cloudMintPublicKey = yield* Config.String("CLOUD_MINT_PUBLIC_KEY");
    const zeropsApiHost = yield* Config.String("ZEROPS_API_HOST").pipe(Config.withDefault(""));

    return RelayConfiguration.layer({
      relayIssuer,
      apns: {
        environment: apnsEnvironment,
        teamId: apnsTeamId,
        keyId: apnsKeyId,
        bundleId: apnsBundleId,
        privateKey: apnsPrivateKey,
      },
      apnsDeliveryJobSigningSecret,
      zeropsApiHost,
      cloudMintPrivateKey,
      cloudMintPublicKey,
    });
  }),
);

// Split across two `.pipe()` chains: `pipe`'s overloads top out at 20 arguments.
const runtimeLayer = Layer.empty
  .pipe(
    Layer.provideMerge(MobileRegistrations.layer),
    Layer.provideMerge(AgentActivityPublisher.layer),
    Layer.provideMerge(EnvironmentLinker.layer),
    Layer.provideMerge(EnvironmentPublishSignatures.layer),
    Layer.provideMerge(DpopProofs.layer),
    Layer.provideMerge(ApnsDeliveries.layer),
    Layer.provideMerge(ApnsClient.layer.pipe(Layer.provideMerge(ApnsProviderTokens.layer))),
    Layer.provideMerge(ApnsDeliveryQueue.layerDbQueue),
    Layer.provideMerge(ApnsDeliveryJobs.layer),
    Layer.provideMerge(AgentActivityRows.layer),
    Layer.provideMerge(Devices.layer),
  )
  .pipe(
    Layer.provideMerge(EnvironmentCredentials.layer),
    Layer.provideMerge(EnvironmentLinks.layer),
    Layer.provideMerge(LiveActivities.layer),
    Layer.provideMerge(DeliveryAttempts.layer),
    Layer.provideMerge(RelayTokens.layer),
    Layer.provideMerge(RelayDb.RelayTransactions.layer),
    Layer.provideMerge(RelayDb.layer),
    Layer.provideMerge(configLayer),
    Layer.provideMerge(webcryptoLayer),
    Layer.provideMerge(FetchHttpClient.layer),
  );

const appLayer = relayApiLayer.pipe(
  Layer.provideMerge(relayClientAuthLayer),
  Layer.provideMerge(relayDpopClientAuthLayer),
  Layer.provideMerge(relayEnvironmentAuthLayer),
  Layer.provide(runtimeLayer),
);

// The queue consumer and cron of the Cloudflare build become plain
// long-running fibers: one worker loop per process (see ApnsDeliveryWorker),
// forked alongside the HTTP server rather than invoked by a platform trigger.
const backgroundWorkLayer = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.all([ApnsDeliveryWorker.workerLoop, ApnsDeliveryWorker.prunerLoop], {
      concurrency: "unbounded",
    }),
  ),
).pipe(Layer.provide(runtimeLayer));

const routerLayer = Layer.mergeAll(
  HttpApiBuilder.layer(RelayApi, { openapiPath: "/openapi.json" }).pipe(Layer.provide(appLayer)),
  HttpApiScalar.layer(RelayApi, { path: "/docs" }),
  relayDocsRedirectRoute,
  relayNotFoundRoute,
).pipe(Layer.provide(relayCors));

const port = Config.Port("PORT").pipe(Config.withDefault(8080));
const host = Config.String("HOST").pipe(Config.withDefault("0.0.0.0"));

const HttpServerLive = Layer.unwrap(
  Effect.gen(function* () {
    return NodeHttpServer.layer(() => NodeHttp.createServer(), {
      host: yield* host,
      port: yield* port,
    });
  }),
);

const serveLayer = Layer.merge(
  HttpRouter.serve(routerLayer, {
    middleware: (effect) =>
      traceRelayHttpRequest(effect).pipe(Effect.provide(httpHeaderRedactionLayer)),
  }).pipe(Layer.provideMerge(HttpServerLive), Layer.provideMerge(FetchHttpClient.layer)),
  backgroundWorkLayer,
);

Layer.launch(serveLayer).pipe(Effect.scoped, NodeRuntime.runMain);
