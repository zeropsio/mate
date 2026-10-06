/**
 * ZeropsApi and ZeropsDeploy over the REST API. Each request has a time limit; what it answers is
 * classified from the measured refusals (`401` unauthorized, `403` forbidden, `400 *NotFound`
 * not_found, any other `4xx` invalid) or is unavailable (no answer, `429`, `5xx`, a body not in the
 * expected shape) — as is `user/list`'s `400 userNotFound`, which the member list answers about
 * once in eight calls for a valid credential (ledger, 2026-09-22) and is no verdict. Every request
 * is asked once, a read too (Karel, 2026-10-03): what does not answer is its caller's answer, and a
 * caller that follows a handle reads it again on its own cadence.
 *
 * @module zerops/http
 */
import * as ByteSize from "effect/ByteSize";
import * as HttpIncomingMessage from "effect/unstable/http/HttpIncomingMessage";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import {
  type ZeropsApi,
  type ZeropsObservation,
  type ZeropsDeploy,
  type ZeropsError,
  type ZeropsMember,
  type ZeropsProcess,
  type ZeropsProject,
  ZeropsRefused,
  type ZeropsService,
  ZeropsUnavailable,
} from "./api.ts";
import { parseEnvFile } from "./envFile.ts";

const REQUEST_TIMEOUT = Duration.seconds(10);
/** An archive's upload: a repository's whole tree. */
const UPLOAD_TIMEOUT = Duration.minutes(5);
const PAGE = 100;
const MAX_PAGES = 50;

const decodeErrorBody = Schema.decodeUnknownOption(
  Schema.Struct({ error: Schema.Struct({ code: Schema.String }) }),
);
const MemberList = Schema.Struct({
  clientUserList: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      userId: Schema.String,
      roleCode: Schema.String,
      status: Schema.String,
      canCreateProjects: Schema.Boolean,
      user: Schema.Struct({
        fullName: Schema.String,
        avatarUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
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
  publicZone: Schema.String,
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
  created: Schema.String,
  createdByUser: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const EnvFile = Schema.Struct({ envFile: Schema.String });
const ServiceRow = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  status: Schema.String,
  isSystem: Schema.Boolean,
  subdomainAccess: Schema.Boolean,
  ports: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          scheme: Schema.optionalKey(Schema.NullOr(Schema.String)),
          httpRouting: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
        }),
      ),
    ),
  ),
  userData: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          key: Schema.String,
          content: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  ),
  activeAppVersion: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
});
const ServicePage = Schema.Struct({
  list: Schema.Array(ServiceRow),
  total: Schema.optionalKey(Schema.Number),
});
const Created = Schema.Struct({ id: Schema.String });
const Imported = Schema.Struct({
  serviceStacks: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      processes: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
    }),
  ),
});
const AppVersionRow = Schema.Struct({ status: Schema.String });
const ProcessRow = Schema.Struct({
  status: Schema.Literals(["PENDING", "RUNNING", "FINISHED", "FAILED", "CANCELED"]),
  error: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        code: Schema.optionalKey(Schema.NullOr(Schema.String)),
        message: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

/** A member list row is a token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

/** An HTTP date or an ISO instant, in epoch milliseconds. */
const epochMs = (text: string | undefined): number | undefined =>
  text === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(DateTime.make(text), DateTime.toEpochMillis));

const toProject = (row: typeof ProjectRow.Type): ZeropsProject => ({
  id: row.id,
  orgId: row.clientId,
  name: row.name,
  status: row.status,
  tags: row.tagList ?? [],
  userRoles: row.userRoles ?? [],
  publicZone: row.publicZone,
});

const toService = (row: typeof ServiceRow.Type): ZeropsService => {
  const userData = (key: string) =>
    (row.userData ?? []).find((entry) => entry.key === key)?.content ?? "";
  const namedId = userData("appVersionId");
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    isSystem: row.isSystem,
    subdomainAccess: row.subdomainAccess,
    http: (row.ports ?? []).some(
      (port) => port.httpRouting === true || port.scheme === "http" || port.scheme === "https",
    ),
    named: namedId === "" ? null : { id: namedId, name: userData("appVersionName") },
    activeVersionId: row.activeAppVersion?.id ?? null,
  };
};

const toProcess = (row: typeof ProcessRow.Type): ZeropsProcess => ({
  status: row.status,
  failure:
    row.status === "FAILED" || row.status === "CANCELED"
      ? (row.error?.message ?? row.error?.code ?? null)
      : null,
});

const reasonOf = (status: number, code: string): ZeropsRefused["reason"] => {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410 || code.endsWith("NotFound")) return "not_found";
  return "invalid";
};

/**
 * One request as the credential, answered within `timeout`: its body decoded, with the API's own
 * clock (`Date` header) of the answer — or a verdict, or no answer. `transient` codes of a `400`
 * are no verdict and read as unavailable.
 */
