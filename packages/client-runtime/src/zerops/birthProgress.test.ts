import { describe, expect, it } from "vite-plus/test";

import type { ZeropsService } from "./api.ts";
import {
  birthCopyServices,
  birthRuntimesFacts,
  deriveBirthProgress,
  type BirthFacts,
  type BirthProcessFact,
  type BirthRuntimesFacts,
  type BirthStepId,
} from "./birthProgress.ts";

const NOW = Date.parse("2026-09-22T10:05:00Z");

function process(
  partial: Partial<BirthProcessFact> & Pick<BirthProcessFact, "actionName" | "status">,
): BirthProcessFact {
  return {
    createdAt: "2026-09-22T10:00:00Z",
    startedAt: null,
    finishedAt: null,
    serviceIds: [],
    ...partial,
  };
}

/** A birth that has already fully settled — the baseline every test overrides from. */
const SETTLED: BirthFacts = {
  project: { status: "ACTIVE", createdAt: "2026-09-22T10:00:00Z" },
  container: { serviceId: "svc-1", status: "ACTIVE", hasOrigin: true },
  processes: [],
  health: "ready",
  provisioningPhase: "ready",
  connection: "connected",
};

/**
 * Clears everything downstream of hardening. A test that overrides an
 * earlier step (project/container/public-access) off SETTLED must spread
 * this too, or the later steps' own SETTLED-done facts (health ready,
 * provisioningPhase ready, connection connected) win the birth-wide
 * monotonic backfill and mask the very state under test.
 */
const NOT_YET = { health: undefined, provisioningPhase: null, connection: "none" } as const;

function stepOf(facts: BirthFacts, id: BirthStepId) {
  return deriveBirthProgress(facts, NOW).steps.find((step) => step.id === id)!;
}

describe("project step", () => {
  it("is active with nothing known yet but a request", () => {
    const facts: BirthFacts = {
      project: undefined,
      container: undefined,
      processes: [],
      health: undefined,
      provisioningPhase: null,
      connection: "none",
      requestedAt: "2026-09-22T09:59:00Z",
    };
    expect(stepOf(facts, "project")).toMatchObject({
      state: "active",
      detail: "Creating the project",
    });
  });

  it("is active while the project row still reads NEW/CREATING", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      project: { status: "CREATING" },
      container: undefined,
    };
    expect(stepOf(facts, "project").state).toBe("active");
  });

  it("is done once the project row is past NEW/CREATING", () => {
    expect(stepOf(SETTLED, "project").state).toBe("done");
  });

  it("is done on project.create FINISHED even before the project row catches up", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      project: undefined,
      container: undefined,
      processes: [
        process({
          actionName: "project.create",
          status: "FINISHED",
          startedAt: "s",
          finishedAt: "e",
        }),
      ],
    };
    const step = stepOf(facts, "project");
    expect(step.state).toBe("done");
    expect(step.startedAt).toBe("s");
    expect(step.endedAt).toBe("e");
  });

  it("fails on a platform-reported creation failure, and the rest wait", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      project: undefined,
      container: undefined,
      creationFailed: { message: "No ready project was available" },
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps[0]).toMatchObject({
      id: "project",
      state: "failed",
      detail: "No ready project was available",
    });
    expect(progress.steps.slice(1).every((step) => step.state === "waiting")).toBe(true);
    expect(progress.failed?.id).toBe("project");
  });

  it("fails on project.create FAILED, using its fail reason", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      project: undefined,
      container: undefined,
      processes: [
        process({ actionName: "project.create", status: "FAILED", failReason: "quota exceeded" }),
      ],
    };
    expect(stepOf(facts, "project")).toMatchObject({ state: "failed", detail: "quota exceeded" });
  });
});

