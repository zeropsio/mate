import * as NodeHttpPlatform from "@effect/platform-node/NodeHttpPlatform";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer";
import * as Etag from "effect/unstable/http/Etag";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import {
  RelayClientAuth,
  RelayClientPrincipal,
  RelayEnvironmentAuth,
  RelayEnvironmentPrincipal,
  RelayApi,
} from "@t3tools/contracts/relay";

import {
  RELAY_HTTP_ROUTER_CONFIG,
  RELAY_REQUEST_DEADLINE_MS,
  relayClientAuthLayer,
  relayCors,
  relayDocsRedirectRoute,
  relayEnvironmentAuthLayer,
  relayNotFoundRoute,
  serverApi,
  traceRelayHttpRequestWith,
  withoutCapturedParentSpan,
} from "./Api.ts";
import * as RelayConfiguration from "../Config.ts";
import * as AgentActivityPublisher from "../agentActivity/AgentActivityPublisher.ts";
import * as EnvironmentCredentials from "../environments/EnvironmentCredentials.ts";
import * as EnvironmentPublishSignatures from "../environments/EnvironmentPublishSignatures.ts";

const relaySettings: RelayConfiguration.RelayConfiguration["Service"] = {
  relayIssuer: "https://relay.example.test",
  apns: {
    teamId: "apns-team",
    keyId: "apns-key",
    privateKey: Redacted.make("apns-private-key"),
    bundleId: "com.example.t3",
    environment: "sandbox",
  },
  zeropsApiHost: "relay-test.zerops.invalid",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-delivery-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-mint-private-key"),
  cloudMintPublicKey: "cloud-mint-public-key",
};

function fakeZeropsHttpClientLayer(route: (url: string) => Response) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url))),
    ),
  );
}

const clientAuthRequest = () =>
  HttpServerRequest.fromWeb(new Request("https://relay.test/v1/client/environment-links"));

describe("relay client authentication", () => {
  it.effect("resolves the caller's Zerops user id from a valid bearer token", () => {
    let seenPrincipal: { readonly userId: string; readonly token: string } | null = null;
    return Effect.gen(function* () {
      const auth = yield* RelayClientAuth;
      yield* auth.clientBearer(
        Effect.gen(function* () {
          const { userId, token } = yield* RelayClientPrincipal;
          seenPrincipal = { userId, token };
          return HttpServerResponse.empty();
        }),
        { credential: Redacted.make("zerops-token"), endpoint: {} as never, group: {} as never },
      );

      expect(seenPrincipal).toEqual({ userId: "user_zerops", token: "zerops-token" });
    }).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, clientAuthRequest()),
      Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      Effect.provideService(HttpRouter.RouteContext, { params: {}, route: {} as never }),
      Effect.provide(
        relayClientAuthLayer.pipe(
          Layer.provide(RelayConfiguration.layer(relaySettings)),
          Layer.provide(
            fakeZeropsHttpClientLayer((url) =>
              url.endsWith("/user/info")
                ? new Response(JSON.stringify({ id: "user_zerops" }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  })
                : new Response(null, { status: 500 }),
            ),
          ),
        ),
      ),
      Effect.scoped,
    );
  });

  it.effect("rejects an invalid bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* RelayClientAuth;
      const error = yield* Effect.flip(
        auth.clientBearer(Effect.succeed(HttpServerResponse.empty()), {
          credential: Redacted.make("bad-token"),
          endpoint: {} as never,
          group: {} as never,
        }),
      );

      expect(error).toMatchObject({ _tag: "RelayAuthInvalidError", reason: "invalid_bearer" });
    }).pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, clientAuthRequest()),
      Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      Effect.provideService(HttpRouter.RouteContext, { params: {}, route: {} as never }),
      Effect.provide(
        relayClientAuthLayer.pipe(
          Layer.provide(RelayConfiguration.layer(relaySettings)),
          Layer.provide(fakeZeropsHttpClientLayer(() => new Response(null, { status: 401 }))),
        ),
      ),
      Effect.scoped,
    ),
  );
});

