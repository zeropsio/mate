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

  const bootstrapMethods: ServerAuthDescriptor["bootstrapMethods"] = isZerops
    ? ["zerops-identity"]
    : [];

  const descriptor: ServerAuthDescriptor = {
    accountLifecycleVersion: 1,
    policy,
    bootstrapMethods,
    // A cookie is the one credential a browser attaches to a cross-origin
    // request by itself. Inside a Zerops project this server is published on
    // the public internet, so it issues none: the hosted client is bearer or
    // DPoP only, and CSRF stops being a category of bug rather than a thing to
    // defend against.
    sessionMethods: ["bearer-access-token", "dpop-access-token"],
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
