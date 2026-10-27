import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  DEFAULT_SERVER_SETTINGS,
  type ServerConfig,
  type ExecutionEnvironmentUpdate,
  type ServerConfigStreamEvent,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { applyServerConfigProjection } from "./serverConfigProjection.ts";

const update: ExecutionEnvironmentUpdate = {
  installed: "1",
  latest: "2",
  available: true,
  checkedAt: "owner",
  automatic: { protocol: 1, rollbackCompatible: true, phase: "draining", runningVersion: "1" },
};
const config: ServerConfig = {
  environment: {
    environmentId: EnvironmentId.make("env"),
    label: "Mate",
    platform: { os: "linux", arch: "x64" },
    serverVersion: "1",
    bootId: "boot",
    capabilities: { repositoryIdentity: true },
    update,
  },
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "session",
  },
  cwd: "/workspace",
  keybindingsConfigPath: "/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
    otlpLogsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};
const snapshot = () =>
  applyServerConfigProjection(Option.none(), { version: 1, type: "snapshot", config });

describe("streamed Mate update config", () => {
  it.each([
    {
      name: "reports switching",
      next: { ...update, automatic: { ...update.automatic!, phase: "switching" as const } },
    },
    { name: "clears removed update evidence", next: null },
  ])("$name", ({ next }) => {
    const event: ServerConfigStreamEvent = {
      version: 1,
      type: "mateUpdate",
      payload: { update: next },
    };
    const result = Option.getOrThrow(applyServerConfigProjection(snapshot(), event));
    expect(result.config.environment.update).toEqual(next ?? undefined);
    expect(result.config.environment.serverVersion).toBe("1");
    expect(result.config.environment.bootId).toBe("boot");
    expect(result.config.settings).toBe(DEFAULT_SERVER_SETTINGS);
    expect(result.latestEvent).toBe(event);
    expect(result.source).toBe("live");
  });
  it("does not invent a server config before its snapshot", () => {
    expect(
      Option.isNone(
        applyServerConfigProjection(Option.none(), {
          version: 1,
          type: "mateUpdate",
          payload: { update },
        }),
      ),
    ).toBe(true);
  });
});