describe("relay environment authentication", () => {
  it.effect("preserves credential lookup persistence failures as internal errors", () => {
    const failure = new EnvironmentCredentials.EnvironmentCredentialAuthenticatePersistenceError({
      stage: "lookup-credential",
      cause: "database unavailable",
    });
    const credentials: EnvironmentCredentials.EnvironmentCredentials["Service"] = {
      create: () => Effect.die("unused create"),
      authenticate: () => Effect.fail(failure),
    };

    return Effect.gen(function* () {
      const auth = yield* RelayEnvironmentAuth;
      const error = yield* Effect.flip(
        auth.environmentBearer(Effect.succeed(HttpServerResponse.empty()), {
          credential: Redacted.make("environment-credential"),
          endpoint: {} as never,
          group: {} as never,
        }),
      );

      expect(Predicate.isTagged(error, "RelayInternalError")).toBe(true);
      if (Predicate.isTagged(error, "RelayInternalError")) {
        expect(error.reason).toBe("persistence_failed");
      }
    }).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("https://relay.test/v1/server/link")),
      ),
      Effect.provideService(HttpServerRequest.ParsedSearchParams, {}),
      Effect.provideService(HttpRouter.RouteContext, {
        params: {},
        route: {} as never,
      }),
      Effect.provide(
        relayEnvironmentAuthLayer.pipe(
          Layer.provide(Layer.succeed(EnvironmentCredentials.EnvironmentCredentials, credentials)),
        ),
      ),
      Effect.scoped,
    );
  });
});

describe("relay request tracing", () => {
  it.effect(
    "does not parent endpoint spans to an ambient parent captured while building handlers",
    () =>
      Effect.gen(function* () {
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const ambientParent = Tracer.externalSpan({
          traceId: "00000000000000000000000000000001",
          spanId: "0000000000000001",
          sampled: true,
        });
        const endpoint = yield* withoutCapturedParentSpan(
          Effect.context<never>().pipe(
            Effect.map((capturedContext: Context.Context<never>) =>
              Effect.succeed(HttpServerResponse.empty({ status: 204 })).pipe(
                Effect.withSpan("relay.test.endpoint"),
                Effect.provideContext(capturedContext),
              ),
            ),
          ),
        ).pipe(Effect.provideService(Tracer.ParentSpan, ambientParent));
        const request = HttpServerRequest.fromWeb(
          new Request("https://relay.test/v1/mobile/devices?client=mobile", {
            method: "POST",
            headers: {
              authorization: "Bearer secret",
              dpop: "signed-proof",
            },
          }),
        );

        yield* traceRelayHttpRequestWith(endpoint, Layer.succeed(Tracer.Tracer, tracer)).pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );

        expect(spans.map((span) => span.name)).toEqual(["http.server POST", "relay.test.endpoint"]);
        expect(spans[0]?.kind).toBe("server");
        expect(spans[0]?.attributes.get("url.path")).toBe("/v1/mobile/devices");
        expect(spans[0]?.attributes.get("http.response.status_code")).toBe(204);
        expect(spans[0]?.attributes.get("http.request.header.authorization")).toBe("<redacted>");
        expect(spans[0]?.attributes.get("http.request.header.dpop")).toBe("<redacted>");
        expect(Option.isNone(spans[0]!.parent)).toBe(true);
        expect(Option.getOrUndefined(spans[1]!.parent)?.spanId).toBe(spans[0]?.spanId);
      }),
  );

  it.effect("fails hung requests with a 504 before the client's 10s abort", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      const request = HttpServerRequest.fromWeb(
        new Request("https://relay.test/v1/mobile/devices", { method: "POST" }),
      );

      const fiber = yield* traceRelayHttpRequestWith(
        Effect.never,
        Layer.succeed(Tracer.Tracer, tracer),
      ).pipe(Effect.provideService(HttpServerRequest.HttpServerRequest, request), Effect.forkChild);
      yield* TestClock.adjust(Duration.millis(RELAY_REQUEST_DEADLINE_MS));
      const response = yield* Fiber.join(fiber);

      expect(response.status).toBe(504);
      expect(spans[0]?.attributes.get("relay.request.deadline_exceeded")).toBe(true);
      expect(spans[0]?.attributes.get("http.response.status_code")).toBe(504);
    }),
  );
});

