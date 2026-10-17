/**
 * Slack's routes (`slack.ts`), beside HQ's API (`api.ts`), answered and refused as its routes are
 * (`AutomationRefused`):
 *
 * - `GET /api/org/slack` → `HqSlackView`, to any member; `PUT` `HqSlackConnectRequest` →
 *   `HqSlackView` and `DELETE` → `204`, by an owner or admin of the organization; never the token
 *   or the secret back. `GET /api/org/slack/manifest` → the Slack app's manifest, by the same.
 * - `GET /api/apps/:appId/slack` → `HqChannelView` (`null` while none); `PUT` `HqChannelRequest` →
 *   `HqChannelView` and `DELETE` → `204`, by a structure writer.
 * - `POST /api/intake/slack/:publicId`: Slack's event, limited per address. Past 1 MiB `413`; no
 *   connection there `404`; a signature that does not hold `401 unauthorized`, whatever was wrong
 *   with it; Slack's URL check `200 { challenge }`; anything else read `200` at once, worked after.
 *
 * @module slackRoutes
 */
import { HqChannelRequest, HqSlackConnectRequest } from "@t3tools/shared/hqIntake";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { BODY_LIMIT, TooLarge, handle, json, jsonBody, knock, principal } from "./api.ts";
import { SLACK_EVENTS_PATH, Slack } from "./slack.ts";
import { Writes } from "./writes.ts";

const appParam = Effect.map(HttpRouter.params, (params) => params["appId"] ?? "");

/** Slack's events are a few KiB; 1 MiB is far past any. */
const EVENT_LIMIT = 1024 * 1024;

/** An event's bytes as they came, which its signature covers: at most 1 MiB. */
const eventBytes = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > EVENT_LIMIT) return yield* new TooLarge();
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(EVENT_LIMIT)),
  );
  if (body.byteLength > EVENT_LIMIT) return yield* new TooLarge();
  return new Uint8Array(body);
});

/** A person's write, outliving its client. */
const written = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* (yield* Writes).outliving(write);
  });

/** Slack's events: answered within its three seconds, worked after (`Slack.receive`). */
export const slackEventsRoute = HttpRouter.add(
  "POST",
  `${SLACK_EVENTS_PATH}/:publicId`,
  handle(
    Effect.gen(function* () {
      yield* knock("intake");
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = yield* eventBytes;
      const publicId = (yield* HttpRouter.params)["publicId"] ?? "";
      const received = yield* (yield* Slack).receive(publicId, {
        timestamp: request.headers["x-slack-request-timestamp"],
        signature: request.headers["x-slack-signature"],
        body,
      });
      switch (received.kind) {
        case "unknown":
          return json({ code: "not_found" }, 404);
        case "refused":
          return json({ code: "unauthorized" }, 401);
        case "invalid":
          return json({ code: "invalid" }, 400);
        case "challenge":
          return json({ challenge: received.challenge }, 200);
        case "taken":
          return json({}, 200);
      }
    }),
  ),
);

export const slackRoutes = Layer.mergeAll(
  slackEventsRoute,
  HttpRouter.add(
    "GET",
    "/api/org/slack",
    handle(
      Effect.gen(function* () {
        yield* principal;
        return json(yield* (yield* Slack).view, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/org/slack",
    handle(
      Effect.gen(function* () {
        const { botToken, signingSecret } = yield* jsonBody(HqSlackConnectRequest, BODY_LIMIT);
        return yield* written(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const view = yield* (yield* Slack).connect(userId, {
              botToken: Redacted.make(botToken),
              signingSecret: Redacted.make(signingSecret),
            });
            return json(view, 200);
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/org/slack",
    handle(
      written(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          yield* (yield* Slack).disconnect(userId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/api/org/slack/manifest",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        return json(yield* (yield* Slack).manifest(userId), 200);
      }),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/api/apps/:appId/slack",
    handle(
      Effect.gen(function* () {
        yield* principal;
        return json((yield* (yield* Slack).channelOf(yield* appParam)) ?? null, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/apps/:appId/slack",
    handle(
      Effect.gen(function* () {
        const { channelId } = yield* jsonBody(HqChannelRequest, BODY_LIMIT);
        return yield* written(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            return json(yield* (yield* Slack).mapChannel(userId, yield* appParam, channelId), 200);
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/apps/:appId/slack",
    handle(
      written(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          yield* (yield* Slack).unmapChannel(userId, yield* appParam);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  ),
);
