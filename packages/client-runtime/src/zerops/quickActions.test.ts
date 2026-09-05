import { describe, expect, it } from "@effect/vitest";

import { zeropsQuickActions } from "./quickActions.ts";
import type { ZeropsTopologyService, ZeropsTopologyView } from "./topology.ts";

const service = (
  overrides: Partial<ZeropsTopologyService> & { hostname: string },
): ZeropsTopologyService => ({
  serviceId: `svc-${overrides.hostname}`,
  type: "ubuntu/nodejs@22",
  status: "ACTIVE",
  group: "runtimes",
  transient: false,
  routes: [],
  ports: [],
  ...overrides,
});

const topology = (
  services: ReadonlyArray<ZeropsTopologyService>,
  overrides?: Partial<ZeropsTopologyView>,
): ZeropsTopologyView => ({
  project: { id: "p1", name: "z3-eval", status: "ACTIVE" },
  services,
  warnings: [],
  usageRead: false,
  ...overrides,
});

const zcp = service({ hostname: "zcp", type: "zcp@1", group: "infrastructure" });

describe("zeropsQuickActions", () => {
  it("offers nothing outside a Zerops project", () => {
    expect(zeropsQuickActions(undefined)).toEqual([]);
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

  it("talks about the first runtime when there are several", () => {
    const actions = zeropsQuickActions(
      topology([service({ hostname: "apione" }), service({ hostname: "apitwo" })]),
    );

    expect(actions[0]?.prompt).toBe("Deploy apione.");
  });

  it("stops offering Redis once the project has one", () => {
    const actions = zeropsQuickActions(
      topology([
        service({ hostname: "kanbandev" }),
        service({
          hostname: "cache",
          type: "valkey:single@7.2",
          group: "data",
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
        }),
      ]),
    );

    expect(actions.map((action) => action.id)).toEqual(["logs", "add-redis"]);
    expect(actions[0]?.prompt).toBe("Show me the recent logs for db.");
  });
});
