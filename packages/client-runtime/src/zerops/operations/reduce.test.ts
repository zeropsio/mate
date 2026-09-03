import { describe, expect, it } from "vite-plus/test";

import {
  addMariadb,
  adoptTwoServices,
  callEntriesFromThread,
  mountStatus,
  verifyAndRefusedDeploy,
  weatherdashFirstDeploy,
} from "./__fixtures__/callEntries.ts";
import { classifyZeropsCall } from "./classify.ts";
import { reduceZeropsOperations } from "./reduce.ts";
import type { ZeropsCallEntry } from "./types.ts";

describe("reduceZeropsOperations — weatherdash-first-deploy", () => {
  const entries = callEntriesFromThread(weatherdashFirstDeploy);
  const { operations, consumedEntryIds } = reduceZeropsOperations(entries);

  it("produces bootstrap, deploy, verify in order", () => {
    expect(operations.map((o) => o.kind)).toEqual(["bootstrap", "deploy", "verify"]);
  });

  it("keys the bootstrap operation by the session id", () => {
    expect(operations[0]!.key).toBe("bootstrap:61892e75bf9a9ad9");
  });

  it("the bootstrap operation is done, voiced by the agent, with a New service kicker", () => {
    const bootstrap = operations[0]!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.voiceSource).toBe("agent");
    expect(bootstrap.voice).toContain("Nový service pro weather dashboard");
    expect(bootstrap.kicker).toBe("New service · weatherdash");
  });

  it("the bootstrap operation has three done steps, provision noting weatherdash", () => {
    const bootstrap = operations[0]!;
    expect(bootstrap.steps.map((s) => s.id)).toEqual(["discover", "provision", "close"]);
    expect(bootstrap.steps.every((s) => s.state === "done")).toBe(true);
    const provision = bootstrap.steps.find((s) => s.id === "provision")!;
    expect(provision.note).toContain("weatherdash");
  });

  it("the bootstrap operation's closing starts with Bootstrap complete", () => {
    expect(operations[0]!.closing).toMatch(/^Bootstrap complete/);
  });

  it("the deploy operation is done, subject weatherdash, live with a link", () => {
    const deploy = operations[1]!;
    expect(deploy.phase).toBe("done");
    expect(deploy.subject).toBe("weatherdash");
    expect(deploy.closing).toBe("weatherdash is live.");
    expect(deploy.links).toEqual([
      {
        label: "weatherdash-26a7.prg1.zerops.app",
        url: "https://weatherdash-26a7.prg1.zerops.app",
      },
    ]);
  });

  it("the deploy operation has Build and Deploy steps, done, voiced by the phrase producer", () => {
    const deploy = operations[1]!;
    expect(deploy.steps.map((s) => s.id)).toEqual(["build", "deploy"]);
    expect(deploy.steps.every((s) => s.state === "done")).toBe(true);
    expect(deploy.voiceSource).toBe("mate");
  });

  it("the verify operation is done with two checks and mentions the http_root hint in detail", () => {
    const verify = operations[2]!;
    expect(verify.phase).toBe("done");
    expect(verify.steps).toHaveLength(2);
    expect(verify.closing).toBe("All 2 checks passed.");
    expect(verify.detail).toContain("GET / probed only");
  });

  it("consumes every zerops_workflow call of the session and the zerops_import call", () => {
    const workflowEntries = entries.filter(
      (e) =>
        e.toolName === "zerops_workflow" &&
        classifyZeropsCall(e.toolName, e.input, e.status) === "card",
    );
    expect(workflowEntries.length).toBeGreaterThan(0);
    for (const e of workflowEntries) {
      expect(consumedEntryIds.has(e.id)).toBe(true);
    }
    const importEntry = entries.find((e) => e.toolName === "zerops_import")!;
    expect(consumedEntryIds.has(importEntry.id)).toBe(true);
    // the import never becomes its own operation — it joined the bootstrap
    expect(operations.some((o) => o.kind === "import")).toBe(false);
  });

  it("classifies the ToolSearch-style calls, route-menu start and close-mode as hidden", () => {
    const toolSearchEntry = entries.find((e) => e.toolName === "ToolSearch")!;
    expect(
      classifyZeropsCall(toolSearchEntry.toolName, toolSearchEntry.input, toolSearchEntry.status),
    ).toBe("hidden");
    const routeMenuEntry = entries.find(
      (e) =>
        e.toolName === "zerops_workflow" &&
        e.input?.action === "start" &&
        e.input?.workflow === "bootstrap" &&
        e.input?.route === undefined,
    )!;
    expect(
      classifyZeropsCall(routeMenuEntry.toolName, routeMenuEntry.input, routeMenuEntry.status),
    ).toBe("hidden");
    const closeModeEntry = entries.find((e) => e.input?.action === "close-mode")!;
    expect(
      classifyZeropsCall(closeModeEntry.toolName, closeModeEntry.input, closeModeEntry.status),
    ).toBe("hidden");
  });

  it("classifies zerops_discover and the develop start as generic", () => {
    const discoverEntry = entries.find((e) => e.toolName === "zerops_discover")!;
    expect(
      classifyZeropsCall(discoverEntry.toolName, discoverEntry.input, discoverEntry.status),
    ).toBe("generic");
    const developStart = entries.find(
      (e) => e.input?.workflow === "develop" && e.input?.action === "start",
    )!;
    expect(classifyZeropsCall(developStart.toolName, developStart.input, developStart.status)).toBe(
      "generic",
    );
  });
});