describe("container step", () => {
  it("waits while the project is not yet done", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      project: { status: "CREATING" },
      container: undefined,
      processes: [process({ actionName: "stack.create", status: "RUNNING" })],
    };
    expect(stepOf(facts, "container").state).toBe("waiting");
  });

  it("is active by stack.create, with the matching detail", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({ actionName: "stack.create", status: "RUNNING", serviceIds: ["svc-1"] }),
      ],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Creating the container",
    });
  });

  it("is active by stack.start, with the matching detail", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [process({ actionName: "stack.start", status: "PENDING", serviceIds: ["svc-1"] })],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Starting the container",
    });
  });

  it("is active by stack.deploy, with the matching detail", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({ actionName: "stack.deploy", status: "RUNNING", serviceIds: ["svc-1"] }),
      ],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Deploying the container",
    });
  });

  it("is active with substeps when stack.build carries an appVersion", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({
          actionName: "stack.build",
          status: "RUNNING",
          serviceIds: ["svc-1"],
          appVersion: { status: "BUILDING", build: { pipelineStart: "p", startDate: "s" } },
        }),
      ],
    };
    const step = stepOf(facts, "container");
    expect(step).toMatchObject({ state: "active", detail: "Building the container" });
    expect(step.substeps?.length).toBeGreaterThan(0);
  });

  it("falls back to a generic wait when the container has no running process and no recognized status yet", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "NEW", hasOrigin: false },
      processes: [],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Waiting for the container",
    });
  });

  it("reads READY_TO_DEPLOY with nothing running as preparing the container", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "READY_TO_DEPLOY", hasOrigin: false },
      processes: [],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Preparing the container",
    });
  });

  it("reads CREATING with nothing running yet as starting the container", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Starting the container",
    });
  });

  it("is done once ACTIVE and nothing is still running", () => {
    expect(stepOf(SETTLED, "container").state).toBe("done");
  });

  it("takes its timestamps from the first stack.create", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      processes: [
        process({
          actionName: "stack.create",
          status: "FINISHED",
          serviceIds: ["svc-1"],
          createdAt: "2026-09-22T10:00:00Z",
          startedAt: "2026-09-22T10:00:01Z",
          finishedAt: "2026-09-22T10:00:05Z",
        }),
        process({
          actionName: "stack.create",
          status: "FINISHED",
          serviceIds: ["svc-1"],
          createdAt: "2026-09-22T10:00:10Z",
          startedAt: "2026-09-22T10:00:11Z",
          finishedAt: "2026-09-22T10:00:15Z",
        }),
      ],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      startedAt: "2026-09-22T10:00:01Z",
      endedAt: "2026-09-22T10:00:05Z",
    });
  });

  it("fails when a governing process fails, using its fail reason", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({
          actionName: "stack.build",
          status: "FAILED",
          serviceIds: ["svc-1"],
          failReason: "out of memory",
        }),
      ],
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps[1]).toMatchObject({
      id: "container",
      state: "failed",
      detail: "out of memory",
    });
    expect(progress.steps.slice(2).every((step) => step.state === "waiting")).toBe(true);
  });

  it("fails on the service status alone (no failed process observed)", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      container: { serviceId: "svc-1", status: "ACTION_FAILED", hasOrigin: false },
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "failed",
      detail: "Could not be created.",
    });
  });

  it("ignores a process against a different service once the service id is known", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({ actionName: "stack.build", status: "RUNNING", serviceIds: ["svc-OTHER"] }),
      ],
    };
    // The foreign process must not supply a detail — it falls through to the
    // container's own status, same as if no process existed at all.
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Starting the container",
    });
  });

  it("matches a process whose serviceIds also name the build helper service", () => {
    // Measured live: stack.build's serviceStacks list both the container
    // (zcp) and its build helper (buildzcpv<digits>) — a platform helper,
    // not the Mate's own container. "Targets the container" only needs the
    // container's own id to be among the ids listed; extra ids are fine.
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "zcp-svc-id", status: "CREATING", hasOrigin: false },
      processes: [
        process({
          actionName: "stack.build",
          status: "RUNNING",
          serviceIds: ["zcp-svc-id", "buildzcpv18234"],
        }),
      ],
    };
    expect(stepOf(facts, "container")).toMatchObject({
      state: "active",
      detail: "Building the container",
    });
  });
});

