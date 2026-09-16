/**
 * The two shapes every Zerops read in this server takes: one authenticated
 * `GET`, and the failures that read can have.
 *
 * Both doors — the one that proves a person and the loop that re-checks them —
 * talk to the same REST API with the same two kinds of credential (the
 * caller's presented token, the Mate's own key) and need the same three
 * verdicts out of a status code: not a credential, not allowed, not reachable.
 * Keeping that in one module is what lets each check read as its rule rather
 * than as error plumbing.
 *
 * A token is a parameter and a request header. It is never stored, logged,
 * annotated onto a span, or carried in a failure payload.
 *
 * @module zeropsApiRead
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

/** The presented token is not a valid Zerops credential. */
export class ZeropsInvalidTokenError extends Schema.TaggedErrorClass<ZeropsInvalidTokenError>()(
  "ZeropsInvalidTokenError",
  {},
) {}

/** The caller holds a valid token but may not operate this project. */
export class ZeropsNotAMemberError extends Schema.TaggedErrorClass<ZeropsNotAMemberError>()(
  "ZeropsNotAMemberError",
  {},
) {}

/** This container is configured with a project id the platform does not know. */
export class ZeropsProjectNotFoundError extends Schema.TaggedErrorClass<ZeropsProjectNotFoundError>()(
  "ZeropsProjectNotFoundError",
  {},
) {}

/** The platform could not be reached, or answered something unusable. */
export class ZeropsApiUnavailableError extends Schema.TaggedErrorClass<ZeropsApiUnavailableError>()(
  "ZeropsApiUnavailableError",
  {
    reason: Schema.String,
  },
) {}

export const unavailable = (reason: string): ZeropsApiUnavailableError =>
  new ZeropsApiUnavailableError({ reason });

/**
 * One authenticated GET against the Zerops REST API. Transport failures and
 * malformed bodies collapse into {@link ZeropsApiUnavailableError}; the status
 * code is handed to the caller so each endpoint can read it its own way.
 */
export const zeropsGet = Effect.fn("Zerops.apiGet")(function* (input: {
  readonly url: string;
  readonly token: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* httpClient
    .get(input.url, {
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/json",
      },
    })
    .pipe(
      Effect.catchCause(() => Effect.fail(unavailable("The Zerops API could not be reached."))),
    );
});

export const readJson = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.catchCause(() => Effect.fail(unavailable("The Zerops API returned a malformed body."))),
  );

/**
 * The API's own wall clock, from the response's `Date` header.
 *
 * Every freshness rule in this server is measured against this and never
 * against the container's clock: a container whose clock has drifted would
 * otherwise lock out every member of its project, and a container whose clock
 * an occupant can set would let a stale credential in. `undefined` when the
 * header is missing or unparseable, which each caller must treat as a reason
 * not to admit rather than as "now".
 */
export const responseDateEpochMs = (
  response: HttpClientResponse.HttpClientResponse,
): number | undefined => {
  const header = response.headers["date"];
  if (header === undefined) return undefined;
  const parsed = Date.parse(header);
  return Number.isFinite(parsed) ? parsed : undefined;
};
