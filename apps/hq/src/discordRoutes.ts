/**
 * Discord's routes (`discord.ts`), beside HQ's API (`api.ts`), answered and refused as its routes
 * are (`AutomationRefused`):
 *
 * - `GET /api/org/discord` → `HqDiscordView`; `PUT` `HqDiscordConnectRequest` → `HqDiscordView`,
 *   `DELETE` → `204`, by an owner or admin of the organization; `PUT /api/org/discord/allow`
 *   `HqDiscordAllowRequest` → `HqDiscordView`, who may ask Mate there.
 * - `GET /api/apps/:appId/discord` → `HqChannelView` (`404 not_found` while none is set); `PUT`
 *   `HqChannelRequest` → `HqChannelView`, `DELETE` → `204`, by a structure writer: the channel the
 *   application takes tasks from.
 * - `POST /api/intake/discord/:publicId`: Discord's interaction, limited per address. Past 64 KiB
 *   `413`; no connection there `404`; a signature that does not hold `401 unauthorized`; one HQ
 *   cannot read `400`; else `200` with Discord's answer.
 *
 * @module discordRoutes
 */
import {
  HqChannelRequest,
  HqDiscordAllowRequest,
  HqDiscordConnectRequest,
} from "@t3tools/shared/hqIntake";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { BODY_LIMIT, TooLarge, handle, json, jsonBody, knock, principal } from "./api.ts";
import { DISCORD_INTERACTIONS_PATH, Discord } from "./discord.ts";
import { Writes } from "./writes.ts";

const appParam = Effect.map(HttpRouter.params, (params) => params["appId"] ?? "");

/** An interaction is a few KiB; its bytes as they came, which its signature covers. */
const INTERACTION_LIMIT = 64 * 1024;
const interactionBytes = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > INTERACTION_LIMIT)
    return yield* new TooLarge();
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(INTERACTION_LIMIT)),
  );
  if (body.byteLength > INTERACTION_LIMIT) return yield* new TooLarge();
  return new Uint8Array(body);
});

/** A write's work, outliving its client, by the person asking. */
const written = <A, E, R>(write: (userId: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* (yield* Writes).outliving(
      Effect.flatMap(principal, ({ userId }) => write(userId)),
    );
  });

export const discordRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/org/discord",
    handle(
      Effect.gen(function* () {
        yield* principal;
        return json(yield* (yield* Discord).view, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/org/discord",
    handle(
      Effect.gen(function* () {
        const request = yield* jsonBody(HqDiscordConnectRequest, BODY_LIMIT);
        const discord = yield* Discord;
        return json(yield* written((userId) => discord.connect(userId, request)), 200);
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/org/discord",
    handle(
      Effect.gen(function* () {
        const discord = yield* Discord;
        yield* written((userId) => discord.disconnect(userId));
        return HttpServerResponse.empty({ status: 204 });
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/org/discord/allow",
    handle(
      Effect.gen(function* () {
        const request = yield* jsonBody(HqDiscordAllowRequest, BODY_LIMIT);
        const discord = yield* Discord;
        return json(yield* written((userId) => discord.allow(userId, request)), 200);
      }),
    ),
  ),
  HttpRouter.add(
    "GET",
    "/api/apps/:appId/discord",
    handle(
      Effect.gen(function* () {
        yield* principal;
        const channel = yield* (yield* Discord).channelOf(yield* appParam);
        return channel === undefined ? json({ code: "not_found" }, 404) : json(channel, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/apps/:appId/discord",
    handle(
      Effect.gen(function* () {
        const request = yield* jsonBody(HqChannelRequest, BODY_LIMIT);
        const appId = yield* appParam;
        const discord = yield* Discord;
        return json(yield* written((userId) => discord.keepChannel(userId, appId, request)), 200);
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/apps/:appId/discord",
    handle(
      Effect.gen(function* () {
        const appId = yield* appParam;
        const discord = yield* Discord;
        yield* written((userId) => discord.dropChannel(userId, appId));
        return HttpServerResponse.empty({ status: 204 });
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    `${DISCORD_INTERACTIONS_PATH}/:publicId`,
    handle(
      Effect.gen(function* () {
        yield* knock("intake");
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* interactionBytes;
        const publicId = (yield* HttpRouter.params)["publicId"] ?? "";
        const interacted = yield* (yield* Discord).interact(publicId, {
          signature: request.headers["x-signature-ed25519"],
          timestamp: request.headers["x-signature-timestamp"],
          body,
        });
        switch (interacted.kind) {
          case "unknown":
            return json({ code: "not_found" }, 404);
          case "refused":
            return json({ code: "unauthorized" }, 401);
          case "invalid":
            return json({ code: "invalid" }, 400);
          case "answer":
            return json(interacted.body, 200);
        }
      }),
    ),
  ),
);