describe("public-access step", () => {
  it("waits while the container is not yet done", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [process({ actionName: "stack.build", status: "RUNNING", serviceIds: ["svc-1"] })],
    };
    expect(stepOf(facts, "public-access").state).toBe("waiting");
  });

  it("is active while stack.enableSubdomainAccess runs", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "ACTIVE", hasOrigin: false },
      processes: [
        process({
          actionName: "stack.enableSubdomainAccess",
          status: "RUNNING",
          serviceIds: ["svc-1"],
        }),
      ],
    };
    expect(stepOf(facts, "public-access")).toMatchObject({
      state: "active",
      detail: "Opening public access",
    });
  });

  it("is active once the container is ACTIVE but no origin is known yet", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "ACTIVE", hasOrigin: false },
    };
    expect(stepOf(facts, "public-access")).toMatchObject({
      state: "active",
      detail: "Opening public access",
    });
  });

  it("is done once an origin is known and nothing is still opening it", () => {
    expect(stepOf(SETTLED, "public-access").state).toBe("done");
  });

  it("fails when stack.enableSubdomainAccess fails", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      container: { serviceId: "svc-1", status: "ACTIVE", hasOrigin: false },
      processes: [
        process({
          actionName: "stack.enableSubdomainAccess",
          status: "FAILED",
          serviceIds: ["svc-1"],
          failReason: "no subdomain slots",
        }),
      ],
    };
    expect(stepOf(facts, "public-access")).toMatchObject({
      state: "failed",
      detail: "no subdomain slots",
    });
  });
});

describe("hardening step", () => {
  it("waits while public access — its own predecessor — isn't done yet", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
    };
    expect(stepOf(facts, "hardening").state).toBe("waiting");
  });

  it("is active while awaiting-settled once public access is done", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: "awaiting-settled",
      health: undefined,
      connection: "none",
    };
    expect(stepOf(facts, "hardening")).toMatchObject({
      state: "active",
      detail: "Closing the project off",
    });
  });

  it("is active while the phase itself is hardening", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: "hardening",
      health: undefined,
      connection: "none",
    };
    expect(stepOf(facts, "hardening")).toMatchObject({
      state: "active",
      detail: "Closing the project off",
    });
  });

  it("ignores stack.updateProjectEnvs — the creation writes the project's variables too", () => {
    // Measured 2026-09-22: one runs at +24 s, while the project itself is
    // still being created and no container exists; read as hardening, the
    // checklist showed "Closing off" active beside "Creating the project".
    for (const status of ["RUNNING", "FINISHED"] as const) {
      const facts: BirthFacts = {
        ...SETTLED,
        ...NOT_YET,
        project: { status: "CREATING" },
        container: undefined,
        processes: [process({ actionName: "stack.updateProjectEnvs", status })],
      };
      expect(stepOf(facts, "hardening").state).toBe("waiting");
      expect(deriveBirthProgress(facts, NOW).active?.id).toBe("project");
    }
  });

  /**
   * Measured live: the Git broker fires three stack.updateUserData against
   * the container ~90s after hardening's own updateProjectEnvs has already
   * finished — GITEA_TOKEN/MATE_BROKER_URL, the group's "Setting up its
   * repositories…". It must not reopen this step.
   */
  it("ignores stack.updateUserData — that is the Git broker, not hardening", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      // Public access not done yet either, so the null-phase fallback below
      // cannot supply an "active" the updateUserData process didn't earn.
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [process({ actionName: "stack.updateUserData", status: "RUNNING" })],
    };
    expect(stepOf(facts, "hardening").state).toBe("waiting");
  });

  /**
   * The gap: this tab's provisioning wait slot is not on the project — a
   * second tab, or a reload before the resume seeds it — so there is no
   * `provisioningPhase` to read hardening off. With
   * public access already done, hardening must still read as the step
   * actually running, not "waiting" alongside mate: the birth never skips it.
   */
  it("is active on no evidence at all, once public access is already done and this tab has no wait slot", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: null,
      health: undefined,
      connection: "none",
      processes: [],
    };
    expect(stepOf(facts, "hardening")).toMatchObject({
      state: "active",
      detail: "Closing the project off",
    });
  });

  it("is done once the phase has moved past it", () => {
    for (const phase of ["awaiting-health", "needs-enable", "ready"] as const) {
      const facts: BirthFacts = { ...SETTLED, provisioningPhase: phase };
      expect(stepOf(facts, "hardening").state).toBe("done");
    }
  });

  it("fails on a reported harden error", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: "hardening",
      hardenError: "token rotation failed",
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps[3]).toMatchObject({
      id: "hardening",
      state: "failed",
      detail: "token rotation failed",
    });
    expect(progress.steps.slice(4).every((step) => step.state === "waiting")).toBe(true);
  });
});

