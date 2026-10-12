/**
 * What a Chief reads of Zerops through HQ (`chief.ts`): the reads zcp's org mode makes and no
 * others, forwarded as HQ with its own `HQ_ORG_TOKEN`, every search pinned to HQ's org and every
 * answer kept to the projects the Chief's person reads.
 *
 * The allowlist is zcp's `OrgReader` (`internal/platform/org_reader.go`, the zerops-go SDK's
 * paths): who the token is (`OpenOrgReader` resolves its org from it), the org's projects,
 * services, processes and app versions (searches), a service's variables, a project's log access
 * and its public routings (reads by id), and the platform's service-type catalogue, which holds no
 * org's data and so is neither pinned nor kept. A method other than GET, or a POST to anything but a
 * search, is refused before the allowlist is asked.
 *
 * @module chiefProxy
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import { ZeropsUnavailable } from "./zerops/api.ts";

/** The org's searches a Chief makes: what each item's project is read from. */
export type SearchOf = "project" | "service" | "process" | "appVersion";

/** A read the allowlist lets through, and what decides its reach. */
export type ChiefRead =
  | { readonly kind: "identity" }
  | { readonly kind: "search"; readonly of: SearchOf }
  | { readonly kind: "catalogue" }
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "service"; readonly serviceId: string };

/** A platform id: the only thing a path names besides its fixed words. */
const ID = "([A-Za-z0-9_-]{1,64})";

const READS: ReadonlyArray<{
  readonly method: "GET" | "POST";
  readonly path: RegExp;
  readonly read: (id: string) => ChiefRead;
}> = [
  { method: "GET", path: /^user\/info$/u, read: () => ({ kind: "identity" }) },
  { method: "POST", path: /^project\/search$/u, read: () => ({ kind: "search", of: "project" }) },
  {
    method: "POST",
    path: /^service-stack\/search$/u,
    read: () => ({ kind: "search", of: "service" }),
  },
  { method: "POST", path: /^process\/search$/u, read: () => ({ kind: "search", of: "process" }) },
  {
    method: "POST",
    path: /^app-version\/search$/u,
    read: () => ({ kind: "search", of: "appVersion" }),
  },
  { method: "POST", path: /^service-stack-type\/search$/u, read: () => ({ kind: "catalogue" }) },
  {
    method: "GET",
    path: new RegExp(`^service-stack/${ID}/env$`, "u"),
    read: (serviceId) => ({ kind: "service", serviceId }),
  },
  {
    method: "GET",
    path: new RegExp(`^project/${ID}/log$`, "u"),
    read: (projectId) => ({ kind: "project", projectId }),
  },
  {
    method: "GET",
    path: new RegExp(`^project/${ID}/public-http-routing$`, "u"),
    read: (projectId) => ({ kind: "project", projectId }),
  },
];

/**
 * The path a Chief asks, as the platform's REST API names it: empty segments dropped, and the
 * `api/rest/public` the SDK joins onto its endpoint taken off.
 */
export const chiefPath = (raw: string): string => {
  const segments = raw.split("/").filter((segment) => segment !== "");
  const bare =
    segments[0] === "api" && segments[1] === "rest" && segments[2] === "public"
      ? segments.slice(3)
      : segments;
  return bare.join("/");
};

