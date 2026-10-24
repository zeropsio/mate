import type { ServerAuthDescriptor } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import { isRemoteReachableHost, resolveSessionCookieName } from "./utils.ts";
import { isZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";

export class EnvironmentAuthPolicy extends Context.Service<
  EnvironmentAuthPolicy,
  {
    readonly getDescriptor: () => Effect.Effect<ServerAuthDescriptor>;
  }
>()("t3/auth/EnvironmentAuthPolicy") {}

/** Checks current admission before an existing session exposes this environment. */
export const SessionAdmission = Context.Reference<(subject: string) => Effect.Effect<boolean>>(
  "t3/auth/SessionAdmission",
  { defaultValue: () => () => Effect.succeed(true) },
);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const isRemoteReachable = isRemoteReachableHost(config.host);
  // A Zerops container binds loopback and is published by the container's own
  // nginx, so the bind address says nothing about who can reach it: it is
  // remote-reachable by construction.
  const isZerops = isZeropsEnvironment(config);

  const policy = isZerops
    ? "remote-reachable"
    : config.mode === "desktop"
      ? isRemoteReachable
        ? "remote-reachable"
        : "desktop-managed-local"
      : isRemoteReachable
        ? "remote-reachable"
        : "loopback-browser";

  const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] = isZerops ? ["ticket"] : [];

  const descriptor: ServerAuthDescriptor = {
    accountLifecycleVersion: 1,
    policy,
    bootstrapMethods,
    // Zerops HTTP carries the live connection handle explicitly; it issues no cookie or DPoP token.
    sessionMethods: isZerops
      ? ["bearer-access-token"]
      : ["bearer-access-token", "dpop-access-token"],
    sessionCookieName: resolveSessionCookieName({
      mode: config.mode,
      port: config.port,
      host: config.host,
      instanceKey: config.stateDir,
      development: config.devUrl !== undefined,
    }),
  };

  return EnvironmentAuthPolicy.of({
    getDescriptor: () =>
      Effect.succeed(descriptor).pipe(Effect.withSpan("EnvironmentAuthPolicy.getDescriptor")),
  });
});

export const layer = Layer.effect(EnvironmentAuthPolicy, make);