describe("mate step", () => {
  it("waits while hardening is not done", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: "hardening",
      health: undefined,
      connection: "none",
    };
    expect(stepOf(facts, "mate").state).toBe("waiting");
  });

  it.each([
    ["undefined", undefined],
    ["unreachable", "unreachable" as const],
    ["initializing", "initializing" as const],
  ])("is active waiting for Zerops Mate to answer when health is %s", (_name, health) => {
    const facts: BirthFacts = { ...SETTLED, health, connection: "none" };
    expect(stepOf(facts, "mate")).toMatchObject({
      state: "active",
      detail: "Waiting for Zerops Mate to answer",
    });
  });

  it("is active with its own detail when the container predates Mate", () => {
    const facts: BirthFacts = { ...SETTLED, health: "predates-mate", connection: "none" };
    expect(stepOf(facts, "mate")).toMatchObject({
      state: "active",
      detail: "This container predates Zerops Mate",
    });
  });

  it("is done once health reads ready", () => {
    expect(stepOf(SETTLED, "mate").state).toBe("done");
  });

  it("is done once the client is already connecting/connected, even without a fresh health read", () => {
    const facts: BirthFacts = { ...SETTLED, health: undefined, connection: "connecting" };
    expect(stepOf(facts, "mate").state).toBe("done");
  });

  it("fails when health reports stalled", () => {
    const facts: BirthFacts = { ...SETTLED, health: "stalled", connection: "none" };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps[4]).toMatchObject({
      id: "mate",
      state: "failed",
      detail: "Zerops Mate never answered",
    });
    expect(progress.steps[5]!.state).toBe("waiting");
  });
});

describe("connect step", () => {
  it("waits while mate is not yet done", () => {
    const facts: BirthFacts = { ...SETTLED, health: undefined, connection: "none" };
    expect(stepOf(facts, "connect").state).toBe("waiting");
  });

  it("is active once mate is done but the client has not connected", () => {
    const facts: BirthFacts = { ...SETTLED, connection: "none" };
    expect(stepOf(facts, "connect")).toMatchObject({ state: "active", detail: "Opening the Mate" });
  });

  it("is done once connected", () => {
    expect(stepOf(SETTLED, "connect").state).toBe("done");
  });

  it("fails when the connection itself failed", () => {
    const facts: BirthFacts = { ...SETTLED, connection: "failed" };
    expect(stepOf(facts, "connect").state).toBe("failed");
  });
});

