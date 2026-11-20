/**
 * Base-path algebra.
 *
 * A T3 environment may be reverse-proxied under a path prefix rather than at an
 * origin root — Zerops serves the container's server at `<origin>/mate/` beside
 * code-server on the same 8080 origin. That makes the path part of a base URL
 * rather than noise to discard, so every URL the client derives from a base URL
 * must JOIN onto the prefix instead of overwriting `pathname`.
 *
 * The normal form of a prefix is `""` (origin root) or `/mate` — a leading slash,
 * no trailing slash — so a prefix is always safe to concatenate with a
 * root-absolute route path.
 *
 * @module basePath
 */

/** The socket route the RPC WebSocket lives on, relative to the base path. */
export const SOCKET_ROUTE = "/ws";

/**
 * Normalize any spelling of a path prefix to the normal form: `""` for the
 * origin root, otherwise a leading slash with no trailing slash.
 */
export function normalizeBasePath(rawValue: string | undefined | null): string {
  const trimmed = (rawValue ?? "").trim();
  if (trimmed.length === 0) {
    return "";
  }
  const collapsed = trimmed.replace(/\/{2,}/g, "/");
  const withLeadingSlash = collapsed.startsWith("/") ? collapsed : `/${collapsed}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "" : withoutTrailingSlash;
}

/** Join a route path onto a path prefix, without doubling or dropping slashes. */
function joinBasePath(basePath: string, path: string): string {
  const prefix = normalizeBasePath(basePath);
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (suffix === "/") {
    return prefix === "" ? "/" : `${prefix}/`;
  }
  return `${prefix}${suffix}`;
}

/**
 * Resolve a route path against a base URL, preserving the prefix the base URL
 * carries. Query and fragment on the base URL are dropped — a base URL names a
 * location, not a request.
 */
export function withBasePath(baseUrl: string | URL, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = joinBasePath(url.pathname, path);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * The WebSocket URL for an environment whose ws base URL may carry a prefix.
 *
 * A base URL that already ends in the socket route is left alone, so an
 * explicitly configured socket endpoint is never doubled.
 */
export function socketUrlFromWsBaseUrl(wsBaseUrl: string | URL): URL {
  const url = new URL(wsBaseUrl);
  const prefix = normalizeBasePath(url.pathname);
  url.pathname = prefix.endsWith(SOCKET_ROUTE) ? prefix : joinBasePath(prefix, SOCKET_ROUTE);
  return url;
}
