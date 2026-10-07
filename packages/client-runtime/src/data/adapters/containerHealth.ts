import { browserTransportFetch } from "./mateTransport.ts";
/**
 * Is Zerops Mate running on this container?
 *
 * Two probes against the container's public origin, both plain header-less
 * GETs with `redirect: "manual"` — any custom header forces a CORS preflight
 * the container's nginx does not answer:
 *
 * - `GET /mate/.well-known/t3/environment` — the mate server's own environment
 *   document, and the **authority**: if it answers, Zerops Mate is up and
 *   reachable, which is the whole question.
 * - `GET /mate/healthz` — `{"initComplete": bool, "initAt": "…"}`, served statically
 *   by nginx outside the code-server cookie gate — zcp's init marker, not the
 *   Mate's liveness: it answers with the Mate stopped. Consulted only when the
 *   descriptor does not answer, to tell "still starting" (init not complete)
 *   from "its Mate is not answering" (init complete) and from "this container
 *   is not serving Zerops Mate at all".
 *
 * The readiness path lives under the `/mate/` prefix, not at the container root:
 * zcp publishes it only when `ZCP_MATE_ENABLED` is set, and the root `/healthz`
 * is code-server's own. So the route ANSWERING is itself the signal that this
 * container has Zerops Mate turned on — which is why a container with the flag
 * off reads the same as one whose zcp predates mate. Both need an operator, not a
 * wait; neither is distinguishable from the browser, and both are covered by
 * the same phase.
 *
 * The descriptor comes first because it is the authority. A current mate server
 * echoes a Zerops-issued browser origin (and localhost) on that response, while
 * nginx answers `/mate/healthz` with `Access-Control-Allow-Origin: *`. A container
 * not serving Zerops Mate answers neither probe with usable CORS headers.
 *
 * Nothing is concluded from a status code alone. A container not serving
 * Zerops Mate has neither route, so the cookie gate answers a redirect to
 * `/zcp-login` (measured on two live containers); and under a mis-prefixed
 * proxy the mate SPA's catch-all turns any path into a valid `200 index.html`.
 * Parse first, then decide.
 *
 * One limit worth knowing, measured from a browser 2026-08-28: a container
 * not serving Zerops Mate sends no CORS headers on ANY route, so every read
 * of it throws and it is indistinguishable here from a container that is
 * simply away — both come back `unreachable`. The picker resolves that where
 * it has more to go on: the platform has already said the service is ACTIVE,
 * and a restart is the action that helps in either case.
 */

import { EnvironmentId, type ExecutionEnvironmentUpdate } from "@t3tools/contracts";

import { zeropsMateBaseUrl } from "../../zerops/candidates.ts";
import type { DescriptorFacts } from "../../zerops/environments/environmentMachine.ts";
import type { Instant } from "../../zerops/environments/exchange.ts";
import type { ProbeAnswer, ProbeRead } from "../../zerops/environments/probe.ts";

/** What a `/healthz` probe concluded about a container. */
export type ZeropsContainerHealth =
  | "ready"
  | "initializing"
  | "predates-mate"
  | "unreachable"
  /** The container is up but Mate never answered. */
  | "stalled";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** What one header-less read of a path under a Mate's base URL answered. */
export type MatePathReading =
  | { readonly kind: "json"; readonly body: Record<string, unknown> }
  /** Answered, but not with the JSON this path is supposed to serve. */
  | { readonly kind: "not-json" }
  /** The cookie gate, or any redirect: this path is not served here. */
  | { readonly kind: "redirect" }
  /**
   * The container answered with a server error. Kept apart from `blocked`
   * because it PROVES the container is coming up rather than old: the platform
   * runs every `initCommands` entry to completion before any `startCommands`
   * process starts, so a container mid-boot is the L7's 502 and nginx
   * answering at all means that boot's `zcp init` already finished.
   */
  | { readonly kind: "server-error" }
  /** No answer at all — a dead container, or a cross-origin refusal. */
  | { readonly kind: "blocked" };

