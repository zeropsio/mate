/**
 * Verifies a presented Zerops access token and resolves the caller's Zerops
 * user id — the relay's replacement for Clerk session/OAuth verification.
 *
 * One authenticated read against the Zerops REST API, with the caller's own
 * token: `GET /user/info`. Unlike the mate door
 * (`apps/server/src/zerops/ZeropsIdentity.ts`), this has no fixed project to
 * check membership against — the relay serves every project, so "who is
 * this" and "are they a member of project X" are separate questions.
 * Membership of a specific project is `ZeropsProjectBinding`'s job, asked
 * only where it matters (linking an environment).
 *
 * The token is a parameter and a request header and nothing else: never
 * stored, logged, annotated onto a span, or carried in a failure payload.
 *
 * @module zerops/ZeropsAuth
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

/** The presented token is not a valid Zerops credential. */
export class ZeropsInvalidTokenError extends Schema.TaggedErrorClass<ZeropsInvalidTokenError>()(
  "ZeropsInvalidTokenError",
  {},
) {}

/** The platform could not be reached, or answered something unusable. */
export class ZeropsApiUnavailableError extends Schema.TaggedErrorClass<ZeropsApiUnavailableError>()(
  "ZeropsApiUnavailableError",
  {
    reason: Schema.String,
  },
) {}

export type ZeropsAuthError = ZeropsInvalidTokenError | ZeropsApiUnavailableError;

/** The default public Zerops API host every project answers on unless told otherwise. */
export const DEFAULT_ZEROPS_API_HOST = "api.app-prg1.zerops.io";
const ZEROPS_API_PATH_PREFIX = "/api/rest/public";

/**
 * Turns a host into the REST base URL. An empty value means production; a
 * bare host gains `https://`; a value that already carries a scheme keeps
 * it. Mirrors `apps/server/src/zerops/ZeropsEnvironment.ts`'s
 * `resolveZeropsApiBaseUrl` (this app cannot import that one — different
 * deployable — so the ~10 lines are ported, not shared).
 */
export const resolveZeropsApiBaseUrl = (apiHost: string | undefined): string => {
  const trimmed = apiHost?.trim() ?? "";
  const withScheme =
    trimmed.length === 0
      ? `https://${DEFAULT_ZEROPS_API_HOST}`
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
  return `${withScheme.replace(/\/+$/, "")}${ZEROPS_API_PATH_PREFIX}`;
};

const UserInfoResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
});
const decodeUserInfo = Schema.decodeUnknownEffect(UserInfoResponse);

const unavailable = (reason: string) => new ZeropsApiUnavailableError({ reason });

/** Who the caller is, once their token is proven valid. */
export interface ZeropsPrincipal {
  readonly userId: string;
}

/**
 * `GET /user/info` with the caller's own token: `200` resolves their Zerops
 * user id, `401` the token is not valid, anything else means the platform
 * could not be reached or answered something unusable.
 */
export const verifyBearerToken = Effect.fn("ZeropsAuth.verifyBearerToken")(function* (input: {
  readonly apiBaseUrl: string;
  readonly token: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* httpClient
    .get(`${input.apiBaseUrl}/user/info`, {
      headers: {
        authorization: `Bearer ${input.token}`,
        accept: "application/json",
      },
    })
    .pipe(
      Effect.catchCause(() => Effect.fail(unavailable("The Zerops API could not be reached."))),
    );
  if (response.status === 401) {
    return yield* new ZeropsInvalidTokenError({});
  }
  if (response.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${String(response.status)} for the user read.`,
    );
  }
  const body = yield* response.json.pipe(
    Effect.catchCause(() => Effect.fail(unavailable("The Zerops API returned a malformed body."))),
  );
  const userInfo = yield* decodeUserInfo(body).pipe(
    Effect.catchTag("SchemaError", () =>
      Effect.fail(unavailable("The Zerops user read was not in the expected shape.")),
    ),
  );
  if (userInfo.id === undefined || userInfo.id.length === 0) {
    return yield* unavailable("The Zerops user read carried no user id.");
  }
  return { userId: userInfo.id } satisfies ZeropsPrincipal;
});
