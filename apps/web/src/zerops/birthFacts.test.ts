/**
 * Table-driven tests for the pure adapter from what the projects page holds
 * (a candidate, its project's activity, its health probe, the provisioning
 * wait, and the page's own connection judgement) into `BirthFacts` — the
 * shape `deriveBirthProgress` (`@t3tools/client-runtime/zerops/birthProgress`)
 * reads.
 */
import { describe, expect, it } from "vite-plus/test";

import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";

import { deriveBirthFacts, type BirthFactsInput } from "./birthFacts";

const PROJECT: ZeropsCandidate["project"] = {
  id: "project-1",
  name: "acme-docs-dev",
  status: "ACTIVE",
  created: "2026-09-22T09:58:00Z",
};

function candidate(partial: Partial<ZeropsCandidate> = {}): ZeropsCandidate {
  return {
    key: "project-1:svc-1",
    project: PROJECT,
    group: "provisioning",
    ...partial,
  };
}

function input(partial: Partial<BirthFactsInput> = {}): BirthFactsInput {
  return {
    candidate: candidate(),
    processes: undefined,
    health: undefined,
    provisioningPhase: null,
    connecting: false,
    connectionFailed: false,
    ...partial,
  };
}

function process(
  partial: Partial<ActivityProcess> & Pick<ActivityProcess, "actionName" | "status">,
) {
  return {
    id: "proc-1",
    projectId: "project-1",
    serviceStackIds: [],
    created: "2026-09-22T10:00:00Z",
    ...partial,
  } satisfies ActivityProcess;
}

describe("deriveBirthFacts — project", () => {
  it("reads the project's status and createdAt off the candidate", () => {
    const facts = deriveBirthFacts(input());
    expect(facts.project).toEqual({ status: "ACTIVE", createdAt: "2026-09-22T09:58:00Z" });
  });

  it("leaves createdAt out when the project carries none", () => {
    const { created: _created, ...projectWithoutCreated } = PROJECT;
    const facts = deriveBirthFacts(
      input({ candidate: candidate({ project: projectWithoutCreated }) }),
    );
    expect(facts.project).toEqual({ status: "ACTIVE" });
  });
});

describe("deriveBirthFacts — container", () => {
  it("is undefined while the candidate carries no service yet", () => {
    const facts = deriveBirthFacts(input());
    expect(facts.container).toBeUndefined();
  });

  it("reads the service id, status and whether an origin is known", () => {
    const facts = deriveBirthFacts(
      input({
        candidate: candidate({
          service: { id: "svc-1", name: "zcp", status: "CREATING" },
        }),
      }),
    );
    expect(facts.container).toEqual({ serviceId: "svc-1", status: "CREATING", hasOrigin: false });
  });

  it("reads hasOrigin true once the candidate carries a container origin", () => {
    const facts = deriveBirthFacts(
      input({
        candidate: candidate({
          service: { id: "svc-1", name: "zcp", status: "ACTIVE" },
          containerOrigin: "https://zcp-acme-docs-dev.example.zerops.app",
        }),
      }),
    );
    expect(facts.container).toEqual({ serviceId: "svc-1", status: "ACTIVE", hasOrigin: true });
  });
});