describe("invariants", () => {
  it("backfills every earlier step to done rather than showing a gap (the inventory flapping mid-birth)", () => {
    // Container is ACTIVE with an origin and health reads ready, but this
    // client never tracked a provisioning phase for it (e.g. a reload) — the
    // inventory-only view of hardening must not show as unstarted.
    const facts: BirthFacts = { ...SETTLED, provisioningPhase: null };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(progress.complete).toBe(true);
  });

  it("is complete with everything done on a plain reload after birth, with no process facts at all", () => {
    const facts: BirthFacts = { ...SETTLED, provisioningPhase: null, processes: [] };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.doneCount).toBe(6);
    expect(progress.complete).toBe(true);
    expect(progress.active).toBeNull();
    expect(progress.failed).toBeNull();
  });

  it("reads closing off active until the Mate answers when this tab has no wait slot", () => {
    // provisioningPhase null (a second tab, or a reload before the resume
    // seeds the wait): nothing on the platform says hardening is over, so
    // the step stays the active one until an answering Mate proves it.
    const facts: BirthFacts = {
      project: { status: "ACTIVE" },
      container: { serviceId: "svc-1", status: "ACTIVE", hasOrigin: true },
      processes: [
        process({
          actionName: "stack.enableSubdomainAccess",
          status: "FINISHED",
          serviceIds: ["svc-1"],
        }),
      ],
      health: "initializing",
      provisioningPhase: null,
      connection: "none",
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.active?.id).toBe("hardening");
    expect(stepOf({ ...facts, health: "ready" }, "hardening").state).toBe("done");
  });

  it("never shows more than one active step", () => {
    const facts: BirthFacts = {
      project: { status: "CREATING" },
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      // Real platform timing: build and enableSubdomainAccess can start together.
      processes: [
        process({ actionName: "stack.build", status: "RUNNING", serviceIds: ["svc-1"] }),
        process({
          actionName: "stack.enableSubdomainAccess",
          status: "RUNNING",
          serviceIds: ["svc-1"],
        }),
      ],
      health: undefined,
      provisioningPhase: null,
      connection: "none",
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps.filter((step) => step.state === "active")).toHaveLength(1);
  });

  it("prefers project.create's createdAt as the overall start", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      processes: [
        process({
          actionName: "project.create",
          status: "FINISHED",
          createdAt: "2026-09-22T09:58:00Z",
        }),
      ],
      requestedAt: "2026-09-22T09:59:00Z",
    };
    expect(deriveBirthProgress(facts, NOW).startedAt).toBe("2026-09-22T09:58:00Z");
  });

  it("falls back to the project row's createdAt, then to requestedAt", () => {
    const withProjectStamp: BirthFacts = {
      ...SETTLED,
      project: { status: "ACTIVE", createdAt: "2026-09-22T09:58:30Z" },
      requestedAt: "2026-09-22T09:59:00Z",
    };
    expect(deriveBirthProgress(withProjectStamp, NOW).startedAt).toBe("2026-09-22T09:58:30Z");

    const onlyRequested: BirthFacts = {
      project: undefined,
      container: undefined,
      processes: [],
      health: undefined,
      provisioningPhase: null,
      connection: "none",
      requestedAt: "2026-09-22T09:59:00Z",
    };
    expect(deriveBirthProgress(onlyRequested, NOW).startedAt).toBe("2026-09-22T09:59:00Z");
  });
});

describe("a wait phase ahead of the processes (measured 2026-09-22, +7 s)", () => {
  it("keeps the container active while awaiting-settled and the build is still queued", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      provisioningPhase: "awaiting-settled",
      container: { serviceId: "svc-1", status: "READY_TO_DEPLOY", hasOrigin: false },
      processes: [process({ actionName: "stack.build", status: "PENDING", serviceIds: ["svc-1"] })],
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.active?.id).toBe("container");
    expect(stepOf(facts, "hardening").state).toBe("waiting");
    expect(progress.doneCount).toBe(1);
  });

  it("never backfills earlier steps from a later step that is only active", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      provisioningPhase: "hardening",
      container: { serviceId: "svc-1", status: "READY_TO_DEPLOY", hasOrigin: false },
      processes: [process({ actionName: "stack.build", status: "RUNNING", serviceIds: ["svc-1"] })],
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(stepOf(facts, "container").state).toBe("active");
    expect(progress.active?.id).toBe("container");
  });
});

