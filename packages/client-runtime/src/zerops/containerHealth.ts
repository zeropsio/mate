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
 *   by nginx outside the code-server cookie gate. Consulted only when the
 *   descriptor does not answer, to tell "still starting" from "this container
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

import { zeropsMateBaseUrl } from "./candidates.ts";
import type { ZeropsContainerHealth } from "./provisioning.ts";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type Reading =
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

async function read(url: string, fetchImpl: FetchLike): Promise<Reading> {
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "manual" });
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
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
): Promise<ZeropsContainerHealth> {
  const base = origin.replace(/\/+$/, "");

  const descriptor = await read(`${zeropsMateBaseUrl(base)}/.well-known/t3/environment`, fetchImpl);
  if (descriptor.kind === "json" && isZeropsMateDescriptor(descriptor.body)) {
    return "ready";
  }

  const health = await read(`${zeropsMateBaseUrl(base)}/healthz`, fetchImpl);

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