/** The read `method` and `path` ask, or why they are refused: a method that writes, or a read not allowed. */
export const chiefRead = (
  method: string,
  raw: string,
): ChiefRead | { readonly refused: "method" | "path" } => {
  const path = chiefPath(raw);
  if (method !== "GET" && !(method === "POST" && path.endsWith("/search"))) {
    return { refused: "method" };
  }
  for (const allowed of READS) {
    if (allowed.method !== method) continue;
    const match = allowed.path.exec(path);
    if (match !== null) return allowed.read(match[1] ?? "");
  }
  return { refused: "path" };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The fields of the platform's search filter; any other is dropped. */
const FILTER_FIELDS = ["search", "sort", "limit", "offset"] as const;

/**
 * A search's filter pinned to `orgId`: its terms naming an org replaced by HQ's own, and only the
 * filter's own fields kept. None for a body that is no filter.
 */
export const pinSearch = (body: unknown, orgId: string): Option.Option<Record<string, unknown>> => {
  if (!isRecord(body)) return Option.none();
  const terms = body["search"] ?? [];
  if (!Array.isArray(terms) || !terms.every(isRecord)) return Option.none();
  const pinned: Record<string, unknown> = {};
  for (const field of FILTER_FIELDS) {
    if (field !== "search" && body[field] !== undefined) pinned[field] = body[field];
  }
  return Option.some({
    search: [
      ...terms.filter((term) => String(term["name"]).toLowerCase() !== "clientid"),
      { name: "clientId", operator: "eq", value: orgId },
    ],
    ...pinned,
  });
};

/**
 * A search's answer kept to HQ's org and the projects `reaches` lets in — an item's project is its
 * own id for a project, its `projectId` otherwise; one with none is no project's, and is dropped.
 * `totalHits` loses what was dropped. None for an answer in another shape.
 */
export const keepSearch = (
  body: unknown,
  options: {
    readonly orgId: string;
    readonly of: SearchOf;
    readonly reaches: (projectId: string) => boolean;
  },
): Option.Option<Record<string, unknown>> => {
  if (!isRecord(body) || !Array.isArray(body["items"])) return Option.none();
  const items: ReadonlyArray<unknown> = body["items"];
  const kept = items.filter((item) => {
    if (!isRecord(item) || item["clientId"] !== options.orgId) return false;
    const projectId = options.of === "project" ? item["id"] : item["projectId"];
    return typeof projectId === "string" && options.reaches(projectId);
  });
  const total = body["totalHits"];
  return Option.some({
    ...body,
    items: kept,
    ...(typeof total === "number" ? { totalHits: total - (items.length - kept.length) } : {}),
  });
};

/** Who the token is, its memberships kept to HQ's org. None for an answer in another shape. */
export const keepIdentity = (
  body: unknown,
  orgId: string,
): Option.Option<Record<string, unknown>> => {
  if (!isRecord(body) || !Array.isArray(body["clientUserList"])) return Option.none();
  const memberships: ReadonlyArray<unknown> = body["clientUserList"];
  return Option.some({
    ...body,
    clientUserList: memberships.filter(
      (membership) => isRecord(membership) && membership["clientId"] === orgId,
    ),
  });
};

/** What Zerops answered a forwarded read: its status, its content type and its body as sent. */
export interface UpstreamAnswer {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}

/** The platform's REST API as the proxy forwards to it. */
export class ChiefUpstream extends Context.Service<
  ChiefUpstream,
  {
    /** One request to `<api>/<path>?<query>` as `credential`, its answer whatever its status. */
    readonly forward: (request: {
      readonly method: "GET" | "POST";
      readonly path: string;
      readonly query: string;
      readonly body?: unknown;
    }) => (credential: Redacted.Redacted) => Effect.Effect<UpstreamAnswer, ZeropsUnavailable>;
  }
>()("@t3tools/hq/chiefProxy/ChiefUpstream") {}

const FORWARD_TIMEOUT = Duration.seconds(10);

/** {@link ChiefUpstream} over HTTP; `baseUrl` is `HQ_ZEROPS_API`, ending in `/api/rest/public`. */
export const makeChiefUpstreamHttp = (
  baseUrl: string,
): Effect.Effect<ChiefUpstream["Service"], never, HttpClient.HttpClient> =>
  Effect.map(HttpClient.HttpClient, (client) =>
    ChiefUpstream.of({
      forward:
        ({ method, path, query, body }) =>
        (credential) =>
          Effect.gen(function* () {
            const url = `${baseUrl.replace(/\/+$/u, "")}/${path}${query === "" ? "" : `?${query}`}`;
            const base =
              method === "GET"
                ? HttpClientRequest.get(url)
                : HttpClientRequest.bodyJsonUnsafe(HttpClientRequest.post(url), body ?? {});
            const response = yield* client.execute(
              base.pipe(
                HttpClientRequest.bearerToken(Redacted.value(credential)),
                HttpClientRequest.acceptJson,
              ),
            );
            const bytes = yield* response.arrayBuffer;
            return {
              status: response.status,
              contentType: response.headers["content-type"] ?? "application/json",
              body: new Uint8Array(bytes),
            };
          }).pipe(
            Effect.timeout(FORWARD_TIMEOUT),
            Effect.mapError(
              () =>
                new ZeropsUnavailable({
                  operation: "chief",
                  message: "The Zerops API could not be reached in time.",
                }),
            ),
          ),
    }),
  );