describe("steps that finish out of order (measured 2026-09-22, a cached container image)", () => {
  it("keeps the container active when closing off is already done", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      ...NOT_YET,
      provisioningPhase: "awaiting-health",
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
      processes: [
        process({ actionName: "stack.build", status: "RUNNING", serviceIds: ["svc-1"] }),
        process({ actionName: "stack.updateProjectEnvs", status: "FINISHED" }),
      ],
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(stepOf(facts, "hardening").state).toBe("done");
    expect(stepOf(facts, "container").state).toBe("active");
    expect(stepOf(facts, "mate").state).toBe("waiting");
    expect(progress.active?.id).toBe("container");
    expect(progress.doneCount).toBe(2);
  });

  it("still backfills everything from a Mate that answers", () => {
    const facts: BirthFacts = {
      ...SETTLED,
      provisioningPhase: null,
      connection: "none",
      health: "ready",
      project: { status: "CREATING" },
      container: { serviceId: "svc-1", status: "CREATING", hasOrigin: false },
    };
    const progress = deriveBirthProgress(facts, NOW);
    expect(progress.steps.slice(0, 5).map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(progress.active?.id).toBe("connect");
  });
});

/**
 * A Mate's runtimes come up beside it once its project is closed off (`createEnvironment.ts`):
 * a track of their own the Mate's view can draw — never one of the six steps, which stay the
 * Mate's own, and never what the sign-in waits on.
 */
describe("the runtimes", () => {
  const PLANNED = [
    { hostname: "appdev", role: "dev" },
    { hostname: "appstage", role: "stage" },
    { hostname: "mail", role: "utility" },
  ] as const;
  const listed = (statuses: Readonly<Record<string, string>>): BirthRuntimesFacts["runtimes"] =>
    PLANNED.map((runtime) =>
      statuses[runtime.hostname] === undefined
        ? runtime
        : {
            ...runtime,
            service: { id: `svc-${runtime.hostname}`, status: statuses[runtime.hostname]! },
          },
    );
  const runtimesOf = (
    runtimes: BirthRuntimesFacts,
    processes: ReadonlyArray<BirthProcessFact> = [],
  ) => deriveBirthProgress({ ...SETTLED, processes, runtimes }, NOW).runtimes;

  it.each([
    {
      case: "waiting for the project to be closed off",
      facts: { import: "waiting", runtimes: listed({}) },
      want: { state: "waiting", up: 0, total: 3 },
    },
    {
      case: "being asked for",
      facts: { import: "importing", runtimes: listed({}) },
      want: { state: "active", up: 0, total: 3, detail: "Adding the runtimes" },
    },
    {
      case: "created, one on its way",
      facts: {
        import: "imported",
        runtimes: listed({ appdev: "ACTIVE", appstage: "READY_TO_DEPLOY", mail: "CREATING" }),
      },
      want: { state: "active", up: 2, total: 3, detail: "Bringing the runtimes up" },
    },
    {
      case: "all up — a stage half waiting for its first deploy counts as up",
      facts: {
        import: "imported",
        runtimes: listed({ appdev: "ACTIVE", appstage: "READY_TO_DEPLOY", mail: "ACTIVE" }),
      },
      want: { state: "done", up: 3, total: 3 },
    },
    {
      case: "refused by the platform",
      facts: { import: { failed: "The hostname appdev is taken." }, runtimes: listed({}) },
      want: { state: "failed", up: 0, total: 3, detail: "The hostname appdev is taken." },
    },
    {
      case: "one that failed to start",
      facts: {
        import: "imported",
        runtimes: listed({
          appdev: "CONTAINER_FAILED",
          appstage: "READY_TO_DEPLOY",
          mail: "ACTIVE",
        }),
      },
      want: { state: "failed", up: 2, total: 3, detail: "appdev did not come up." },
    },
  ] satisfies ReadonlyArray<{ case: string; facts: BirthRuntimesFacts; want: object }>)(
    "reads the runtimes $case",
    ({ facts, want }) => {
      expect(runtimesOf(facts)).toMatchObject(want);
    },
  );

  it.each([
    { case: "a dev half", hostname: "appdev", status: "READY_TO_DEPLOY", state: "active" },
    { case: "a utility", hostname: "mail", status: "READY_TO_DEPLOY", state: "active" },
    { case: "a stage half", hostname: "appstage", status: "READY_TO_DEPLOY", state: "done" },
    { case: "a dev half running", hostname: "appdev", status: "ACTIVE", state: "done" },
  ])(
    "is up once $case reads its resting status: $status → $state",
    ({ hostname, status, state }) => {
      const progress = runtimesOf({ import: "imported", runtimes: listed({ [hostname]: status }) });
      expect(progress?.runtimes.find((runtime) => runtime.hostname === hostname)?.state).toBe(
        state,
      );
    },
  );

  it("reads a utility whose build failed as failed, though its status only waits", () => {
    // A build that fails leaves the service at READY_TO_DEPLOY for good.
    const progress = runtimesOf(
      {
        import: "imported",
        runtimes: listed({
          appdev: "ACTIVE",
          appstage: "READY_TO_DEPLOY",
          mail: "READY_TO_DEPLOY",
        }),
      },
      [process({ actionName: "stack.build", status: "FAILED", serviceIds: ["svc-mail"] })],
    );
    expect(progress?.runtimes.find((runtime) => runtime.hostname === "mail")?.state).toBe("failed");
    expect(progress).toMatchObject({ state: "failed", detail: "mail did not come up." });
  });

  it("keeps the Mate's six steps as they were, and has no track for a birth that imports none", () => {
    const progress = deriveBirthProgress(
      { ...SETTLED, runtimes: { import: "importing", runtimes: listed({}) } },
      NOW,
    );
    expect(progress.steps.map((step) => step.id)).toEqual([
      "project",
      "container",
      "public-access",
      "hardening",
      "mate",
      "connect",
    ]);
    expect(progress.complete).toBe(true);
    expect(deriveBirthProgress(SETTLED, NOW).runtimes).toBeUndefined();
  });
});

