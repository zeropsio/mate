/**
 * The write half of {@link ./zeropsApiRead.ts}: one authenticated `POST`,
 * one authenticated `DELETE`, against the same Zerops REST API, sharing that
 * module's failure vocabulary. Kept separate from `zeropsApiRead.ts` because
 * that module's own header scopes itself to reads; every write this server
 * makes goes through here instead.
 *
 * A token is a parameter and a request header. It is never stored, logged,
 * annotated onto a span, or carried in a failure payload.
 *
 * @module zeropsApiWrite
 */
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { unavailable } from "./zeropsApiRead.ts";

/**
 * One authenticated POST with a JSON body against the Zerops REST API.
 * Transport failures, a body that cannot be JSON-encoded, and malformed
 * bodies all collapse into {@link ZeropsApiUnavailableError} — the status
 * code is handed to the caller so each endpoint can read it its own way.
 */
export const zeropsPost = Effect.fn("Zerops.apiPost")(function* (input: {
  readonly url: string;
  readonly token: string;
  readonly body: unknown;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const request = yield* HttpClientRequest.post(input.url, {
    headers: {
      authorization: `Bearer ${input.token}`,
      accept: "application/json",
    },
  }).pipe(
    HttpClientRequest.bodyJson(input.body),
    Effect.catchCause(() =>
      Effect.fail(unavailable("The Zerops API request body could not be encoded.")),
    ),
  );
  return yield* httpClient
    .execute(request)
    .pipe(
      Effect.catchCause(() => Effect.fail(unavailable("The Zerops API could not be reached."))),
    );
});

/**
 * One authenticated DELETE against the Zerops REST API. Transport failures
 * collapse into {@link ZeropsApiUnavailableError}, same as {@link zeropsPost}.
 */
export const zeropsDelete = Effect.fn("Zerops.apiDelete")(function* (input: {
  readonly url: string;
  readonly token: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* httpClient
    .del(input.url, {
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/json",
      },
    })
    .pipe(
      Effect.catchCause(() => Effect.fail(unavailable("The Zerops API could not be reached."))),
    );
});
