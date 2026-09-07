/**
 * ZeropsIdentity - proves that the caller of a Zerops access token may use
 * this container's project, and reports who they are.
 *
 * Two reads against the public Zerops REST API, both with the caller's own
 * token and never with the container's:
 *
 * 1. `GET /project/{projectId}` - project visibility and role overrides. The status code
 *    is three-way: `200` visible, `403 insufficientPermissions` non-member,
 *    `401 notAuthorized` bad token. A project id this account cannot see never
 *    blurs with one that does not exist: a wrong id answers `400
 *    projectNotFound` (measured 2026-08-28, `verified.md` S0.1).
 * 2. `GET /user/info` - the caller's user id, and the role from the
 *    `clientUserList` entry whose `clientId` equals the project's. Matching on
 *    "has any org" would be wrong: a user can sit in several orgs.
 *
 * The token is a parameter and a request header and nothing else. It is never
 * stored, logged, annotated onto a span, or carried in a failure payload.
 *
 * @module ZeropsIdentity
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import type { ZeropsEnvironment } from "./ZeropsEnvironment.ts";

/** The caller holds a valid token but cannot operate this project. */
export class ZeropsNotAMemberError extends Schema.TaggedErrorClass<ZeropsNotAMemberError>()(
  "ZeropsNotAMemberError",
  {},
) {}

/** The presented token is not a valid Zerops credential. */
export class ZeropsInvalidTokenError extends Schema.TaggedErrorClass<ZeropsInvalidTokenError>()(
  "ZeropsInvalidTokenError",
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

export type ZeropsIdentityError =
  | ZeropsNotAMemberError
  | ZeropsInvalidTokenError
  | ZeropsProjectNotFoundError
  | ZeropsApiUnavailableError;

/** Who the caller is, once membership is proven. */
export interface ZeropsMember {
  /** The Zerops user id - the `subject` of every session minted for them. */
  readonly userId: string;
  /** The organisation that owns the project. */
  readonly clientId: string;
  /** Effective project role, including overrides that lower organization access. */
  readonly role: "OWNER" | "ADMIN" | "BASIC_USER";
}

const ProjectResponse = Schema.Struct({
  clientId: Schema.String,
  userRoles: Schema.optional(
    Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
  ),
});

const UserInfoResponse = Schema.Struct({
  id: Schema.optional(Schema.String),
  clientUserList: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        clientId: Schema.String,
        userId: Schema.optional(Schema.String),
        roleCode: Schema.optional(Schema.String),
      }),
    ),
  ),
});

const decodeProject = Schema.decodeUnknownEffect(ProjectResponse);
const decodeUserInfo = Schema.decodeUnknownEffect(UserInfoResponse);

const unavailable = (reason: string) => new ZeropsApiUnavailableError({ reason });

/**
 * One authenticated GET against the Zerops REST API. Transport failures and
 * malformed bodies collapse into {@link ZeropsApiUnavailableError}; the status
 * code is handed to the caller so each endpoint can read it its own way.
 */
const zeropsGet = Effect.fn("ZeropsIdentity.get")(function* (input: {
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

const readJson = (response: HttpClientResponse.HttpClientResponse) =>
  response.json.pipe(
    Effect.catchCause(() => Effect.fail(unavailable("The Zerops API returned a malformed body."))),
  );

/**
 * Verifies that the presented Zerops access token belongs to a member of this
 * container's project, and resolves that member's identity.
 */
export const verifyProjectMembership = Effect.fn("ZeropsIdentity.verifyProjectMembership")(
  function* (input: { readonly environment: ZeropsEnvironment; readonly token: string }) {
    const { apiBaseUrl, projectId } = input.environment;
    const projectResponse = yield* zeropsGet({
      url: `${apiBaseUrl}/project/${encodeURIComponent(projectId)}`,
      token: input.token,
    });
    switch (projectResponse.status) {
      case 200:
        break;
      case 401:
        return yield* new ZeropsInvalidTokenError({});
      case 403:
        return yield* new ZeropsNotAMemberError({});
      case 400:
      case 404:
        return yield* new ZeropsProjectNotFoundError({});
      default:
        return yield* unavailable(
          `The Zerops API answered ${String(projectResponse.status)} for the project read.`,
        );
    }
    const project = yield* readJson(projectResponse).pipe(
      Effect.flatMap((body) => decodeProject(body)),
      Effect.catchTag("SchemaError", () =>
        Effect.fail(unavailable("The Zerops project read carried no clientId.")),
      ),
    );

    const userInfoResponse = yield* zeropsGet({
      url: `${apiBaseUrl}/user/info`,
      token: input.token,
    });
    if (userInfoResponse.status === 401) return yield* new ZeropsInvalidTokenError({});
    if (userInfoResponse.status === 403) return yield* new ZeropsNotAMemberError({});
    if (userInfoResponse.status !== 200) {
      return yield* unavailable(
        `The Zerops API answered ${String(userInfoResponse.status)} for the user read.`,
      );
    }
    const userInfo = yield* readJson(userInfoResponse).pipe(
      Effect.flatMap((body) => decodeUserInfo(body)),
      Effect.catchTag("SchemaError", () =>
        Effect.fail(unavailable("The Zerops user read was not in the expected shape.")),
      ),
    );

    // The org entry for THIS project decides the role. A user can belong to
    // several organisations, so "has any org" would be the wrong match.
    const membership = userInfo.clientUserList?.find(
      (entry) => entry.clientId === project.clientId,
    );
    const userId = userInfo.id ?? membership?.userId;
    if (userId === undefined || userId.length === 0) {
      return yield* unavailable("The Zerops user read carried no user id.");
    }
    if (!membership) return yield* new ZeropsNotAMemberError({});
    if (project.userRoles?.length && !membership.id) {
      return yield* unavailable(
        "The Zerops membership carried no id for resolving project overrides.",
      );
    }
    // A project override can lower organization permissions as well as grant
    // them. Visibility alone does not authorize an agent or terminal.
    const role =
      project.userRoles?.find((entry) => entry.clientUserId === membership.id)?.roleCode ??
      membership.roleCode;
    if (role !== "OWNER" && role !== "ADMIN" && role !== "BASIC_USER") {
      return yield* new ZeropsNotAMemberError({});
    }

    return {
      userId,
      clientId: project.clientId,
      role,
    } satisfies ZeropsMember;
  },
);