describe("birthRuntimesFacts", () => {
  const RUNTIMES = {
    yaml: "services:\n  - hostname: appdev\n  - hostname: appstage\n",
    services: [
      { hostname: "appdev", role: "dev" },
      { hostname: "appstage", role: "stage" },
    ],
  } as const;
  const service = (name: string, status: string, category = "USER"): ZeropsService => ({
    id: `svc-${name}`,
    name,
    status,
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: name === "zcp" ? "zcp@1" : "nodejs@22",
      serviceStackTypeCategory: category,
    },
  });

  it.each([
    { step: "tags", want: "waiting" },
    { step: "harden", want: "waiting" },
    { step: "runtimes", want: "importing" },
    { step: "health", want: "imported" },
  ] as const)("reads a birth at $step as $want", ({ step, want }) => {
    expect(birthRuntimesFacts({ birth: { step, runtimes: RUNTIMES }, services: [] })?.import).toBe(
      want,
    );
  });

  it("names each planned runtime with its service, once the project lists it", () => {
    expect(
      birthRuntimesFacts({
        birth: { step: "health", runtimes: RUNTIMES },
        services: [service("zcp", "ACTIVE"), service("appdev", "CREATING")],
      })?.runtimes,
    ).toEqual([
      { hostname: "appdev", role: "dev", service: { id: "svc-appdev", status: "CREATING" } },
      { hostname: "appstage", role: "stage" },
    ]);
  });

  it("says the import failed in the platform's words", () => {
    expect(
      birthRuntimesFacts({
        birth: { step: "health", runtimes: { ...RUNTIMES, failed: "No." } },
        services: [],
      })?.import,
    ).toEqual({ failed: "No." });
  });

  it("reads a Mate whose birth is over off its project's own runtimes", () => {
    // The connect ends the birth as the Mate answers, while its runtimes may still be coming up.
    expect(
      birthRuntimesFacts({
        birth: undefined,
        services: [
          service("zcp", "ACTIVE"),
          service("appdev", "ACTIVE"),
          service("appstage", "READY_TO_DEPLOY"),
          service("db", "ACTIVE", "STANDARD"),
        ],
      }),
    ).toEqual({
      import: "imported",
      runtimes: [
        { hostname: "appdev", role: "dev", service: { id: "svc-appdev", status: "ACTIVE" } },
        {
          hostname: "appstage",
          role: "stage",
          service: { id: "svc-appstage", status: "READY_TO_DEPLOY" },
        },
      ],
    });
  });

  it("reads a Mate whose birth is over in one order however the listing comes", () => {
    // The listing's order is its own and changes between reads (a live add, 2026-09-30, at 168 s).
    const names = (services: ReadonlyArray<ZeropsService>) =>
      birthRuntimesFacts({ birth: undefined, services })?.runtimes.map(
        (runtime) => runtime.hostname,
      );
    const listed = ["webdev", "appstage", "mailpit", "appdev", "webstage"].map((name) =>
      service(name, "ACTIVE"),
    );
    expect(names(listed)).toEqual(["appdev", "appstage", "mailpit", "webdev", "webstage"]);
    expect(names([...listed].sort((left, right) => right.name.localeCompare(left.name)))).toEqual(
      names(listed),
    );
  });

  it.each([
    { case: "a birth that imports none", birth: { step: "health" as const }, services: [] },
    { case: "a project with no runtime", birth: undefined, services: [service("zcp", "ACTIVE")] },
    { case: "a project not read yet", birth: undefined, services: undefined },
  ])("has no runtimes for $case", ({ birth, services }) => {
    expect(birthRuntimesFacts({ birth, services })).toBeUndefined();
  });
});