describe("reduceZeropsOperations — add-mariadb", () => {
  const entries = callEntriesFromThread(addMariadb);
  const { operations } = reduceZeropsOperations(entries);

  it("hides the status call", () => {
    const statusEntry = entries.find(
      (e) => e.toolName === "zerops_workflow" && e.input?.action === "status",
    )!;
    expect(classifyZeropsCall(statusEntry.toolName, statusEntry.input, statusEntry.status)).toBe(
      "hidden",
    );
  });

  it("has a standalone verify operation, done", () => {
    const verifies = operations.filter((o) => o.kind === "verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.phase).toBe("done");
  });

  it("bootstrap is done with a New service · db kicker and subject containing db", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.kicker).toBe("New service · db");
    expect(bootstrap.subject).toContain("db");
  });
});

describe("reduceZeropsOperations — verify-and-refused-deploy", () => {
  const entries = callEntriesFromThread(verifyAndRefusedDeploy);
  const { operations } = reduceZeropsOperations(entries);

  it("has two failed deploy operations, both mentioning the missing zerops.yml", () => {
    const deploys = operations.filter((o) => o.kind === "deploy");
    expect(deploys).toHaveLength(2);
    for (const deploy of deploys) {
      expect(deploy.phase).toBe("failed");
      expect(deploy.closing).toContain("zerops.yml not found");
      expect(deploy.detail).toBeDefined();
      expect(deploy.detail).toContain("Using config file");
    }
  });

  it("has verify operations, all done", () => {
    const verifies = operations.filter((o) => o.kind === "verify");
    expect(verifies.length).toBeGreaterThan(0);
    for (const verify of verifies) {
      expect(verify.phase).toBe("done");
    }
  });
});

describe("reduceZeropsOperations — adopt-two-services", () => {
  const entries = callEntriesFromThread(adoptTwoServices);
  const { operations } = reduceZeropsOperations(entries);

  it("bootstrap is done with an Adopt kicker and a skipped close step", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.kicker).toBe("Adopt · s3git1, s3git2");
    const close = bootstrap.steps.find((s) => s.id === "close")!;
    expect(close.stateLabel).toBe("Skipped");
  });

  it("the failed discover continuation joins the bootstrap; the final discover step is done", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("done");
    const discover = bootstrap.steps.find((s) => s.id === "discover")!;
    expect(discover.state).toBe("done");
  });

  it("classifies the develop start as generic", () => {
    const developStart = entries.find(
      (e) => e.input?.workflow === "develop" && e.input?.action === "start",
    )!;
    expect(classifyZeropsCall(developStart.toolName, developStart.input, developStart.status)).toBe(
      "generic",
    );
  });

  it("a prefix ending right after the failed continuation shows the discover step as failed and the operation still running", () => {
    const failedIndex = entries.findIndex(
      (e) => e.toolName === "zerops_workflow" && e.status === "failed",
    );
    const prefix = entries.slice(0, failedIndex + 1);
    const { operations: prefixOperations } = reduceZeropsOperations(prefix);
    const bootstrap = prefixOperations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("running");
    const discover = bootstrap.steps.find((s) => s.id === "discover")!;
    expect(discover.state).toBe("failed");
    expect(discover.note).toContain("ambiguous dev/stage pairing");
  });
});

describe("reduceZeropsOperations — mount-status", () => {
  const entries = callEntriesFromThread(mountStatus);
  const { operations } = reduceZeropsOperations(entries);

  it("classifies the mount status call as generic", () => {
    const mountEntry = entries.find((e) => e.toolName === "zerops_mount")!;
    expect(classifyZeropsCall(mountEntry.toolName, mountEntry.input, mountEntry.status)).toBe(
      "hidden",
    );
  });

  it("produces no operations", () => {
    expect(operations).toEqual([]);
  });
});

