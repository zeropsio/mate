import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as EnvironmentAuthPolicy from "./EnvironmentAuthPolicy.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";

const makeEnvironmentAuthPolicyLayer = (
  overrides?: Partial<ServerConfig.ServerConfig["Service"]>,
) =>
  EnvironmentAuthPolicy.layer.pipe(
    Layer.provide(
      Layer.effect(
        ServerConfig.ServerConfig,
        Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          return {
            ...config,
            zeropsFixtures: undefined,
            ...overrides,
          } satisfies ServerConfig.ServerConfig["Service"];
        }),
      ).pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-auth-policy-test-" })),
      ),
    ),
  );

it.layer(NodeServices.layer)("EnvironmentAuthPolicy.layer", (it) => {
  it.effect("uses desktop-managed-local policy for desktop mode", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("desktop-managed-local");
      expect(descriptor.bootstrapMethods).toEqual(["desktop-bootstrap"]);
      // Packaged desktop has no devUrl, but still needs the port scope: it
      // scans upward from 3773 for a free port and binds 127.0.0.1, so a second
      // instance shares this one's hostname on a different port.
      expect(descriptor.sessionCookieName).toBe("t3_session_3773");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "desktop",
          port: 3773,
        }),
      ),
    ),
  );

  it.effect("keeps desktop cookies port-scoped on the port a second instance lands on", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.sessionCookieName).toBe("t3_session_3774");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "desktop",
          port: 3774,
        }),
      ),
    ),
  );

  it.effect("uses remote-reachable policy for desktop mode when bound beyond loopback", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("remote-reachable");
      expect(descriptor.bootstrapMethods).toEqual(["desktop-bootstrap", "one-time-token"]);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "desktop",
          host: "0.0.0.0",
        }),
      ),
    ),
  );

  it.effect("uses loopback-browser policy for loopback web hosts", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("loopback-browser");
      expect(descriptor.bootstrapMethods).toEqual(["one-time-token"]);
      expect(descriptor.sessionMethods).toEqual([
        "browser-session-cookie",
        "bearer-access-token",
        "dpop-access-token",
      ]);
      expect(descriptor.sessionCookieName).toMatch(/^t3_session_3773_[a-f0-9]{12}$/);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
          port: 3773,
        }),
      ),
    ),
  );

  it.effect("uses remote-reachable policy for wildcard web hosts", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("remote-reachable");
      expect(descriptor.bootstrapMethods).toEqual(["one-time-token"]);
      expect(descriptor.sessionCookieName).toBe("t3_session");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "0.0.0.0",
        }),
      ),
    ),
  );

  it.effect("isolates wildcard-bound web development sessions", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("remote-reachable");
      expect(descriptor.sessionCookieName).toMatch(/^t3_session_5775_[a-f0-9]{12}$/);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "0.0.0.0",
          port: 5775,
          devUrl: new URL("http://127.0.0.1:5736"),
        }),
      ),
    ),
  );

  it.effect("uses remote-reachable policy for non-loopback web hosts", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("remote-reachable");
      expect(descriptor.sessionCookieName).toBe("t3_session");
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "192.168.1.50",
        }),
      ),
    ),
  );
  it.effect("offers the Zerops identity door, and is remote-reachable on loopback", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      // The container binds loopback and is published by its own nginx, so the
      // bind address says nothing about who can reach it.
      expect(descriptor.policy).toBe("remote-reachable");
      // The identity door first; the authenticated pairing-token path stays so
      // a signed-in member can still pair a second device.
      expect(descriptor.bootstrapMethods).toEqual(["zerops-identity", "one-time-token"]);
      // No cookie inside a Zerops project: the hosted client is bearer/DPoP
      // only, so nothing this server issues can ride a cross-origin request by
      // itself.
      expect(descriptor.sessionMethods).toEqual(["bearer-access-token", "dpop-access-token"]);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
          zerops: resolveZeropsEnvironment({
            projectId: "nTV3oMB2SS634ImDJnQckg",
            apiHost: undefined,
            allowedOrigins: [],
            membershipTtlSeconds: undefined,
          }),
        }),
      ),
    ),
  );

  it.effect("leaves a non-Zerops environment on the upstream pairing method", () =>
    Effect.gen(function* () {
      const policy = yield* EnvironmentAuthPolicy.EnvironmentAuthPolicy;
      const descriptor = yield* policy.getDescriptor();

      expect(descriptor.policy).toBe("loopback-browser");
      expect(descriptor.bootstrapMethods).toEqual(["one-time-token"]);
    }).pipe(
      Effect.provide(
        makeEnvironmentAuthPolicyLayer({
          mode: "web",
          host: "127.0.0.1",
        }),
      ),
    ),
  );
});
