import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  candidateAfterHealthProbe,
  loadOrganizationProjects,
  probeCandidateHealth,
} from "./candidate-loading";

const CONTAINER_ORIGIN = "https://zcp-demo-8080.prg1.zerops.app";
const READY_CANDIDATE: ZeropsCandidate = {
  key: "project-1:service-1",
  project: { id: "project-1", name: "Demo", status: "ACTIVE" },
  service: { id: "service-1", name: "zcp", status: "ACTIVE" },
  containerOrigin: CONTAINER_ORIGIN,
  group: "ready",
};

describe("candidateAfterHealthProbe", () => {
  it.each([
    [undefined, "provisioning", "checking Zerops Mate readiness"],
    ["ready", "ready", undefined],
    ["initializing", "provisioning", "Zerops Mate is starting"],
    ["predates-mate", "unavailable", "Zerops Mate is not enabled for this container"],
    ["unreachable", "unavailable", "container is not answering"],
  ] as const)("maps %s health to %s", (health, group, reason) => {
    const candidate = candidateAfterHealthProbe(READY_CANDIDATE, health);
    expect(candidate.group).toBe(group);
    expect(candidate.reason).toBe(reason);
  });

  it("does not probe-classify a container that is already connected", () => {
    const connected = { ...READY_CANDIDATE, group: "connected" as const };
    expect(candidateAfterHealthProbe(connected, "unreachable")).toBe(connected);
  });
});

describe("probeCandidateHealth", () => {
  it("turns probe failures into unavailable health", async () => {
    await expect(
      probeCandidateHealth(CONTAINER_ORIGIN, {
        probe: async () => Promise.reject(new Error("offline")),
        timeoutMs: 50,
      }),
    ).resolves.toBe("unreachable");
  });

  it("bounds a probe that never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = probeCandidateHealth(CONTAINER_ORIGIN, {
        probe: () => new Promise(() => undefined),
        timeoutMs: 50,
      });
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toBe("unreachable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loadOrganizationProjects", () => {
  it("keeps projects from healthy organizations when another organization fails", async () => {
    const load = vi.fn(async (organizationId: string) => {
      if (organizationId === "org-b") throw new Error("forbidden");
      return [{ id: "project-a", name: "A", status: "ACTIVE" }];
    });

    const result = await loadOrganizationProjects(["org-a", "org-b"], load);

    expect(result.projects.map((project) => project.id)).toEqual(["project-a"]);
    expect(result.failures).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
