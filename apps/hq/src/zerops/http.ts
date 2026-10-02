/**
 * ZeropsApi over the REST API. Each request has a time limit; what it answers is classified from
 * the measured refusals (`401` unauthorized, `403` forbidden, `400 *NotFound` not_found, any other
 * `4xx` invalid) or is unavailable (no answer, `429`, `5xx`, a body not in the expected shape). An
 * unavailable read is tried again, a bounded number of times; so is `user/list`'s `400
 * userNotFound`, which the member list answers about once in eight calls for a valid credential
 * (ledger, 2026-09-22) and is no verdict.
 *
 * @module zerops/http
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import {
  type ZeropsApi,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsProject,
  ZeropsRefused,
  ZeropsUnavailable,
} from "./api.ts";
import { parseEnvFile } from "./envFile.ts";

const REQUEST_TIMEOUT = Duration.seconds(10);
/** Up to three more tries, 250 ms apart and doubling. */
const RETRIES = 3;
const BACKOFF = Schedule.exponential(Duration.millis(250));
const PAGE = 100;
const MAX_PAGES = 50;

const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.Struct({ code: Schema.String }) }),
);
const MemberList = Schema.Struct({
  clientUserList: Schema.Array(
    Schema.Struct({
      roleCode: Schema.String,
      status: Schema.String,
      user: Schema.Struct({
        fullName: Schema.String,
        email: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    }),
  ),
});
const ProjectRow = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  tagList: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  userRoles: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(Schema.Struct({ clientUserId: Schema.String, roleCode: Schema.String })),
    ),
  ),
});
const ProjectPage = Schema.Struct({
  list: Schema.Array(ProjectRow),
  total: Schema.optionalKey(Schema.Number),
});
const UserInfo = Schema.Struct({
  id: Schema.String,
  clientUserList: Schema.Array(Schema.Struct({ clientId: Schema.String })),
});
const TokenRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  roleCode: Schema.String,
  canCreateProjects: Schema.Boolean,
  canViewFinances: Schema.Boolean,
  canEditFinances: Schema.Boolean,
  projects: Schema.Array(Schema.Struct({ projectId: Schema.String, roleCode: Schema.String })),
});
const EnvFile = Schema.Struct({ envFile: Schema.String });

/** A member list row is a token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

const toProject = (row: typeof ProjectRow.Type): ZeropsProject => ({
  id: row.id,
  orgId: row.clientId,
  name: row.name,
  status: row.status,
  tags: row.tagList ?? [],
  userRoles: row.userRoles ?? [],
});

const reasonOf = (status: number, code: string): ZeropsRefused["reason"] => {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || code.endsWith("NotFound")) return "not_found";
  return "invalid";
};

export const makeZeropsApiHttp = (
  baseUrl: string,
): Effect.Effect<ZeropsApi["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    /** One GET, decoded; `transient` codes of a `400` are no verdict and read as unavailable. */
    const get = <A>(
      operation: string,
      credential: Redacted.Redacted,
      path: string,
      schema: Schema.Decoder<A>,
      transient: ReadonlyArray<string> = [],
    ): Effect.Effect<A, ZeropsError> => {
      const unavailable = (message: string) => new ZeropsUnavailable({ operation, message });
      const once = Effect.gen(function* () {
        const response = yield* client
          .execute(
            HttpClientRequest.get(`${baseUrl}${path}`).pipe(
              HttpClientRequest.bearerToken(Redacted.value(credential)),
              HttpClientRequest.acceptJson,
            ),
          )
          .pipe(
            Effect.timeout(REQUEST_TIMEOUT),
            Effect.mapError(() => unavailable("The Zerops API could not be reached in time.")),
          );
        const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
        const status = response.status;
        if (status >= 200 && status < 300) {
          return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(() => unavailable("The Zerops API answered an unexpected shape.")),
          );
        }
        const code = Option.match(decodeErrorBody(body), {
          onNone: () => "",
          onSome: (decoded) => decoded.error.code,
        });
        if (status === 429 || status >= 500 || (status === 400 && transient.includes(code))) {
          return yield* unavailable(`The Zerops API answered ${String(status)} ${code}.`);
        }
        return yield* new ZeropsRefused({
          operation,
          reason: reasonOf(status, code),
          status,
          code,
        });
      });
      return once.pipe(
        Effect.retry({
          schedule: BACKOFF,
          times: RETRIES,
          while: (error) => error._tag === "ZeropsUnavailable",
        }),
      );
    };

    const projects = (orgId: string) => (credential: Redacted.Redacted) =>
      Effect.gen(function* () {
        const rows: Array<ZeropsProject> = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const answer = yield* get(
            "projects",
            credential,
            `/client/${orgId}/project?limit=${String(PAGE)}&offset=${String(rows.length)}`,
            ProjectPage,
          );
          rows.push(...answer.list.map(toProject));
          if (answer.list.length === 0 || rows.length >= (answer.total ?? rows.length)) return rows;
        }
        return yield* new ZeropsUnavailable({
          operation: "projects",
          message: `The project list did not end within ${String(MAX_PAGES)} pages.`,
        });
      });

    return {
      members: (orgId) => (credential) =>
        get("members", credential, `/client/${orgId}/user/list`, MemberList, ["userNotFound"]).pipe(
          Effect.map((answer) =>
            answer.clientUserList.map((row): ZeropsMember => ({
              name: row.user.fullName,
              kind: TOKEN_EMAIL.test(row.user.email ?? "") ? "token" : "person",
              roleCode: row.roleCode,
              status: row.status,
            })),
          ),
        ),
      projects,
      project: (projectId) => (credential) =>
        get("project", credential, `/project/${projectId}`, ProjectRow).pipe(Effect.map(toProject)),
      projectEnv: (projectId) => (credential) =>
        get("projectEnv", credential, `/project/${projectId}/env-file`, EnvFile).pipe(
          Effect.map((answer) => parseEnvFile(answer.envFile)),
        ),
      ownToken: (credential) =>
        Effect.gen(function* () {
          const info = yield* get("ownToken", credential, "/user/info", UserInfo);
          const orgId = info.clientUserList[0]?.clientId;
          if (orgId === undefined || info.clientUserList.length !== 1) {
            return yield* new ZeropsRefused({
              operation: "ownToken",
              reason: "invalid",
              status: 200,
              code: "notOneOrg",
            });
          }
          const token = yield* get(
            "ownToken",
            credential,
            `/client/${orgId}/integration-token/${info.id}`,
            TokenRow,
          );
          return { ...token, orgId };
        }),
    };
  });
