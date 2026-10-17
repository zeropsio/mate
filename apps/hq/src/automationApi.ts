/**
 * Automated Mates' routes (`orgAiKeys.ts`), beside HQ's API (`api.ts`), answered and refused as its
 * routes are (`AutomationRefused`):
 *
 * - `GET /api/org/ai-keys` → `HqAiKeyView[]`: each provider, whether the organization keeps its
 *   key, since when; `PUT /api/org/ai-keys/:provider` `HqAiKeyRequest` → `HqAiKeyView`, `DELETE` →
 *   `204`, by an owner or admin of the organization.
 * - `PUT /api/apps/:appId/intake` `HqIntakeRequest` → `HqIntakeView`, `DELETE` → `204`: where the
 *   application's automated Mates take tasks from (`intake.ts`), by a structure writer; the secret
 *   to paste is answered only where HQ could not make the webhook (no-store).
 * - `POST /api/intake/github/:publicId`: GitHub's delivery to an intake's webhook, limited per
 *   address. Past 1 MiB `413`; no intake there `404`; a signature that does not hold `401
 *   unauthorized`, whatever was wrong with it; `ping` `200`; anything else read `202`.
 * - `POST /api/mate/ai-key` `{ provider? }` with `Authorization: Mate <credential>` → `HqMateAiKey`:
 *   the organization's key, for the Mate's zcp to put in its project's vault; `404 no_key` while
 *   none is kept.
 *
 * @module automationApi
 */
import { HqAiKeyRequest, HqIntakeRequest } from "@t3tools/shared/hqIntake";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { BODY_LIMIT, TooLarge, handle, json, jsonBody, knock, mate, principal } from "./api.ts";
import { INTAKE_WEBHOOK_PATH, Intake } from "./intake.ts";
import { MateTasks } from "./mateTasks.ts";
import { OrgAiKeys } from "./orgAiKeys.ts";
import { Writes } from "./writes.ts";

const MateAiKeyBody = Schema.Struct({ provider: Schema.optionalKey(Schema.String) });

const appParam = Effect.map(HttpRouter.params, (params) => params["appId"] ?? "");
const providerParam = Effect.map(HttpRouter.params, (params) => params["provider"] ?? "");

/** GitHub's own cap on a webhook's payload is 25 MB; an issue's event is far below 1 MiB. */
const DELIVERY_LIMIT = 1024 * 1024;

/** A delivery's bytes as they came, which its signature covers: at most 1 MiB. */
const deliveryBytes = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > DELIVERY_LIMIT) return yield* new TooLarge();
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(DELIVERY_LIMIT)),
  );
  if (body.byteLength > DELIVERY_LIMIT) return yield* new TooLarge();
  return new Uint8Array(body);
});

/** No cache keeps an answer that carries a key. */
const NO_STORE = { "cache-control": "no-store" };

export const automationRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/org/ai-keys",
    handle(
      Effect.gen(function* () {
        yield* principal;
        return json(yield* (yield* OrgAiKeys).list, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/org/ai-keys/:provider",
    handle(
      Effect.gen(function* () {
        const { value } = yield* jsonBody(HqAiKeyRequest, BODY_LIMIT);
        return yield* (yield* Writes).outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const provider = yield* providerParam;
            const view = yield* (yield* OrgAiKeys).keep(userId, provider, Redacted.make(value));
            return json(view, 200);
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/org/ai-keys/:provider",
    handle(
      Effect.gen(function* () {
        return yield* (yield* Writes).outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            yield* (yield* OrgAiKeys).forget(userId, yield* providerParam);
            return HttpServerResponse.empty({ status: 204 });
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/apps/:appId/intake",
    handle(
      Effect.gen(function* () {
        const request = yield* jsonBody(HqIntakeRequest, BODY_LIMIT);
        return yield* (yield* Writes).outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const view = yield* (yield* Intake).keep(userId, yield* appParam, request);
            return HttpServerResponse.jsonUnsafe(view, { status: 200, headers: NO_STORE });
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/apps/:appId/intake",
    handle(
      Effect.gen(function* () {
        return yield* (yield* Writes).outliving(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            yield* (yield* Intake).stop(userId, yield* appParam);
            return HttpServerResponse.empty({ status: 204 });
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    `${INTAKE_WEBHOOK_PATH}/:publicId`,
    handle(
      Effect.gen(function* () {
        yield* knock("intake");
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* deliveryBytes;
        const publicId = (yield* HttpRouter.params)["publicId"] ?? "";
        const received = yield* (yield* Intake).receive(publicId, {
          event: request.headers["x-github-event"],
          id: request.headers["x-github-delivery"],
          signature: request.headers["x-hub-signature-256"],
          body,
        });
        switch (received.kind) {
          case "unknown":
            return json({ code: "not_found" }, 404);
          case "refused":
            return json({ code: "unauthorized" }, 401);
          case "invalid":
            return json({ code: "invalid" }, 400);
          case "ping":
            return json({}, 200);
          case "taken":
            if (received.moved) yield* (yield* MateTasks).wake;
            return json({}, 202);
        }
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/api/mate/ai-key",
    handle(
      Effect.gen(function* () {
        yield* mate;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { provider } =
          Number(request.headers["content-length"] ?? 0) > 0
            ? yield* jsonBody(MateAiKeyBody, BODY_LIMIT)
            : {};
        return HttpServerResponse.jsonUnsafe(yield* (yield* OrgAiKeys).forMate(provider), {
          status: 200,
          headers: NO_STORE,
        });
      }),
    ),
  ),
);
