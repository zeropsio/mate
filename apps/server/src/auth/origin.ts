import { isZeropsEnvironment, type ZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";

/** A local development page: named `localhost` on any port and scheme, never a lookalike or a path. */
const isLocalhostOrigin = (origin: string): boolean =>
  URL.canParse(origin) &&
  new URL(origin).hostname === "localhost" &&
  new URL(origin).origin === origin;

export const isAllowedWebSocketOrigin = (
  config: { readonly zerops: ZeropsEnvironment | undefined },
  origin: string | undefined,
): boolean =>
  !isZeropsEnvironment(config) ||
  (origin !== undefined &&
    (origin === "https://mate.zerops.io" ||
      isLocalhostOrigin(origin) ||
      config.zerops?.allowedOrigins?.includes(origin) === true));
