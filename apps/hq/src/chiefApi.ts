/**
 * The Chief's routes (`chief.ts`, `proposals.ts`), beside HQ's API (`api.ts`), answered and refused
 * as its routes are:
 *
 * - `GET /api/chief` → `{ chief: { projectId, since } | null }`: the person's own Chief here.
 * - `POST /api/chief` `{ projectId }` → `{ chief, credential, proxyUrl }`: registers it; `403` for
 *   a project that does not open for them or carries no `chief` tag, `409` for another's Chief.
 * - `PUT /api/chief` `{ projectId }` → `{ chief: { projectId, since } }`: the same registration
 *   answered as the shared HQ answers it, with no credential.
 * - `GET /api/proposals?ids=a,b` (at most 100) → `{ decisions }`, those on projects that open for
 *   the person; `PUT /api/proposals/:id` `{ projectId, decision, outcome?, words? }` → the decision
 *   held, `409` for one that would change what is held.
 * - `GET|POST /api/chief/zerops/<path>` with `Authorization: Bearer <Chief credential>`: the
 *   Chief's reads of Zerops (`401` unknown or revoked credential, `405` a method that writes, `403`
 *   a read outside the allowlist or the person's reach, `429` past its limit).
 *
 * @module chiefApi
 */
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { BODY_LIMIT, TooLarge, handle, json, jsonBody, principal } from "./api.ts";
import { CHIEF_PROXY_PATH, Chiefs } from "./chief.ts";
import { ChiefRefused } from "./chiefRefused.ts";
import { PROPOSALS_PER_READ, ProposalAsk, ProposalDecisions, ProposalId } from "./proposals.ts";
import { Writes } from "./writes.ts";

const RegisterBody = Schema.Struct({ projectId: Schema.String });
const decodeIds = Schema.decodeUnknownEffect(
  Schema.Array(ProposalId).check(Schema.isMaxLength(PROPOSALS_PER_READ)),
);
const decodeId = Schema.decodeUnknownEffect(ProposalId);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

/** A search's body: JSON of at most 64 KiB (`413` past it); none for any other method. */
const proxyBody = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    if (request.method !== "POST") return undefined;
    if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT) {
      return yield* new TooLarge();
    }
    const text = yield* request.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(BODY_LIMIT)),
    );
    if (text.length > BODY_LIMIT) return yield* new TooLarge();
    if (text === "") return undefined;
    return yield* decodeJson(text).pipe(
      Effect.mapError(() => new ChiefRefused({ code: "invalid", reason: "not_json" })),
    );
  });

const proxy = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  // The path as it was sent, never resolved: a `..` in it is no read the allowlist knows.
  const [rawPath = "", query = ""] = request.url.split("?", 2);
  const answer = yield* (yield* Chiefs).proxy({
    presented: /^Bearer (\S+)$/u.exec(request.headers["authorization"] ?? "")?.[1],
    // `X-Real-IP` is the client address the Zerops L7 balancer sets.
    address:
      request.headers["x-real-ip"] ?? Option.getOrElse(request.remoteAddress, () => "unknown"),
    method: request.method,
    path: rawPath.slice(CHIEF_PROXY_PATH.length),
    query,
    body: yield* proxyBody(request),
  });
  return answer.kind === "json"
    ? json(answer.body, answer.status)
    : HttpServerResponse.uint8Array(answer.answer.body, {
        status: answer.answer.status,
        contentType: answer.answer.contentType,
      });
});

export const chiefRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/chief",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        return json({ chief: yield* (yield* Chiefs).mine(userId) }, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/api/chief",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        const { projectId } = yield* jsonBody(RegisterBody, BODY_LIMIT);
        const chiefs = yield* Chiefs;
        return yield* (yield* Writes).outliving(
          Effect.map(chiefs.register(userId, projectId), (registered) => json(registered, 200)),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/chief",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        const { projectId } = yield* jsonBody(RegisterBody, BODY_LIMIT);
        const chiefs = yield* Chiefs;
        return yield* (yield* Writes).outliving(
          Effect.map(chiefs.register(userId, projectId), ({ chief }) => json({ chief }, 200)),
        );
      }),
    ),
  ),
  HttpRouter.add("*", `${CHIEF_PROXY_PATH}/*`, handle(proxy)),
  HttpRouter.add(
    "GET",
    "/api/proposals",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        const search = new URL((yield* HttpServerRequest.HttpServerRequest).url, "http://hq")
          .searchParams;
        const ids = yield* decodeIds(
          (search.get("ids") ?? "").split(",").filter((id) => id !== ""),
        );
        return json({ decisions: yield* (yield* ProposalDecisions).read(userId, ids) }, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/proposals/:id",
    handle(
      Effect.gen(function* () {
        const { userId } = yield* principal;
        const id = yield* decodeId((yield* HttpRouter.params)["id"]);
        const ask = yield* jsonBody(ProposalAsk, BODY_LIMIT);
        const decisions = yield* ProposalDecisions;
        return yield* (yield* Writes).outliving(
          Effect.map(decisions.decide(userId, id, ask), (decision) => json(decision, 200)),
        );
      }),
    ),
  ),
);
