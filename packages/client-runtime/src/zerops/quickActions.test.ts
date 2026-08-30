import { describe, expect, it } from "vite-plus/test";
import type { ZeropsService, ZeropsTopologySnapshot } from "@t3tools/contracts";

import { zeropsQuickActions } from "./quickActions.ts";

const service = (overrides: Partial<ZeropsService> & { hostname: string }): ZeropsService =>
  ({
    serviceId: `svc-${overrides.hostname}`,
    type: "ubuntu/nodejs@22",
    status: "ACTIVE",
    group: "runtimes",
    adoptionState: "adopted",
    isManagedService: false,
    transient: false,
    mounted: false,
    ...overrides,
  }) as ZeropsService;

const topology = (
  services: ReadonlyArray<ZeropsService>,
  overrides?: Partial<ZeropsTopologySnapshot>,
): ZeropsTopologySnapshot =>
  ({
    available: true,
    degraded: false,
    services,
    warnings: [],
    readAt: "2026-08-28T10:00:00Z",
    ...overrides,
  }) as unknown as ZeropsTopologySnapshot;

const zcp = service({
  hostname: "zcp",
  type: "zcp@1",
  group: "infrastructure",
  adoptionState: "zcp-self",
});

describe("zeropsQuickActions", () => {
  it("offers nothing outside a Zerops project", () => {
    expect(zeropsQuickActions(undefined)).toEqual([]);
    expect(zeropsQuickActions(topology([], { available: false }))).toEqual([]);
  });

  /** The container itself is not the user's app, so it never counts as one. */
  it("offers only a starting prompt when the project is bare", () => {
    expect(zeropsQuickActions(topology([zcp])).map((action) => action.id)).toEqual(["bootstrap"]);
  });

  it("offers deploy, logs and Redis once there is a runtime", () => {
    const actions = zeropsQuickActions(topology([zcp, service({ hostname: "kanbandev" })]));

    expect(actions.map((action) => action.id)).toEqual(["deploy", "logs", "add-redis"]);
    expect(actions[0]?.prompt).toBe("Deploy kanbandev.");
    expect(actions[1]?.prompt).toBe("Show me the recent logs for kanbandev.");
  });

  /** A mounted runtime is where the user's code is, so it wins the prompt. */
  it("talks about the mounted runtime when there are several", () => {
    const actions = zeropsQuickActions(
      topology([service({ hostname: "apione" }), service({ hostname: "apitwo", mounted: true })]),
    );

    expect(actions[0]?.prompt).toBe("Deploy apitwo.");
  });

  it("stops offering Redis once the project has one", () => {
    const actions = zeropsQuickActions(
      topology([
        service({ hostname: "kanbandev" }),
        service({
          hostname: "cache",
          type: "valkey:single@7.2",
          group: "data",
          isManagedService: true,
        }),
      ]),
    );

    expect(actions.map((action) => action.id)).toEqual(["deploy", "logs"]);
  });

  it("still offers logs when the project is only managed services", () => {
    const actions = zeropsQuickActions(
      topology([
        zcp,
        service({
          hostname: "db",
          type: "postgresql:single@18",
          group: "data",
          isManagedService: true,
        }),
      ]),
    );

    expect(actions.map((action) => action.id)).toEqual(["logs", "add-redis"]);
    expect(actions[0]?.prompt).toBe("Show me the recent logs for db.");
  });
});
