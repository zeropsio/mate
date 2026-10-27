import { withBasePath } from "@t3tools/shared/basePath";

export * from "@t3tools/shared/advertisedEndpoint";

/**
 * Resolve a server route against an environment's HTTP base URL.
 *
 * The base URL may carry the path prefix the environment is reverse-proxied
 * under, so the route is JOINED onto it — overwriting `pathname` would aim
 * every request at the origin root, where a prefixed deployment answers with
 * the shell of whatever else shares the origin.
 */
export const environmentEndpointUrl = (httpBaseUrl: string, pathname: string): string =>
  withBasePath(httpBaseUrl, pathname);
