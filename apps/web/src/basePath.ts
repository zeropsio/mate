import { normalizeBasePath } from "@t3tools/shared/basePath";

/**
 * The path prefix this bundle is served under.
 *
 * Vite bakes its `base` option into `import.meta.env.BASE_URL` (always with a
 * trailing slash), which is the one place the build-time prefix becomes runtime
 * knowledge. Everything that derives a URL — the router's basepath, the
 * window-origin environment target — reads it from here so a bundle built for
 * `/mate/` never assumes it owns the origin root.
 */
export const appBasePath = (): string => normalizeBasePath(import.meta.env.BASE_URL);

/** The same prefix in the trailing-slash form the router and `<base>` expect. */
export const appBasePathHref = (): string => `${appBasePath()}/`;