const ask = <A>(
  client: HttpClient.HttpClient,
  operation: string,
  credential: Redacted.Redacted,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Decoder<A>,
  options: {
    readonly timeout?: Duration.Duration;
    readonly transient?: ReadonlyArray<string>;
  } = {},
): Effect.Effect<{ readonly value: A; readonly dateMs: number | undefined }, ZeropsError> =>
  Effect.gen(function* () {
    const unavailable = (message: string) => new ZeropsUnavailable({ operation, message });
    const response = yield* client
      .execute(
        request.pipe(
          HttpClientRequest.bearerToken(Redacted.value(credential)),
          HttpClientRequest.acceptJson,
        ),
      )
      .pipe(
        Effect.timeout(options.timeout ?? REQUEST_TIMEOUT),
        Effect.mapError(() => unavailable("The Zerops API could not be reached in time.")),
      );
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
    const status = response.status;
    if (status >= 200 && status < 300) {
      const value = yield* Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => unavailable("The Zerops API answered an unexpected shape.")),
      );
      return { value, dateMs: epochMs(response.headers["date"]) };
    }
    const code = Option.match(decodeErrorBody(body), {
      onNone: () => "",
      onSome: (decoded) => decoded.error.code,
    });
    if (
      status === 429 ||
      status >= 500 ||
      (status === 400 && (options.transient ?? []).includes(code))
    ) {
      return yield* unavailable(`The Zerops API answered ${String(status)} ${code}.`);
    }
    return yield* new ZeropsRefused({ operation, reason: reasonOf(status, code), status, code });
  });

export const makeZeropsApiHttp = (
  baseUrl: string,
): Effect.Effect<ZeropsApi["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    /** One GET, asked once. */
    const get = <A>(
      operation: string,
      credential: Redacted.Redacted,
      path: string,
      schema: Schema.Decoder<A>,
      transient: ReadonlyArray<string> = [],
    ) =>
      ask(client, operation, credential, HttpClientRequest.get(`${baseUrl}${path}`), schema, {
        transient,
      });

    const projects = (orgId: string) => (credential: Redacted.Redacted) =>
      Effect.gen(function* () {
        const rows: Array<ZeropsProject> = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const { value: answer } = yield* get(
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
          Effect.map(({ value }) =>
            value.clientUserList.map((row): ZeropsMember => ({
              name: row.user.fullName,
              avatarUrl: row.user.avatarUrl ?? null,
              kind: TOKEN_EMAIL.test(row.user.email ?? "") ? "token" : "person",
              roleCode: row.roleCode,
              status: row.status,
              userId: row.userId,
              clientUserId: row.id,
              canCreateProjects: row.canCreateProjects,
            })),
          ),
        ),
      projects,
      project: (projectId) => (credential) =>
        get("project", credential, `/project/${projectId}`, ProjectRow).pipe(
          Effect.map(({ value }) => toProject(value)),
        ),
      projectEnv: (projectId) => (credential) =>
        get("projectEnv", credential, `/project/${projectId}/env-file`, EnvFile).pipe(
          Effect.map(({ value }) => parseEnvFile(value.envFile)),
        ),
      tokenProjects: (orgId, tokenId) => (credential) =>
        get(
          "tokenProjects",
          credential,
          `/client/${orgId}/integration-token/${encodeURIComponent(tokenId)}`,
          TokenRow,
        ).pipe(Effect.map(({ value }) => value.projects)),
      ownToken: (credential) =>
        Effect.gen(function* () {
          const { value: info } = yield* get("ownToken", credential, "/user/info", UserInfo);
          const orgId = info.clientUserList[0]?.clientId;
          if (orgId === undefined || info.clientUserList.length !== 1) {
            return yield* new ZeropsRefused({
              operation: "ownToken",
              reason: "invalid",
              status: 200,
              code: "notOneOrg",
            });
          }
          const { value: token, dateMs } = yield* get(
            "ownToken",
            credential,
            `/client/${orgId}/integration-token/${info.id}`,
            TokenRow,
          );
          return {
            ...token,
            orgId,
            createdMs: epochMs(token.created) ?? Number.NaN,
            createdByUser: token.createdByUser ?? null,
            readAtMs: dateMs,
          };
        }),
      services: (projectId) => (credential) =>
        get(
          "services",
          credential,
          `/project/${projectId}/service-stack?limit=${String(PAGE)}`,
          ServicePage,
        ).pipe(
          Effect.flatMap(({ value }) =>
            value.list.length < (value.total ?? value.list.length)
              ? new ZeropsUnavailable({
                  operation: "services",
                  message: `The project lists more than ${String(PAGE)} services.`,
                })
              : Effect.succeed(value.list.map(toService)),
          ),
        ),
      service: (serviceId) => (credential) =>
        get("service", credential, `/service-stack/${serviceId}`, ServiceRow).pipe(
          Effect.map(({ value }) => toService(value)),
        ),
    };
  });

