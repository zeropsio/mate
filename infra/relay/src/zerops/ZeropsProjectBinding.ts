/**
 * Verifies an environment-link proof's Zerops project claim.
 *
 * A link proof is signed by the environment's own key, which proves "this
 * request comes from an environment holding key K" — never that the
 * environment sits inside any particular Zerops project. `zeropsProjectId`
 * and `endpointOrigin` on the proof are the environment's self-reported
 * claim; this module checks that claim against the Zerops API using the
 * *caller's* presented token (never a container credential), the same way
 * the mate door proves membership (`apps/server/src/zerops/ZeropsIdentity.ts`,
 * `../../zcp/docs/spec-mate.md §3.2`):
 *
 * 1. `GET /project/{projectId}` with the caller's token — the membership
 *    check. `200` member, `403` valid token but not a member, `401` invalid
 *    token (surfaces the same as not-a-member: the caller already passed
 *    `RelayClientAuth`, so a 401 here is the platform revoking mid-request,
 *    not a caller mistake worth a different message), `400`/`404` the
 *    relay's caller supplied a project id the platform does not know.
 * 2. `GET /project/{projectId}/service-stack` with the caller's token — is
 *    `endpointOrigin` the public origin of a subdomain-enabled service in
 *    that project? Each candidate's origin is rebuilt from the project's
 *    bare `zeropsSubdomainHost` prefix and the region its `publicZone`
 *    carries (`docs/internals/zerops/verified.md`, measured):
 *    `https://{serviceHostname}-{prefix}.{region}.zerops.app` for a port-80
 *    route, `https://{serviceHostname}-{prefix}-{port}.{region}.zerops.app`
 *    for every other HTTP port — the same address the clients build
 *    (`@t3tools/client-runtime/zerops/containerAddress`).
 *
 * @module zerops/ZeropsProjectBinding
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/http";
import {
  buildZeropsContainerUrl,
  zeropsRegionFromPublicZone,
} from "@t3tools/client-runtime/zerops/containerAddress";

export class ZeropsNotAMemberError extends Schema.TaggedError<ZeropsNotAMemberError>()(
  "ZeropsNotAMemberError",
  {},
) {}

export class ZeropsProjectNotFoundError extends Schema.TaggedError<ZeropsProjectNotFoundError>()(
  "ZeropsProjectNotFoundError",
  {},
) {}

/** The project is real and the caller belongs to it, but no service in it publishes `endpointOrigin`. */
export class ZeropsEndpointNotBoundError extends Schema.TaggedError<ZeropsEndpointNotBoundError>()(
  "ZeropsEndpointNotBoundError",
  {},
) {}

export class ZeropsApiUnavailableError extends Schema.TaggedError<ZeropsApiUnavailableError>()(
  "ZeropsApiUnavailableError",
  {
    reason: Schema.String,
  },
) {}

export type ZeropsProjectBindingError =
  | ZeropsNotAMemberError
  | ZeropsProjectNotFoundError
  | ZeropsEndpointNotBoundError
  | ZeropsApiUnavailableError;

const ProjectResponse = Schema.Struct({
  clientId: Schema.optional(Schema.String),
  zeropsSubdomainHost: Schema.optional(Schema.NullOr(Schema.String)),
  publicZone: Schema.optional(Schema.NullOr(Schema.String)),
});

const ServiceStackResponse = Schema.Struct({
  list: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.optional(Schema.String),
        subdomainAccess: Schema.optional(Schema.Boolean),
        ports: Schema.optional(
          Schema.Array(
            Schema.Struct({
              port: Schema.optional(Schema.Number),
              scheme: Schema.optional(Schema.String),
            }),
          ),
        ),
      }),
    ),
  ),
});

const decodeProject = Schema.decodeUnknownEffect(ProjectResponse);
const decodeServiceStack = Schema.decodeUnknownEffect(ServiceStackResponse);

const unavailable = (reason: string) => new ZeropsApiUnavailableError({ reason });

const zeropsGet = Effect.fn("ZeropsProjectBinding.get")(function* (input: {
  readonly url: string;
  readonly token: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* httpClient
    .get(input.url, {
      headers: { authorization: `Bearer ${input.token}`, accept: "application/json" },
    })
    .pipe(
      Effect.catchCause(() => Effect.fail(unavailable("The Zerops API could not be reached."))),
    );
});

/** A service port's public origin: no port segment on 80, the port's own everywhere else. */
function subdomainOrigin(
  hostname: string,
  subdomainHost: string,
  region: string,
  port: number,
): string {
  return port === 80
    ? `https://${hostname}-${subdomainHost}.${region}.zerops.app`
    : buildZeropsContainerUrl(hostname, subdomainHost, port, region);
}

function originHost(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Verifies that the presented Zerops token belongs to a member of
 * `zeropsProjectId`, and that `endpointOrigin` is the public subdomain of a
 * subdomain-enabled service in that project.
 */
export const verify = Effect.fn("ZeropsProjectBinding.verify")(function* (input: {
  readonly apiBaseUrl: string;
  readonly token: string;
  readonly zeropsProjectId: string;
  readonly endpointOrigin: string;
}) {
  const projectResponse = yield* zeropsGet({
    url: `${input.apiBaseUrl}/project/${encodeURIComponent(input.zeropsProjectId)}`,
    token: input.token,
  });
  switch (projectResponse.status) {
    case 200:
      break;
    case 401:
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
  const project = yield* projectResponse.json.pipe(
    Effect.catchCause(() => Effect.fail(unavailable("The Zerops API returned a malformed body."))),
    Effect.flatMap((body) => decodeProject(body)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(unavailable("The Zerops project read was not in the expected shape.")),
    ),
  );

  const endpointHost = originHost(input.endpointOrigin);
  if (endpointHost === undefined) {
    return yield* new ZeropsEndpointNotBoundError({});
  }

  const servicesResponse = yield* zeropsGet({
    url: `${input.apiBaseUrl}/project/${encodeURIComponent(input.zeropsProjectId)}/service-stack`,
    token: input.token,
  });
  if (servicesResponse.status !== 200) {
    return yield* unavailable(
      `The Zerops API answered ${String(servicesResponse.status)} for the service-stack read.`,
    );
  }
  const services = yield* servicesResponse.json.pipe(
    Effect.catchCause(() => Effect.fail(unavailable("The Zerops API returned a malformed body."))),
    Effect.flatMap((body) => decodeServiceStack(body)),
    Effect.catchTag("SchemaError", () =>
      Effect.fail(unavailable("The Zerops service-stack read was not in the expected shape.")),
    ),
  );

  const subdomainHost = project.zeropsSubdomainHost;
  const region = project.publicZone ? zeropsRegionFromPublicZone(project.publicZone) : null;
  const bound =
    subdomainHost &&
    region !== null &&
    (services.list ?? []).some(
      (service) =>
        service.subdomainAccess === true &&
        service.name !== undefined &&
        (service.ports ?? []).some(
          (port) =>
            (port.scheme === "http" || port.scheme === "https") &&
            port.port !== undefined &&
            originHost(subdomainOrigin(service.name!, subdomainHost, region, port.port)) ===
              endpointHost,
        ),
    );
  if (!bound) {
    return yield* new ZeropsEndpointNotBoundError({});
  }
});