/** One plain GET, `redirect: "manual"` and no header: nothing a container must preflight. */
export async function readMatePath(
  url: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<MatePathReading> {
  let response: Response;
  try {
    response = await fetchImpl(
      url,
      signal === undefined ? { redirect: "manual" } : { redirect: "manual", signal },
    );
  } catch {
    return { kind: "blocked" };
  }

  // A browser reports a redirect it was told not to follow as an opaque
  // response with status 0; Node hands back the 3xx itself.
  if (response.type === "opaqueredirect") return { kind: "redirect" };
  if (response.status >= 300 && response.status < 400) return { kind: "redirect" };
  if (response.status >= 500) return { kind: "server-error" };
  if (response.status === 0) return { kind: "blocked" };
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return { kind: "not-json" };
  }

  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return { kind: "not-json" };
    return { kind: "json", body: body as Record<string, unknown> };
  } catch {
    return { kind: "not-json" };
  }
}

/**
 * The descriptor's `update` field (spec-mate.md §2.9), decoded loosely: any
 * shape short of all four fields is read as absent (MU-3) rather than a
 * partial reading fabricated from what is there.
 */
function parseDescriptorUpdate(value: unknown): ExecutionEnvironmentUpdate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  if (
    typeof body.installed === "string" &&
    typeof body.latest === "string" &&
    typeof body.available === "boolean" &&
    typeof body.checkedAt === "string"
  ) {
    return {
      installed: body.installed,
      latest: body.latest,
      available: body.available,
      checkedAt: body.checkedAt,
    };
  }
  return undefined;
}

/** Whether this document really is a mate server's, served under the right prefix. */
function isZeropsMateDescriptor(body: Record<string, unknown>): boolean {
  if (typeof body.environmentId !== "string") return false;
  // Once the server reports its base path, a wrong one means the proxy prefix
  // is mismatched — reachable, but not usable.
  const basePath = body.basePath;
  return typeof basePath === "string" ? basePath === "/mate" : true;
}

export async function probeZeropsContainerHealth(
  origin: string,
  fetchImpl: FetchLike = browserTransportFetch,
  onServerVersion?: (version: string, update: ExecutionEnvironmentUpdate | undefined) => void,
): Promise<ZeropsContainerHealth> {
  const base = origin.replace(/\/+$/, "");

  const descriptor = await readMatePath(
    `${zeropsMateBaseUrl(base)}/.well-known/t3/environment`,
    fetchImpl,
  );
  if (descriptor.kind === "json" && isZeropsMateDescriptor(descriptor.body)) {
    if (typeof descriptor.body.serverVersion === "string")
      onServerVersion?.(
        descriptor.body.serverVersion,
        parseDescriptorUpdate(descriptor.body.update),
      );
    return "ready";
  }

  const health = await readMatePath(`${zeropsMateBaseUrl(base)}/healthz`, fetchImpl);
  return concludeWithoutDescriptor(descriptor, health);
}

/** What the two reads say about a container whose descriptor did not answer as Mate's. */
function concludeWithoutDescriptor(
  descriptor: MatePathReading,
  health: MatePathReading,
): Exclude<ZeropsContainerHealth, "ready" | "stalled"> {
  // A server error anywhere means the container is on its way up, so it can
  // never be read as an old container needing a restart — that would restart
  // something that is already starting.
  if (descriptor.kind === "server-error" || health.kind === "server-error") {
    return "unreachable";
  }

  if (health.kind === "json") {
    // zcp publishes this route only with mate turned on, so its answering means
    // a missing descriptor is mate still coming up — never a container that is
    // not serving it, whatever `initComplete` says.
    return "initializing";
  }
  if (health.kind === "redirect" || health.kind === "not-json") {
    // Neither route: this container is not serving Zerops Mate — an older zcp,
    // or one with ZCP_MATE_ENABLED off. Either way an operator has to act, so
    // this must not read as "still starting", which would poll to a timeout
    // and never offer an action at all.
    return "predates-mate";
  }

  // The readiness route gave no answer at all. If the descriptor gave none
  // either, the container itself is away; otherwise nginx is answering
  // something that is neither route, which is again a container not serving
  // Zerops Mate.
  return descriptor.kind === "blocked" ? "unreachable" : "predates-mate";
}

/** The descriptor facts the environment machine reasons on (C6), off the raw document. */
function descriptorFactsOf(body: Record<string, unknown>): DescriptorFacts | null {
  if (typeof body.environmentId !== "string" || typeof body.serverVersion !== "string") {
    return null;
  }
  const zerops =
    body.zerops !== null && typeof body.zerops === "object"
      ? (body.zerops as Record<string, unknown>)
      : {};
  const identity = zerops.identity;
  return {
    environmentId: EnvironmentId.make(body.environmentId),
    serverVersion: body.serverVersion,
    update: parseDescriptorUpdate(body.update) ?? null,
    // Absent on a server too old to report it: never asked, which is not "could not check".
    identity: identity === "ok" || identity === "failed" ? identity : "unknown",
    identityCheckedAt:
      typeof zerops.identityCheckedAt === "string" ? zerops.identityCheckedAt : null,
  };
}