export const makeZeropsDeployHttp = (
  baseUrl: string,
): Effect.Effect<ZeropsDeploy["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    /** One write, asked once: a second ask could make a second version. */
    const send = <A>(
      operation: string,
      credential: Redacted.Redacted,
      request: HttpClientRequest.HttpClientRequest,
      schema: Schema.Decoder<A>,
      timeout?: Duration.Duration,
    ) =>
      Effect.map(
        ask(
          client,
          operation,
          credential,
          request,
          schema,
          timeout === undefined ? {} : { timeout },
        ),
        ({ value }) => value,
      );
    return {
      createAppVersion: (serviceId, name) => (credential) =>
        send(
          "createAppVersion",
          credential,
          HttpClientRequest.post(`${baseUrl}/service-stack/${serviceId}/app-version`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ name }),
          ),
          Created,
        ).pipe(Effect.map(({ id }) => ({ id }))),
      upload: (appVersionId, archive) => (credential) =>
        send(
          "upload",
          credential,
          HttpClientRequest.put(`${baseUrl}/app-version/${appVersionId}/upload`).pipe(
            HttpClientRequest.bodyUint8Array(archive, "application/octet-stream"),
          ),
          Schema.Unknown,
          UPLOAD_TIMEOUT,
        ).pipe(Effect.asVoid),
      buildAndDeploy: (appVersionId, zeropsYaml, setup) => (credential) =>
        send(
          "buildAndDeploy",
          credential,
          HttpClientRequest.put(`${baseUrl}/app-version/${appVersionId}/build-and-deploy`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ zeropsYaml, zeropsYamlSetup: setup }),
          ),
          Created,
        ).pipe(Effect.map(({ id }) => ({ processId: id }))),
      process: (processId) => (credential) =>
        ask(
          client,
          "process",
          credential,
          HttpClientRequest.get(`${baseUrl}/process/${processId}`),
          ProcessRow,
        ).pipe(Effect.map(({ value }) => toProcess(value))),
      appVersion: (appVersionId) => (credential) =>
        ask(
          client,
          "appVersion",
          credential,
          HttpClientRequest.get(`${baseUrl}/app-version/${appVersionId}`),
          AppVersionRow,
        ).pipe(Effect.map(({ value }) => ({ status: value.status }))),
      enableSubdomainAccess: (serviceId) => (credential) =>
        send(
          "enableSubdomainAccess",
          credential,
          HttpClientRequest.put(`${baseUrl}/service-stack/${serviceId}/enable-subdomain-access`),
          Created,
        ).pipe(Effect.map(({ id }) => ({ processId: id }))),
      importServices: (projectId, yaml) => (credential) =>
        send(
          "importServices",
          credential,
          HttpClientRequest.post(`${baseUrl}/project/${projectId}/service-stack/import`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ yaml }),
          ),
          Imported,
        ).pipe(
          Effect.map(({ serviceStacks }) => ({
            services: serviceStacks.map((stack) => ({
              name: stack.name,
              processes: (stack.processes ?? []).map((process) => process.id),
            })),
          })),
        ),
    };
  });

const LogAccess = Schema.Struct({ url: Schema.String });
const LogPage = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      timestamp: Schema.String,
      severityLabel: Schema.String,
      message: Schema.String,
    }),
  ),
});
const decodeLogs = Schema.decodeUnknownEffect(LogPage);

export const makeZeropsObservationHttp = (
  baseUrl: string,
): Effect.Effect<ZeropsObservation["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return {
      logs: (projectId, serviceId, limit) => (credential) =>
        Effect.gen(function* () {
          const unavailable = () =>
            new ZeropsUnavailable({
              operation: "logs",
              message: "The log backend did not answer usably.",
            });
          const { value: access } = yield* ask(
            client,
            "logs",
            credential,
            HttpClientRequest.get(`${baseUrl}/project/${encodeURIComponent(projectId)}/log`),
            LogAccess,
          );
          const url = yield* Effect.try({
            try: () => {
              const address = access.url.replace(/^GET /u, "");
              const url = new URL(/^https?:\/\//u.test(address) ? address : `https://${address}`);
              if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid scheme");
              url.searchParams.set("serviceStackId", serviceId);
              url.searchParams.set("limit", String(limit));
              url.searchParams.set("desc", "1");
              return url.toString();
            },
            catch: unavailable,
          });
          // The signed address authorizes this GET; the deploy key never goes to the backend.
          const response = yield* client
            .execute(HttpClientRequest.get(url))
            .pipe(Effect.timeout(REQUEST_TIMEOUT), Effect.mapError(unavailable));
          if (response.status !== 200) return yield* unavailable();
          const raw = yield* response.json.pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(1)),
            Effect.mapError(unavailable),
          );
          const page = yield* decodeLogs(raw).pipe(Effect.mapError(unavailable));
          return page.items.slice(0, limit).map((entry) => ({
            timestamp: entry.timestamp,
            severity: entry.severityLabel,
            message: entry.message.slice(0, 4096),
          }));
        }),
      activeVersion: (id) => (credential) =>
        ask(
          client,
          "activeVersion",
          credential,
          HttpClientRequest.get(`${baseUrl}/app-version/${encodeURIComponent(id)}`),
          Schema.Struct({ id: Schema.String, name: Schema.String }),
        ).pipe(Effect.map(({ value }) => value)),
    };
  });
