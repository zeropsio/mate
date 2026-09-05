import { describe, expect, it } from "vite-plus/test";
import type { ZeropsStateEnvelope } from "@t3tools/contracts";

import { composeSession } from "./session.ts";
import type { ZeropsOperation } from "./types.ts";

const envelope = (overrides: Record<string, unknown>): ZeropsStateEnvelope =>
  ({
    phase: "idle",
    environment: "container",
    project: { id: "proj-1", name: "z3-eval" },
    services: [],
    generated: "2026-08-28T10:00:00Z",
    ...overrides,
  }) as unknown as ZeropsStateEnvelope;

const service = (hostname: string) => ({
  hostname,
  typeVersion: "nodejs@22",
  runtimeClass: "runtime",
  status: "ACTIVE",
  bootstrapped: true,
});

const bootstrapOperation = (overrides: Partial<ZeropsOperation>): ZeropsOperation =>
  ({
    key: "bootstrap:f1",
    kind: "bootstrap",
    phase: "running",
    anchorAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "f1",
    turnId: "t1",
    subject: "weatherdash",
    kicker: "New service · weatherdash",
    voice: "Setting up weatherdash.",
    voiceSource: "mate",
    statusWord: "In progress",
    steps: [],
    links: [],
    callIds: ["f1"],
    attempts: 1,
    hasResult: true,
    session: { sessionIds: ["sess1"], completed: 1, total: 3 },
    ...overrides,
  }) as unknown as ZeropsOperation;

describe("composeSession", () => {
  it("is empty when there is no envelope and no bootstrap operation", () => {
    expect(composeSession(undefined, [])).toEqual({});
  });

  it("reads idleScenario and serviceCount only during the idle phase", () => {
    const session = composeSession(
      envelope({
        phase: "idle",
        idleScenario: "bootstrapped",
        services: [service("a"), service("b")],
      }),
      [],
    );
    expect(session.phase).toBe("idle");
    expect(session.idleScenario).toBe("bootstrapped");
    expect(session.serviceCount).toBe(2);
  });

  it("omits idleScenario/serviceCount outside the idle phase", () => {
    const session = composeSession(envelope({ phase: "develop-active" }), []);
    expect(session.idleScenario).toBeUndefined();
    expect(session.serviceCount).toBeUndefined();
  });

  it("exposes the work session keyed by its createdAt, with deploy/verify attempts", () => {
    const session = composeSession(
      envelope({
        phase: "develop-active",
        workSession: {
          intent: "build a kanban",
          services: ["kanbandev"],
          createdAt: "2026-08-28T10:00:00Z",
          deploys: { kanbandev: [{ at: "2026-08-28T10:00:00Z", success: true, iteration: 1 }] },
        },
      }),
      [],
    );
    expect(session.work?.key).toBe("work:2026-08-28T10:00:00Z");
    expect(session.work?.intent).toBe("build a kanban");
    expect(session.work?.deploys?.kanbandev).toEqual([{ success: true }]);
    expect(session.work?.verifies).toBeUndefined();
  });

  it("exposes the most recently anchored bootstrap operation, with its running step", () => {
    const older = bootstrapOperation({
      key: "bootstrap:old",
      anchorAt: "2026-09-01T00:00:00.000Z",
      session: { sessionIds: ["sessOld"], completed: 3, total: 3 },
    });
    const newer = bootstrapOperation({
      key: "bootstrap:new",
      anchorAt: "2026-09-01T00:05:00.000Z",
      session: { sessionIds: ["sessNew"], intent: "adopt s3git1", completed: 1, total: 3 },
      steps: [{ id: "discover", label: "Discover", state: "running", stateLabel: "Running" }],
    });
    const session = composeSession(envelope({ phase: "bootstrap-active" }), [older, newer]);
    expect(session.bootstrap?.key).toBe("bootstrap:new");
    expect(session.bootstrap?.sessionIds).toEqual(["sessNew"]);
    expect(session.bootstrap?.intent).toBe("adopt s3git1");
    expect(session.bootstrap?.step).toBe("Discover");
    expect(session.bootstrap?.completed).toBe(1);
    expect(session.bootstrap?.total).toBe(3);
  });

  it("omits step when no step is running", () => {
    const done = bootstrapOperation({ phase: "done", steps: [] });
    const session = composeSession(envelope({ phase: "idle" }), [done]);
    expect(session.bootstrap?.step).toBeUndefined();
  });
});