/** The Zerops project the descriptor states (`zerops.projectId`); null outside Zerops mode. */
function projectIdOf(body: Record<string, unknown>): string | null {
  const zerops = body.zerops;
  if (zerops === null || typeof zerops !== "object") return null;
  const projectId = (zerops as Record<string, unknown>).projectId;
  return typeof projectId === "string" && projectId !== "" ? projectId : null;
}

const initAtOf = (health: MatePathReading): string | null =>
  health.kind === "json" && typeof health.body.initAt === "string" ? health.body.initAt : null;

/**
 * The descriptor document at a Mate's base URL, as the tab's one share of it reads it
 * (`descriptorShare.ts`): `fresh` asks for a read started now, never one already held.
 */
export type DescriptorRead = (
  httpBaseUrl: string,
  options: { readonly fresh: boolean; readonly signal: AbortSignal },
) => Promise<{ readonly reading: MatePathReading; readonly sentAt: Instant }>;

/**
 * One probe of a Mate's container (C6): the descriptor, shared with every other reader of this
 * Mate unless the probe asks `fresh` (`descriptorShare.ts`), and its word alone says whether the
 * Mate is up. `/healthz` is read beside it only when the probe asks `initAt` (a container coming
 * up, a caller waiting on a probe started now): a container that re-initialized shows a new
 * `initAt`, and one whose descriptor does not answer is told coming up from not answering.
 */
export async function readZeropsContainer(
  origin: string,
  ports: { readonly descriptor: DescriptorRead; readonly fetch: FetchLike },
  signal: AbortSignal,
  ask: ProbeRead,
): Promise<ProbeAnswer> {
  const base = zeropsMateBaseUrl(origin.replace(/\/+$/, ""));
  const descriptorRead = ports.descriptor(base, { fresh: ask.fresh, signal });
  const healthRead = ask.initAt ? readMatePath(`${base}/healthz`, ports.fetch, signal) : null;
  // The reading is as old as the descriptor read it rests on, which another reader may have sent.
  const { reading: descriptor, sentAt } = await descriptorRead;
  if (descriptor.kind === "json" && isZeropsMateDescriptor(descriptor.body)) {
    const facts = descriptorFactsOf(descriptor.body);
    if (facts !== null) {
      return {
        reading: {
          kind: "ready",
          descriptor: facts,
          projectId: projectIdOf(descriptor.body),
          initAt: healthRead === null ? null : initAtOf(await healthRead),
        },
        sentAt,
      };
    }
  }
  // Readiness is the descriptor's word: `/healthz` is read only beside it, for a container coming
  // up. One that does not answer is away, or serves no Mate.
  if (healthRead === null) {
    return {
      reading: {
        kind:
          descriptor.kind === "blocked" || descriptor.kind === "server-error"
            ? "unreachable"
            : "predates-mate",
      },
      sentAt,
    };
  }
  const health = await healthRead;
  // zcp's init is complete — nginx serves its marker whether Mate runs or not — and the descriptor
  // did not answer, however it failed (a 502 without CORS reads as no answer at all): the
  // container is up and its Mate is not answering, never a container still coming up.
  if (health.kind === "json" && health.body.initComplete === true) {
    return { reading: { kind: "not-answering", initAt: initAtOf(health) }, sentAt };
  }
  const concluded = concludeWithoutDescriptor(descriptor, health);
  return {
    reading:
      concluded === "initializing"
        ? { kind: "initializing", initAt: initAtOf(health) }
        : { kind: concluded },
    sentAt,
  };
}

/**
 * The container's `/healthz` `initAt` alone, one read: a restart verb reads it just before it is
 * sent, so the restart is judged over by that value moving. Null when it serves none.
 */
export async function readZeropsInitAt(
  origin: string,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<string | null> {
  const base = zeropsMateBaseUrl(origin.replace(/\/+$/, ""));
  return initAtOf(await readMatePath(`${base}/healthz`, fetchImpl, signal));
}
