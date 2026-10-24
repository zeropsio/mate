import { isZeropsEnvironment, type ZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";

export const isAllowedWebSocketOrigin = (
  config: { readonly zerops: ZeropsEnvironment | undefined },
  origin: string | undefined,
): boolean =>
  !isZeropsEnvironment(config) ||
  (origin !== undefined &&
    (origin === "https://mate.zerops.io" ||
      config.zerops?.allowedOrigins?.includes(origin) === true));