describe("birthCopyServices", () => {
  const service = (
    name: string,
    status: string,
    category = "STANDARD",
    isSystem = false,
  ): ZeropsService => ({
    id: `svc-${name}`,
    name,
    status,
    isSystem,
    serviceStackTypeInfo: {
      serviceStackTypeVersionName: name === "zcp" ? "zcp@1" : "postgresql@17",
      serviceStackTypeCategory: category,
    },
  });

  it("names the managed services its birth planned, in the tier's order, each as far as it has come", () => {
    expect(
      birthCopyServices({
        planned: ["db", "cache", "storage", "search"],
        services: [
          service("storage", "ACTIVE", "OBJECT_STORAGE"),
          service("db", "CREATING"),
          service("search", "ACTION_FAILED"),
        ],
      }),
    ).toEqual([
      { hostname: "db", state: "active" },
      { hostname: "cache", state: "waiting" },
      { hostname: "storage", state: "done" },
      { hostname: "search", state: "failed" },
    ]);
  });

  it("reads a Mate whose birth is over off its project's managed services, in one order", () => {
    const services = [
      service("zcp", "ACTIVE", "USER"),
      service("storage", "ACTIVE", "OBJECT_STORAGE"),
      service("appdev", "ACTIVE", "USER"),
      service("core", "ACTIVE", "CORE", true),
      service("db", "NEW"),
    ];
    const read = birthCopyServices({ planned: undefined, services });
    expect(read).toEqual([
      { hostname: "db", state: "active" },
      { hostname: "storage", state: "done" },
    ]);
    expect(
      birthCopyServices({
        planned: undefined,
        services: [...services].sort((left, right) => right.name.localeCompare(left.name)),
      }),
    ).toEqual(read);
  });

  it.each([
    { case: "a tier with no managed service", planned: [], services: [] },
    {
      case: "a project with none",
      planned: undefined,
      services: [service("zcp", "ACTIVE", "USER")],
    },
    { case: "a project not read yet", planned: undefined, services: undefined },
  ])("names none for $case", ({ planned, services }) => {
    expect(birthCopyServices({ planned, services })).toBeUndefined();
  });
});