describe("relay routing fallback", () => {
  it.effect("publishes activity for escaped delegated thread IDs longer than 100 characters", () =>
    Effect.gen(function* () {
      const environmentId = "environment-1";
      const environmentPublicKey = "environment-public-key";
      const published: Array<
        Parameters<AgentActivityPublisher.AgentActivityPublisher["Service"]["publish"]>[0]
      > = [];
      const verified: Array<
        Parameters<
          EnvironmentPublishSignatures.EnvironmentPublishSignatures["Service"]["verify"]
        >[0]
      > = [];
      const publisher = Layer.succeed(AgentActivityPublisher.AgentActivityPublisher, {
        publish: (input) =>
          Effect.sync(() => {
            published.push(input);
            return { ok: true as const, deliveries: [] };
          }),
        replayForLiveActivityRegistration: () => Effect.succeed(null),
      });
      const signatures = Layer.succeed(EnvironmentPublishSignatures.EnvironmentPublishSignatures, {
        verify: (input) =>
          Effect.sync(() => {
            verified.push(input);
          }),
      });
      const auth = Layer.succeed(RelayEnvironmentAuth, {
        environmentBearer: (effect) =>
          effect.pipe(
            Effect.provideService(RelayEnvironmentPrincipal, {
              environmentId,
              environmentPublicKey,
            }),
          ),
      });
      const routes = HttpApiBuilder.layer(
        HttpApi.make("RelayApi").add(RelayApi.groups.server),
      ).pipe(
        Layer.provide(serverApi.pipe(Layer.provide([publisher, signatures]))),
        Layer.provide(auth),
        Layer.provide([NodeServices.layer, NodeHttpPlatform.layer, Etag.layerWeak]),
      );
      const httpEffect = yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(routes, relayNotFoundRoute, relayCors),
      ).pipe(Effect.provideService(HttpRouter.RouterConfig, RELAY_HTTP_ROUTER_CONFIG));
      const threadIds = [
        "b7c8c522-d244-43dc-875f-7224fce79912",
        "t".repeat(512),
        "thread:delegated-task:command%3Amcp%3Ab7c8c522-d244-43dc-875f-7224fce79912%3Adelegate-task%3Agreet-subagent-20260813",
      ];
      for (const threadId of threadIds) {
        const request = HttpServerRequest.fromWeb(
          new Request(
            `https://relay.test/v1/environments/${environmentId}/threads/${encodeURIComponent(threadId)}/agent-activity`,
            {
              method: "POST",
              headers: {
                authorization: "Bearer environment-credential",
                "content-type": "application/json",
              },
              body: '{"state":null,"proof":"signed-proof"}',
            },
          ),
        );
        const response = yield* httpEffect.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, request),
        );
        expect(response.status).toBe(200);
      }
      expect(published).toEqual(
        threadIds.map((threadId) => ({
          environmentId,
          environmentPublicKey,
          threadId,
          state: null,
        })),
      );
      expect(verified.map((input) => input.threadId)).toEqual(threadIds);
    }).pipe(Effect.scoped),
  );

  it.effect("redirects the relay root to the API docs", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(new Request("https://relay.test/"));
      const httpEffect = yield* HttpRouter.toHttpEffect(
        Layer.mergeAll(relayDocsRedirectRoute, relayNotFoundRoute, relayCors),
      );
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe("/docs");
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }).pipe(Effect.scoped),
  );

  it.effect("returns a CORS-compatible 404 response for unmatched paths", () =>
    Effect.gen(function* () {
      const request = HttpServerRequest.fromWeb(
        new Request("https://relay.test/v1/environmentsd", { method: "GET" }),
      );
      const httpEffect = yield* HttpRouter.toHttpEffect(Layer.merge(relayNotFoundRoute, relayCors));
      const response = yield* httpEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
      );

      expect(response.status).toBe(404);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
    }).pipe(Effect.scoped),
  );
});
