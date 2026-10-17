/**
 * The organization's GitHub app's routes (`githubApp.ts`), beside HQ's API (`api.ts`), answered and
 * refused as its routes are:
 *
 * - `GET /api/org/github` → `HqGithubView`, to any member; `POST /api/org/github/manifest`
 *   `HqGithubManifestRequest` → `HqGithubManifestView` and `DELETE /api/org/github` → `204`, by an
 *   owner or admin of the organization. Never a key or a secret back.
 * - `GET /api/github/app/created?code&state` and `GET /api/github/app/installed?installation_id&
 *   setup_action&state`: where GitHub sends the browser; `302` on, or a plain page saying what
 *   went wrong with the way back to Mate.
 * - `POST /api/github/app/webhook/:publicId`: the app's events, limited per address. Past 25 MiB
 *   `413`; no app there `404`; a signature that does not hold `401 unauthorized`; `ping` `200`;
 *   anything else read `202` at once, worked after.
 * - `PUT /api/apps/:appId/repos/:repo/remote/app` `HqRepoRemoteViaAppRequest` → `204`, by a
 *   structure writer: the repository's remote is one the app reaches, with no token kept; HQ then
 *   follows GitHub's default branch in the background (`GithubMirror.follow`), and the repository
 *   says what it found (`divergedSince` where neither history contains the other).
 *
 * @module githubAppRoutes
 */
import { HqGithubManifestRequest, HqRepoRemoteViaAppRequest } from "@t3tools/shared/hqGithub";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { BODY_LIMIT, TooLarge, handle, json, jsonBody, knock, principal } from "./api.ts";
import {
  GITHUB_APP_EVENT_LIMIT,
  GITHUB_APP_PATH,
  GITHUB_APP_WEBHOOK_PATH,
  GithubApp,
  type GithubAppLanding,
  githubAppPage,
} from "./githubApp.ts";
import { GithubMirror } from "./githubMirror.ts";
import { RemoteRefused, Remotes } from "./repoRemotes.ts";
import { Writes } from "./writes.ts";

/** A delivery's bytes as they came, which its signature covers: at most GitHub's 25 MiB. */
const deliveryBytes = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (Number(request.headers["content-length"] ?? 0) > GITHUB_APP_EVENT_LIMIT)
    return yield* new TooLarge();
  const body = yield* request.arrayBuffer.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(GITHUB_APP_EVENT_LIMIT)),
  );
  if (body.byteLength > GITHUB_APP_EVENT_LIMIT) return yield* new TooLarge();
  return new Uint8Array(body);
});

/** A person's write, outliving its client. */
const written = <A, E, R>(write: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* (yield* Writes).outliving(write);
  });

const landing = (to: GithubAppLanding) =>
  to.kind === "redirect"
    ? HttpServerResponse.redirect(to.url, {
        status: 302,
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      })
    : HttpServerResponse.text(githubAppPage(to.words, to.back), {
        status: to.status,
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
      });

const queryOf = Effect.map(HttpServerRequest.HttpServerRequest, (request) => {
  const params = new URL(request.url, "http://hq").searchParams;
  const read = (name: string) => params.get(name) ?? undefined;
  return read;
});

const remoteParams = Effect.map(HttpRouter.params, (params) => ({
  appId: params["appId"] ?? "",
  repo: params["repo"] ?? "",
}));

export const githubAppRoutes = Layer.mergeAll(
  HttpRouter.add(
    "GET",
    "/api/org/github",
    handle(
      Effect.gen(function* () {
        yield* principal;
        return json(yield* (yield* GithubApp).view, 200);
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    "/api/org/github/manifest",
    handle(
      Effect.gen(function* () {
        const request = yield* jsonBody(HqGithubManifestRequest, BODY_LIMIT);
        return yield* written(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            return json(yield* (yield* GithubApp).manifest(userId, request), 200);
          }),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "DELETE",
    "/api/org/github",
    handle(
      written(
        Effect.gen(function* () {
          const { userId } = yield* principal;
          yield* (yield* GithubApp).forget(userId);
          return HttpServerResponse.empty({ status: 204 });
        }),
      ),
    ),
  ),
  HttpRouter.add(
    "GET",
    `${GITHUB_APP_PATH}/created`,
    handle(
      Effect.gen(function* () {
        yield* knock("intake");
        const read = yield* queryOf;
        return landing(
          yield* written(
            Effect.gen(function* () {
              return yield* (yield* GithubApp).created(read("code"), read("state"));
            }),
          ),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "GET",
    `${GITHUB_APP_PATH}/installed`,
    handle(
      Effect.gen(function* () {
        yield* knock("intake");
        const read = yield* queryOf;
        return landing(
          yield* written(
            Effect.gen(function* () {
              return yield* (yield* GithubApp).installed({
                installationId: read("installation_id"),
                setupAction: read("setup_action"),
                state: read("state"),
              });
            }),
          ),
        );
      }),
    ),
  ),
  HttpRouter.add(
    "POST",
    `${GITHUB_APP_WEBHOOK_PATH}/:publicId`,
    handle(
      Effect.gen(function* () {
        yield* knock("intake");
        const request = yield* HttpServerRequest.HttpServerRequest;
        const body = yield* deliveryBytes;
        const publicId = (yield* HttpRouter.params)["publicId"] ?? "";
        const received = yield* (yield* GithubApp).receive(publicId, {
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
            return json({}, 202);
        }
      }),
    ),
  ),
  HttpRouter.add(
    "PUT",
    "/api/apps/:appId/repos/:repo/remote/app",
    handle(
      Effect.gen(function* () {
        const { repository } = yield* jsonBody(HqRepoRemoteViaAppRequest, BODY_LIMIT);
        const ref = yield* remoteParams;
        return yield* written(
          Effect.gen(function* () {
            const { userId } = yield* principal;
            const reached = yield* (yield* GithubApp)
              .reach(repository)
              .pipe(Effect.mapError(() => new RemoteRefused({ reason: "app_unavailable" })));
            if (reached === undefined)
              return yield* new RemoteRefused({ reason: "app_not_installed" });
            yield* (yield* Remotes).connectViaApp(userId, ref, reached);
            // Connected whatever GitHub's side says now: HQ follows it after answering, and what
            // it finds shows on the repository (`divergedSince`).
            yield* (yield* GithubMirror).follow(ref.appId, ref.repo);
            return HttpServerResponse.empty({ status: 204 });
          }),
        );
      }),
    ),
  ),
);
