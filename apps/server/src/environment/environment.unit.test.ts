import { assert, expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessHostname } from "@t3tools/shared/hostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "../zerops/ZeropsEnvironment.ts";
import { zeropsPolicy } from "../zerops/ZeropsPolicy.ts";
import { containerStartedAt } from "../zerops/ZeropsRestartRead.ts";
import * as RemoteOpenTargets from "./RemoteOpenTargets.ts";
import * as ServerEnvironment from "./ServerEnvironment.ts";

// witness: apps/server/src/environment/RemoteOpenTargets.ts | if (!sshdListening) { → if (sshdListening) {
it.effect(
  "EV1: The server advertises no SSH open target when no sshd accepts on either loopback, and the mDNS name when one accepts on IPv4 or IPv6 only",
  () =>
    Effect.gen(function* () {
      for (const [sshd, expected] of [
        [{ ipv4: false, ipv6: false }, []],
        [{ ipv4: true, ipv6: true }, [{ kind: "mdns", host: "bb-1.local" }]],
        [{ ipv4: false, ipv6: true }, [{ kind: "mdns", host: "bb-1.local" }]],
      ] as const) {
        const targets = yield* Effect.flatMap(RemoteOpenTargets.RemoteOpenTargets, (service) =>
          service.resolveTargets(),
        ).pipe(
          Effect.provideService(HostProcessHostname, "bb-1"),
          Effect.provide(
            RemoteOpenTargets.layer.pipe(
              Layer.provide(
                Layer.succeed(NetService.NetService, {
                  canListenOnHost: () => Effect.succeed(true),
                  isPortAvailableOnLoopback: () => Effect.succeed(true),
                  hasListenerOnHost: (_port, host) =>
                    Effect.succeed(host === "::1" ? sshd.ipv6 : sshd.ipv4),
                  reserveLoopbackPort: () => Effect.succeed(40_000),
                  findAvailablePort: (preferred) => Effect.succeed(preferred),
                }),
              ),
            ),
          ),
        );
        expect(targets).toEqual(expected);
      }
    }),
);

// witness: apps/server/src/environment/ServerEnvironment.ts | : { zerops: { projectId: serverConfig.zerops.projectId } }), → : { zerops: { projectId: serverConfig.zerops.apiBaseUrl } }),
it.effect(
  "EV2: The server's environment descriptor carries the Zerops project id inside a Zerops container and no Zerops field outside one",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-server-environment-" });
      const config = yield* ServerConfig.ServerConfig.pipe(
        Effect.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
      );
      const descriptorUnder = (zerops: ServerConfig.ServerConfig["Service"]["zerops"]) =>
        Effect.flatMap(
          ServerEnvironment.ServerEnvironment,
          (environment) => environment.getDescriptor,
        ).pipe(
          Effect.provide(
            ServerEnvironment.layer.pipe(
              Layer.provide(ServerSecretStore.layer),
              Layer.provide(ServerConfig.layer({ ...config, zerops })),
            ),
          ),
        );

      const outsideZerops = yield* descriptorUnder(undefined);
      expect(outsideZerops.zerops).toBeUndefined();

      const insideZerops = yield* descriptorUnder({
        projectId: "TEST000000000000000023",
        apiBaseUrl: "https://api.app-prg1.zerops.io/api/rest/public",
        publicOrigin: undefined,
        apiToken: undefined,
        hqOrigin: "https://hq.zerops.io",
        serviceId: undefined,
        hostname: undefined,
        statusFile: undefined,
        envStorePath: "/etc/zerops-zembed/env.json",
      });
      expect(insideZerops.zerops).toEqual({ projectId: "TEST000000000000000023" });
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

// witness: apps/server/src/zerops/ZeropsEnvironment.ts | const projectId = input.projectId?.trim() ?? ""; → const projectId = input.projectId ?? "";
it("EV3: The server counts as inside a Zerops container exactly when its launch carries a non-blank project id, which it keeps trimmed; an absent or blank id leaves it outside", () => {
  const input = { projectId: undefined, apiHost: undefined, publicOrigin: undefined };
  assert.strictEqual(resolveZeropsEnvironment(input), undefined);
  assert.strictEqual(resolveZeropsEnvironment({ ...input, projectId: "" }), undefined);
  assert.strictEqual(resolveZeropsEnvironment({ ...input, projectId: "   " }), undefined);
  assert.strictEqual(
    resolveZeropsEnvironment({ ...input, projectId: "TEST000000000000000023" })?.projectId,
    "TEST000000000000000023",
  );
  assert.strictEqual(
    resolveZeropsEnvironment({ ...input, projectId: "  abc  " })?.projectId,
    "abc",
  );
});

// witness: apps/server/src/zerops/ZeropsPolicy.ts | worktreesAllowed: false, → worktreesAllowed: true,
it.effect(
  "EV4: Inside a Zerops container a thread may not run in its own worktree, use the stacked commit, push and pull-request action, or refresh its upstream automatically; outside one, or with no server config, all three are allowed",
  () =>
    Effect.gen(function* () {
      const configLayer = (zerops: ServerConfig.ServerConfig["Service"]["zerops"]) =>
        Layer.effect(
          ServerConfig.ServerConfig,
          Effect.map(ServerConfig.ServerConfig, (config) => ({
            ...config,
            zeropsFixtures: undefined,
            zerops,
          })),
        ).pipe(
          Layer.provide(
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-zerops-policy-test-" }),
          ),
        );
      const allowed = {
        worktreesAllowed: true,
        stackedVcsActionsAllowed: true,
        upstreamRefreshAllowed: true,
      };

      expect(yield* zeropsPolicy).toEqual(allowed);
      expect(yield* zeropsPolicy.pipe(Effect.provide(configLayer(undefined)))).toEqual(allowed);
      expect(
        yield* zeropsPolicy.pipe(
          Effect.provide(
            configLayer(
              resolveZeropsEnvironment({ projectId: "TEST000000000000000023", apiHost: undefined }),
            ),
          ),
        ),
      ).toEqual({
        worktreesAllowed: false,
        stackedVcsActionsAllowed: false,
        upstreamRefreshAllowed: false,
      });
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsRestartRead.ts | if (!stat.startsWith("1 (") || !stat.includes(") ")) return null; → if (!stat.includes(") ")) return null;
it("EV5: A container's start time is read from PID 1's start ticks over the host's boot time, and a stat line of any other process or an unreadable one gives no start time", () => {
  const fields = ["S", ...Array.from({ length: 18 }, () => "0"), "30000"];
  assert.equal(
    containerStartedAt(`1 (init (container)) ${fields.join(" ")}`, "btime 1791066600\n"),
    "2026-10-03T22:35:00.000Z",
  );
  assert.equal(containerStartedAt("unreadable", "btime 1791066600\n"), null);
  assert.equal(containerStartedAt(`22 (mate) ${fields.join(" ")}`, "btime 1791066600\n"), null);
});