describe("reduceZeropsOperations — determinism", () => {
  const allEntries = [
    ...callEntriesFromThread(weatherdashFirstDeploy),
    ...callEntriesFromThread(addMariadb),
    ...callEntriesFromThread(adoptTwoServices),
    ...callEntriesFromThread(verifyAndRefusedDeploy),
  ];

  it("reducing a fixture twice gives deep-equal output", () => {
    const first = reduceZeropsOperations(allEntries);
    const second = reduceZeropsOperations(allEntries);
    expect(second.operations).toEqual(first.operations);
    expect([...second.consumedEntryIds]).toEqual([...first.consumedEntryIds]);
  });

  it("reducing a prefix never changes an earlier operation's anchorEntryId, createdAt, kind", () => {
    const full = reduceZeropsOperations(allEntries).operations;
    for (let cut = 1; cut <= allEntries.length; cut++) {
      const prefixOps = reduceZeropsOperations(allEntries.slice(0, cut)).operations;
      // Every operation present in the prefix result must match the
      // corresponding full-reduction operation on these three fields,
      // matched by anchorEntryId (keys can still change as more entries fold in).
      for (const prefixOp of prefixOps) {
        const fullOp = full.find((o) => o.anchorEntryId === prefixOp.anchorEntryId);
        expect(fullOp).toBeDefined();
        expect(fullOp!.anchorEntryId).toBe(prefixOp.anchorEntryId);
        expect(fullOp!.createdAt).toBe(prefixOp.createdAt);
        expect(fullOp!.kind).toBe(prefixOp.kind);
      }
    }
  });
});

describe("reduceZeropsOperations — pending states (hand-built)", () => {
  const pendingDeploy: ZeropsCallEntry = {
    id: "e1",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_deploy",
    input: { targetService: "weatherdash" },
    status: "inProgress",
  };

  it("a pending deploy is running, statusWord Deploying, hasResult false, target from input", () => {
    const { operations } = reduceZeropsOperations([pendingDeploy]);
    expect(operations).toHaveLength(1);
    const deploy = operations[0]!;
    expect(deploy.phase).toBe("running");
    expect(deploy.statusWord).toBe("Deploying");
    expect(deploy.hasResult).toBe(false);
    expect(deploy.target).toEqual({ hostname: "weatherdash" });
    expect(deploy.closing).toBeUndefined();
  });

  const bootstrapStart: ZeropsCallEntry = {
    id: "b1",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_workflow",
    input: {
      action: "start",
      workflow: "bootstrap",
      route: "classic",
      intent: "Set up weatherdash",
    },
    status: "completed",
    resultText: JSON.stringify({
      sessionId: "sess1",
      intent: "Set up weatherdash",
      progress: {
        total: 3,
        completed: 0,
        steps: [
          { name: "discover", status: "in_progress" },
          { name: "provision", status: "pending" },
          { name: "close", status: "pending" },
        ],
      },
      message: "Step 1/3: discover",
    }),
  };

  it("a pending complete step=provision with one open bootstrap joins it, provision step running", () => {
    const pendingProvision: ZeropsCallEntry = {
      id: "b2",
      createdAt: "2026-09-01T00:01:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "provision" },
      status: "inProgress",
    };
    const { operations, consumedEntryIds } = reduceZeropsOperations([
      bootstrapStart,
      pendingProvision,
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.entryIds).toEqual(["b1", "b2"]);
    expect(consumedEntryIds.has("b2")).toBe(true);
  });

  it("a pending complete step=provision with zero open bootstraps is its own call: operation", () => {
    const pendingProvision: ZeropsCallEntry = {
      id: "b3",
      createdAt: "2026-09-01T00:01:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "provision" },
      status: "inProgress",
    };
    const { operations } = reduceZeropsOperations([pendingProvision]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.key).toBe("call:b3");
  });

  it("a BUILD_TRIGGERED deploy result is phase running with hasResult true", () => {
    const triggered: ZeropsCallEntry = {
      id: "e2",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "completed",
      resultText: JSON.stringify({
        status: "BUILD_TRIGGERED",
        targetService: "weatherdash",
        message: "Build triggered.",
      }),
    };
    const { operations } = reduceZeropsOperations([triggered]);
    const deploy = operations[0]!;
    expect(deploy.phase).toBe("running");
    expect(deploy.hasResult).toBe(true);
    expect(deploy.statusWord).toBe("Build triggered");
  });
});