describe("deriveBirthFacts — processes", () => {
  it("is empty while the caller has no activity read yet", () => {
    const facts = deriveBirthFacts(input({ processes: undefined }));
    expect(facts.processes).toEqual([]);
  });

  it("keeps only this project's own processes", () => {
    const facts = deriveBirthFacts(
      input({
        processes: [
          process({ actionName: "stack.create", status: "RUNNING", projectId: "project-1" }),
          process({ actionName: "stack.create", status: "RUNNING", projectId: "OTHER" }),
        ],
      }),
    );
    expect(facts.processes).toHaveLength(1);
  });

  it("maps a known process status, its timestamps, serviceIds and appVersion through", () => {
    const facts = deriveBirthFacts(
      input({
        processes: [
          process({
            actionName: "stack.build",
            status: "FINISHED",
            created: "2026-09-22T10:00:00Z",
            started: "2026-09-22T10:00:01Z",
            finished: "2026-09-22T10:00:05Z",
            serviceStackIds: ["svc-1", "svc-build-helper"],
            appVersion: { id: "av-1", status: "BUILDING" },
          }),
        ],
      }),
    );
    expect(facts.processes).toEqual([
      {
        actionName: "stack.build",
        status: "FINISHED",
        createdAt: "2026-09-22T10:00:00Z",
        startedAt: "2026-09-22T10:00:01Z",
        finishedAt: "2026-09-22T10:00:05Z",
        serviceIds: ["svc-1", "svc-build-helper"],
        appVersion: { id: "av-1", status: "BUILDING" },
        failReason: undefined,
      },
    ]);
  });

  it("reads a process with no started/finished timestamp yet as null, never undefined", () => {
    const facts = deriveBirthFacts(
      input({ processes: [process({ actionName: "stack.create", status: "PENDING" })] }),
    );
    expect(facts.processes[0]).toMatchObject({ startedAt: null, finishedAt: null });
  });

  it("wraps a process status outside the known set as the unknown fallback shape", () => {
    const facts = deriveBirthFacts(
      input({
        processes: [process({ actionName: "stack.create", status: "SOME_FUTURE_STATUS" })],
      }),
    );
    expect(facts.processes[0]?.status).toEqual({ kind: "unknown", raw: "SOME_FUTURE_STATUS" });
  });

  it.each(["PENDING", "RUNNING", "ROLLBACKING", "CANCELING", "FINISHED", "FAILED", "CANCELED"])(
    "reads %s as the known literal, not the unknown fallback",
    (status) => {
      const facts = deriveBirthFacts(
        input({ processes: [process({ actionName: "stack.create", status })] }),
      );
      expect(facts.processes[0]?.status).toBe(status);
    },
  );
});

describe("deriveBirthFacts — straight-through reads", () => {
  it("passes health, provisioningPhase and hardenError through unchanged", () => {
    const facts = deriveBirthFacts(
      input({
        health: "ready",
        provisioningPhase: "hardening",
        hardenError: "token rotation failed",
      }),
    );
    expect(facts.health).toBe("ready");
    expect(facts.provisioningPhase).toBe("hardening");
    expect(facts.hardenError).toBe("token rotation failed");
  });

  it("passes requestedAt through unchanged", () => {
    const facts = deriveBirthFacts(input({ requestedAt: "2026-09-22T09:59:00Z" }));
    expect(facts.requestedAt).toBe("2026-09-22T09:59:00Z");
  });

  it("reads creationFailed's message off the candidate", () => {
    const facts = deriveBirthFacts(
      input({ candidate: candidate({ creationFailed: { message: "no ready project" } }) }),
    );
    expect(facts.creationFailed).toEqual({ message: "no ready project" });
  });

  it("leaves creationFailed out when the candidate carries none", () => {
    const facts = deriveBirthFacts(input());
    expect(facts.creationFailed).toBeUndefined();
  });
});

describe("deriveBirthFacts — connection", () => {
  it("reads connected once the candidate's own group says so, outranking every other flag", () => {
    const facts = deriveBirthFacts(
      input({
        candidate: candidate({ group: "connected" }),
        connectionFailed: true,
        connecting: true,
      }),
    );
    expect(facts.connection).toBe("connected");
  });

  it("reads failed only from the page's own verdict flag", () => {
    const facts = deriveBirthFacts(input({ connectionFailed: true }));
    expect(facts.connection).toBe("failed");
  });

  it("reads connecting from the page's own flag", () => {
    const facts = deriveBirthFacts(input({ connecting: true }));
    expect(facts.connection).toBe("connecting");
  });

  it("reads none when nothing says otherwise", () => {
    const facts = deriveBirthFacts(input());
    expect(facts.connection).toBe("none");
  });
});
