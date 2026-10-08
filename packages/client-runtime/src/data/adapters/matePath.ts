/** Header-less path reads with an injected transport. */
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
