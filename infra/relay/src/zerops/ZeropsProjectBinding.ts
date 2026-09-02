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
 *    that project? Reconstructs each candidate service's subdomain URL the
 *    way `zcp`'s `BuildSubdomainURL` does (`internal/ops/discover.go`):
 *    `https://{serviceHostname}-{prefix}.{domain}` for its port-80 route,
 *    `https://{serviceHostname}-{prefix}-{port}.{domain}` for every other
 *    `httpSupport` port. `GetProject`'s `zeropsSubdomainHost` is
 *    occasionally a bare prefix with no domain suffix for some projects
 *    (zcp's own comment on this, live-verified 2026-06: e.g. "8a" rather
 *    than "8a.prg1.zerops.app") — such a project can never match by this
 *    reconstruction alone. That is a known, accepted limitation of this
 *    check, not a bug in the comparison; `zcp` itself resolves the
 *    authoritative URL by reading the service's own `zeropsSubdomain` env
 *    var instead, which needs a service-scoped credential this endpoint
 *    does not have.
 *
 * @module zerops/ZeropsProjectBinding
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

export class ZeropsNotAMemberError extends Schema.TaggedErrorClass<ZeropsNotAMemberError>()(
  "ZeropsNotAMemberError",
  {},
) {}

export class ZeropsProjectNotFoundError extends Schema.TaggedErrorClass<ZeropsProjectNotFoundError>()(
  "ZeropsProjectNotFoundError",
  {},
) {}

/** The project is real and the caller belongs to it, but no service in it publishes `endpointOrigin`. */
export class ZeropsEndpointNotBoundError extends Schema.TaggedErrorClass<ZeropsEndpointNotBoundError>()(
  "ZeropsEndpointNotBoundError",
  {},
) {}

export class ZeropsApiUnavailableError extends Schema.TaggedErrorClass<ZeropsApiUnavailableError>()(
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
  zeropsSubdomainHost: Schema.optional(Schema.String),
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
              httpSupport: Schema.optional(Schema.Boolean),
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

/**
 * `https://{hostname}-{prefix}.{domain}` (port 80), or
 * `https://{hostname}-{prefix}-{port}.{domain}` for any other port. Returns
 * `undefined` when `subdomainHost` carries no domain suffix (a bare prefix
 * — see the module doc's known limitation).
 */
function buildSubdomainUrl(
  hostname: string,
  subdomainHost: string,
  port: number,
): string | undefined {
  const dot = subdomainHost.indexOf(".");
  if (dot < 0) {
    return undefined;
  }
  const prefix = subdomainHost.slice(0, dot);
  const domain = subdomainHost.slice(dot + 1);
  if (domain.length === 0) {
    return undefined;
  }
  return port === 80
    ? `https://${hostname}-${prefix}.${domain}`
    : `https://${hostname}-${prefix}-${port}.${domain}`;
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
  const bound =
    subdomainHost !== undefined &&
    (services.list ?? []).some((service) => {
      if (service.subdomainAccess !== true || service.name === undefined) {
        return false;
      }
      const ports = service.ports?.filter(
        (port) => port.httpSupport === true && port.port !== undefined,
      );
      const candidatePorts = ports && ports.length > 0 ? ports.map((port) => port.port!) : [80];
      return candidatePorts.some((port) => {
        const candidate = buildSubdomainUrl(service.name!, subdomainHost, port);
        return candidate !== undefined && originHost(candidate) === endpointHost;
      });
    });
  if (!bound) {
    return yield* new ZeropsEndpointNotBoundError({});
  }
});
