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
 * - `POST /api/mate/ai-key` `{ provider? }` with `Authorization: Mate <credential>` → `HqMateAiKey`:
 *   the organization's key, for the Mate's zcp to put in its project's vault; `404 no_key` while
 *   none is kept.
 *
 * @module automationApi
 */
import { HqAiKeyRequest, HqIntakeRequest } from "@t3tools/shared/hqIntake";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as HttpServerRequest from "effect/http/HttpServerRequest";

import { BODY_LIMIT, handle, json, jsonBody, mate, principal } from "./api.ts";
import { Intake } from "./intake.ts";
import { OrgAiKeys } from "./orgAiKeys.ts";
import { Writes } from "./writes.ts";

const MateAiKeyBody = Schema.Struct({ provider: Schema.optionalKey(Schema.String) });

const appParam = Effect.map(HttpRouter.params, (params) => params["appId"] ?? "");
const providerParam = Effect.map(HttpRouter.params, (params) => params["provider"] ?? "");

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
