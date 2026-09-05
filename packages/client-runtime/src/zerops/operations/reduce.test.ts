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

  it("classifies the ToolSearch-style calls, route-menu start and close-mode as hidden, and consumes all of them", () => {
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
    // Hidden is a transcript-visibility verdict, not "unseen" — every hidden
    // entry is consumed so the web can pass every zerops_* call through
    // unfiltered and let the reduction alone decide what the transcript
    // keeps, even though none of these three joins an operation.
    expect(consumedEntryIds.has(toolSearchEntry.id)).toBe(true);
    expect(consumedEntryIds.has(routeMenuEntry.id)).toBe(true);
    expect(consumedEntryIds.has(closeModeEntry.id)).toBe(true);
  });

  it("consumes every hidden-classified entry in the thread", () => {
    const hiddenIds = entries
      .filter((e) => classifyZeropsCall(e.toolName, e.input, e.status) === "hidden")
      .map((e) => e.id);
    expect(hiddenIds.length).toBeGreaterThan(0);
    for (const id of hiddenIds) {
      expect(consumedEntryIds.has(id)).toBe(true);
    }
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
      // decodeZeropsCard never returns a "deploy" card on a failed tool call
      // (it returns the error card, or nothing) — the failing step still has
      // to be named from the raw document. This result has no buildStatus at
      // all (the SSH check failed before a build ever started), so there is
      // no Build step, and no failedPhase either, so the one step is a plain
      // "Deploy".
      expect(deploy.steps).toEqual([
        { id: "deploy", label: "Deploy", state: "failed", stateLabel: "Failed" },
      ]);
    }
  });

  it("has verify operations, all done", () => {
    const verifies = operations.filter((o) => o.kind === "verify");
    expect(verifies.length).toBeGreaterThan(0);
    for (const verify of verifies) {
      expect(verify.phase).toBe("done");
    }
  });

  it("the first verify's own fallback text is a truncated teaser, not JSON — statusWord is neutral, not Healthy", () => {
    // This call never carries `data.zerops` in the captured session, and
    // Claude's own raw result (the fixture adapter's fallback source) is cut
    // short rather than the full JSON document, so it never decodes at all.
    const verifies = operations.filter((o) => o.kind === "verify");
    const undecoded = verifies.find((v) => !v.hasResult)!;
    expect(undecoded).toBeDefined();
    expect(undecoded.phase).toBe("done");
    expect(undecoded.statusWord).toBe("Done");
    expect(undecoded.closing).toBe("Finished.");
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
    const { operations: prefixOperations, consumedEntryIds: prefixConsumed } =
      reduceZeropsOperations(prefix);
    const bootstrap = prefixOperations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("running");
    const discover = bootstrap.steps.find((s) => s.id === "discover")!;
    expect(discover.state).toBe("failed");
    expect(discover.note).toContain("ambiguous dev/stage pairing");
    // The failed continuation is a bootstrap-session call — it joined the
    // operation, not a standalone `error` operation, so it is one of the
    // bootstrap's own folded entries.
    expect(bootstrap.entryIds).toContain(entries[failedIndex]!.id);
    expect(prefixConsumed.has(entries[failedIndex]!.id)).toBe(true);
  });
});

describe("reduceZeropsOperations — mount-status", () => {
  const entries = callEntriesFromThread(mountStatus);
  const { operations } = reduceZeropsOperations(entries);

  it("hides the mount status call", () => {
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
    // The joined pending call names its own step — that step renders running
    // even though the last known plan (from b1) still says "pending", since
    // this pending call is the freshest signal about it.
    const provisionStep = operations[0]!.steps.find((s) => s.id === "provision")!;
    expect(provisionStep.state).toBe("running");
    expect(provisionStep.stateLabel).toBe("Running");
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

describe("reduceZeropsOperations — kind error (a hidden/generic-shaped call that failed)", () => {
  const failedStatus: ZeropsCallEntry = {
    id: "err1",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_workflow",
    input: { action: "status" },
    status: "failed",
    resultText: JSON.stringify({ code: "INTERNAL", error: "status lookup failed" }),
  };

  const failedRouteMenuStart: ZeropsCallEntry = {
    id: "err2",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_workflow",
    input: { action: "start", workflow: "bootstrap", intent: "New service" },
    status: "failed",
    resultText: JSON.stringify({ code: "INTERNAL", error: "menu unavailable" }),
  };

  const failedMountStatus: ZeropsCallEntry = {
    id: "err3",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_mount",
    input: { action: "status" },
    status: "failed",
    resultText: JSON.stringify({ code: "INTERNAL", error: "mount status unavailable" }),
  };

  const failedDiscover: ZeropsCallEntry = {
    id: "err4",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_discover",
    status: "failed",
    resultText: JSON.stringify({ code: "INTERNAL", error: "discover unavailable" }),
  };

  it("a failed action=status becomes its own kind error operation, not bootstrap", () => {
    const { operations } = reduceZeropsOperations([failedStatus]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.kind).toBe("error");
    expect(operations[0]!.closing).toContain("status lookup failed");
  });

  it("a failed route-menu start becomes kind error, not bootstrap, and never joins an open session", () => {
    const openBootstrap: ZeropsCallEntry = {
      id: "b0",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "completed",
      resultText: JSON.stringify({
        sessionId: "sessOpen",
        progress: {
          total: 3,
          completed: 0,
          steps: [
            { name: "discover", status: "in_progress" },
            { name: "provision", status: "pending" },
            { name: "close", status: "pending" },
          ],
        },
      }),
    };
    const { operations } = reduceZeropsOperations([openBootstrap, failedRouteMenuStart]);
    expect(operations.map((o) => o.kind)).toEqual(["bootstrap", "error"]);
    // The failed route-menu call must not have joined the open session as a
    // trailing failure — the bootstrap's own steps are untouched.
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.entryIds).toEqual(["b0"]);
    expect(bootstrap.steps.find((s) => s.id === "discover")!.state).toBe("running");
  });

  it("a failed mount action=status becomes kind error, not mount", () => {
    const { operations } = reduceZeropsOperations([failedMountStatus]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.kind).toBe("error");
    expect(operations[0]!.closing).toContain("mount status unavailable");
  });

  it("a failed zerops_discover becomes kind error, kicker names the code, voice names the humanized tool", () => {
    const { operations } = reduceZeropsOperations([failedDiscover]);
    expect(operations).toHaveLength(1);
    const op = operations[0]!;
    expect(op.kind).toBe("error");
    expect(op.kicker).toBe("Error · INTERNAL");
    expect(op.voice).toBe("Discover failed.");
    expect(op.closing).toContain("discover unavailable");
  });
});

describe("reduceZeropsOperations — bootstrap voice from the route-menu reply", () => {
  it("reads the intent off the hidden route-menu start that precedes start route=, and consumes it", () => {
    const routeMenuStart: ZeropsCallEntry = {
      id: "menu1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: {
        action: "start",
        workflow: "bootstrap",
        intent: "Nový service pro weather dashboard",
      },
      status: "completed",
      resultText: JSON.stringify({
        kind: "route-menu",
        routeOptions: ["classic", "adopt"],
        message: "Pick a route.",
      }),
    };
    const startWithRoute: ZeropsCallEntry = {
      id: "route1",
      createdAt: "2026-09-01T00:00:05.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      // No intent here — the agent only sends it on the route-menu reply,
      // exactly like the real transcripts.
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "completed",
      resultText: JSON.stringify({
        sessionId: "sessMenu",
        progress: {
          total: 3,
          completed: 0,
          steps: [
            { name: "discover", status: "in_progress" },
            { name: "provision", status: "pending" },
            { name: "close", status: "pending" },
          ],
        },
      }),
    };
    const { operations, consumedEntryIds } = reduceZeropsOperations([
      routeMenuStart,
      startWithRoute,
    ]);
    expect(operations).toHaveLength(1);
    const bootstrap = operations[0]!;
    expect(bootstrap.voice).toBe("Nový service pro weather dashboard");
    expect(bootstrap.voiceSource).toBe("agent");
    // The route-menu call itself never joins the operation — its intent does.
    expect(bootstrap.anchorEntryId).toBe("route1");
    expect(bootstrap.entryIds).toEqual(["route1"]);
    expect(consumedEntryIds.has("menu1")).toBe(true);
    expect(consumedEntryIds.has("route1")).toBe(true);
  });
});

describe("reduceZeropsOperations — bootstrap session identity", () => {
  const openBootstrap = (id: string, sessionId: string, createdAt: string): ZeropsCallEntry => ({
    id,
    createdAt,
    turnId: "t1",
    toolName: "zerops_workflow",
    input: { action: "start", workflow: "bootstrap", route: "classic" },
    status: "completed",
    resultText: JSON.stringify({
      sessionId,
      progress: {
        total: 3,
        completed: 0,
        steps: [
          { name: "discover", status: "in_progress" },
          { name: "provision", status: "pending" },
          { name: "close", status: "pending" },
        ],
      },
    }),
  });

  it("a continuation carrying a foreign, already-known-different sessionId starts its own group instead of hijacking the one open session", () => {
    const sessA = openBootstrap("a1", "sessA", "2026-09-01T00:00:00.000Z");
    const foreignContinuation: ZeropsCallEntry = {
      id: "a2",
      createdAt: "2026-09-01T00:01:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "discover" },
      status: "completed",
      resultText: JSON.stringify({
        sessionId: "sessB",
        progress: {
          total: 3,
          completed: 1,
          steps: [
            { name: "discover", status: "complete" },
            { name: "provision", status: "in_progress" },
            { name: "close", status: "pending" },
          ],
        },
      }),
    };
    const { operations } = reduceZeropsOperations([sessA, foreignContinuation]);
    const keys = operations.filter((o) => o.kind === "bootstrap").map((o) => o.key);
    expect(keys.sort()).toEqual(["bootstrap:sessA", "bootstrap:sessB"]);
    const a = operations.find((o) => o.key === "bootstrap:sessA")!;
    expect(a.entryIds).toEqual(["a1"]);
    const b = operations.find((o) => o.key === "bootstrap:sessB")!;
    expect(b.entryIds).toEqual(["a2"]);
  });

  it("a second start route= for an already-open session joins it instead of duplicating the group", () => {
    const first = openBootstrap("s1", "sessDup", "2026-09-01T00:00:00.000Z");
    const second = openBootstrap("s2", "sessDup", "2026-09-01T00:05:00.000Z");
    const { operations } = reduceZeropsOperations([first, second]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]!.key).toBe("bootstrap:sessDup");
    expect(bootstraps[0]!.anchorEntryId).toBe("s1");
    expect(bootstraps[0]!.entryIds).toEqual(["s1", "s2"]);
  });
});

describe("reduceZeropsOperations — verify, the all-services shape", () => {
  const allServicesVerify: ZeropsCallEntry = {
    id: "v1",
    createdAt: "2026-09-01T00:00:00.000Z",
    turnId: "t1",
    toolName: "zerops_verify",
    status: "completed",
    resultText: JSON.stringify({
      status: "degraded",
      services: [
        { hostname: "s3git1", status: "healthy" },
        { hostname: "s3git2", status: "degraded" },
      ],
    }),
  };

  it("subject and kicker are 'all services' when input.serviceHostname is absent", () => {
    const { operations } = reduceZeropsOperations([allServicesVerify]);
    expect(operations).toHaveLength(1);
    const op = operations[0]!;
    expect(op.subject).toBe("all services");
    expect(op.kicker).toBe("Verify · all services");
  });

  it("step labels are the raw hostnames, never humanized", () => {
    const { operations } = reduceZeropsOperations([allServicesVerify]);
    const op = operations[0]!;
    expect(op.steps.map((s) => s.label)).toEqual(["s3git1", "s3git2"]);
  });
});

describe("reduceZeropsOperations — standalone card kinds", () => {
  it("a standalone import, done: subject, step, closing from the summary", () => {
    const entry: ZeropsCallEntry = {
      id: "imp1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_import",
      status: "completed",
      resultText: JSON.stringify({
        projectId: "p1",
        processes: [
          { processId: "1", actionName: "stack.create", status: "FINISHED", service: "newsvc" },
        ],
        summary: "1 service created",
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations).toHaveLength(1);
    const op = operations[0]!;
    expect(op.kind).toBe("import");
    expect(op.phase).toBe("done");
    expect(op.subject).toBe("newsvc");
    expect(op.closing).toBe("1 service created");
    expect(op.steps).toEqual([
      { id: "newsvc", label: "newsvc", state: "done", stateLabel: "Done" },
    ]);
  });

  it("a standalone import, failed: closing from the error", () => {
    const entry: ZeropsCallEntry = {
      id: "imp2",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_import",
      status: "failed",
      resultText: JSON.stringify({ code: "IMPORT_FAILED", error: "YAML syntax error on line 4" }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("import");
    expect(op.phase).toBe("failed");
    expect(op.closing).toContain("YAML syntax error on line 4");
  });

  it("a mount call: subject, step, closing counting mounted services", () => {
    const entry: ZeropsCallEntry = {
      id: "mnt1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_mount",
      input: { action: "mount", hostname: "db" },
      status: "completed",
      resultText: JSON.stringify({ hostname: "db", status: "MOUNTED", mountPath: "/mnt/db" }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("mount");
    expect(op.phase).toBe("done");
    expect(op.subject).toBe("db");
    expect(op.steps).toEqual([
      { id: "db", label: "db", state: "done", stateLabel: "Done", note: "/mnt/db" },
    ]);
    expect(op.closing).toBe("1 of 1 services mounted.");
  });

  it("a subdomain call: statusWord and closing by action, links from the URLs", () => {
    const entry: ZeropsCallEntry = {
      id: "sub1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_subdomain",
      input: { serviceHostname: "weatherdash", action: "enable" },
      status: "completed",
      resultText: JSON.stringify({
        serviceHostname: "weatherdash",
        action: "enable",
        subdomainUrls: ["https://weatherdash-x.prg1.zerops.app"],
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("subdomain");
    expect(op.statusWord).toBe("Enabled");
    expect(op.closing).toBe("Enabled.");
    expect(op.links).toEqual([
      { label: "weatherdash-x.prg1.zerops.app", url: "https://weatherdash-x.prg1.zerops.app" },
    ]);
  });

  it("a simple kind (delete): subject from input, closing from the message's first paragraph", () => {
    const entry: ZeropsCallEntry = {
      id: "del1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_delete",
      input: { hostname: "old-svc" },
      status: "completed",
      resultText: JSON.stringify({ message: "Service old-svc deleted." }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("delete");
    expect(op.phase).toBe("done");
    expect(op.subject).toBe("old-svc");
    expect(op.closing).toBe("Service old-svc deleted.");
    // the message composed the closing — it is not repeated in detail
    expect(op.detail).toBeUndefined();
  });

  it("a dev_server start result: subject, Open-worthy hostname:port closing, one step", () => {
    const entry: ZeropsCallEntry = {
      id: "dev1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_dev_server",
      input: { action: "start", hostname: "apidev" },
      status: "completed",
      resultText: JSON.stringify({
        action: "start",
        hostname: "apidev",
        running: true,
        port: 3000,
        healthStatus: 200,
        startMillis: 4200,
        url: "http://apidev:3000/",
        message: "dev server on apidev:3000 is healthy",
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("devServer");
    expect(op.phase).toBe("done");
    expect(op.subject).toBe("apidev");
    expect(op.statusWord).toBe("Running");
    expect(op.closing).toBe("dev server running on apidev:3000.");
    expect(op.links).toEqual([]);
    expect(op.steps).toHaveLength(1);
    expect(op.steps[0]!.state).toBe("done");
    expect(op.target).toEqual({ hostname: "apidev" });
  });

  it("a dev_server start result that never came up: Not running statusWord, a failed step", () => {
    const entry: ZeropsCallEntry = {
      id: "dev2",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_dev_server",
      input: { action: "start", hostname: "apidev" },
      status: "completed",
      resultText: JSON.stringify({
        action: "start",
        hostname: "apidev",
        running: false,
        port: 3000,
        reason: "health_probe_timeout",
        message: "dev server on apidev:3000 did not become healthy in time",
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("devServer");
    expect(op.statusWord).toBe("Not running");
    expect(op.closing).toBe("apidev did not come up.");
    expect(op.steps[0]!.state).toBe("failed");
    expect(op.steps[0]!.note).toContain("Health probe timeout");
  });

  it("a dev_server stop result: closing says stopped, never claims an Open link", () => {
    const entry: ZeropsCallEntry = {
      id: "dev3",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_dev_server",
      input: { action: "stop", hostname: "apidev" },
      status: "completed",
      resultText: JSON.stringify({ action: "stop", hostname: "apidev", running: false }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.closing).toBe("apidev stopped.");
    expect(op.links).toEqual([]);
  });

  it("a browser result: subject the url, closing with the three counts, steps from the batch", () => {
    const entry: ZeropsCallEntry = {
      id: "brw1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: JSON.stringify({
        url: "https://kanbandev-26a7.prg1.zerops.app",
        steps: [
          { command: ["open", "https://kanbandev-26a7.prg1.zerops.app"], success: true },
          {
            command: ["click", "@e1"],
            success: false,
            error: "no element matched @e1",
            errorKind: "selector-not-found",
          },
          { command: ["close"], success: true },
        ],
        errorsOutput: ["TypeError: x is not a function"],
        consoleOutput: [{ type: "error", text: "failed to fetch" }],
        networkOutput: [],
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("browser");
    expect(op.subject).toBe("https://kanbandev-26a7.prg1.zerops.app");
    expect(op.statusWord).toBe("Checked");
    expect(op.closing).toBe(
      "checked https://kanbandev-26a7.prg1.zerops.app. 1 console error, 1 page error, 0 failed requests.",
    );
    expect(op.steps.map((s) => s.label)).toEqual([
      "open https://kanbandev-26a7.prg1.zerops.app",
      "click @e1",
      "close",
    ]);
    expect(op.steps[1]!.state).toBe("failed");
    expect(op.steps[1]!.note).toBe("Selector not found");
  });

  it("a browser result whose text is not JSON classifies as generic, never as an error card", () => {
    const entry: ZeropsCallEntry = {
      id: "brw2",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: "## Browser walk\n\nEverything looks fine.",
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.kind).toBe("browser");
    expect(op.statusWord).toBe("Done");
    expect(op.closing).toBe("Finished.");
  });

  it("carries the first image content block as a data-URI screenshot", () => {
    const entry: ZeropsCallEntry = {
      id: "brw3",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: "## Browser walk\n\nEverything looks fine.",
      images: [{ mimeType: "image/jpeg", data: "AAAA", width: 640, height: 360 }],
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;
    expect(op.screenshot).toEqual({
      src: "data:image/jpeg;base64,AAAA",
      width: 640,
      height: 360,
    });
  });

  it("has no screenshot when the result carried no image", () => {
    const entry: ZeropsCallEntry = {
      id: "brw4",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: "## Browser walk\n\nEverything looks fine.",
    };
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations[0]!.screenshot).toBeUndefined();
  });

  it("condenses a browser batch into viewport, media, step count and failed step; tail steps are not listed", () => {
    const entry: ZeropsCallEntry = {
      id: "brw5",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: JSON.stringify({
        url: "https://kanbandev-26a7.prg1.zerops.app",
        steps: [
          { command: ["open", "https://kanbandev-26a7.prg1.zerops.app"], success: true },
          { command: ["set", "viewport", "1920", "1080"], success: true },
          { command: ["set", "media", "dark"], success: true },
          {
            command: ["click", "@e1"],
            success: false,
            error: "no element matched @e1",
            errorKind: "selector-not-found",
          },
          { command: ["screenshot", "/tmp/shot.png"], success: true },
          { command: ["errors"], success: true },
          { command: ["console"], success: true },
          { command: ["network", "requests", "--status", "400-599"], success: true },
          { command: ["close"], success: true },
        ],
        errorsOutput: ["TypeError: x is not a function"],
        consoleOutput: [{ type: "error", text: "failed to fetch" }],
        networkOutput: [{ url: "https://kanbandev-26a7.prg1.zerops.app/api", status: 500 }],
      }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    const op = operations[0]!;

    expect(op.browserSummary?.viewport).toEqual({ width: 1920, height: 1080 });
    expect(op.browserSummary?.media).toBe("dark");
    expect(op.browserSummary?.stepCount).toBe(4);
    expect(op.browserSummary?.failedStep?.label).toBe("click @e1");
    expect(op.browserSummary?.failedStep?.state).toBe("failed");
    expect(op.browserSummary?.line).toBe(
      "opened https://kanbandev-26a7.prg1.zerops.app · 1920×1080, dark · 4 steps · 2 errors, 1 failed request",
    );

    const tailLabels = op.steps.filter((step) => step.kind === "tail").map((step) => step.label);
    expect(tailLabels).toEqual([
      "screenshot /tmp/shot.png",
      "errors",
      "console",
      "network requests --status 400-599",
      "close",
    ]);
    const nonTailLabels = op.steps.filter((step) => step.kind !== "tail").map((step) => step.label);
    expect(nonTailLabels).toEqual([
      "open https://kanbandev-26a7.prg1.zerops.app",
      "set viewport 1920 1080",
      "set media dark",
      "click @e1",
    ]);
  });

  it("browserSummary is absent when the result did not decode into a browser card", () => {
    const entry: ZeropsCallEntry = {
      id: "brw6",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_browser",
      input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
      status: "completed",
      resultText: "## Browser walk\n\nEverything looks fine.",
    };
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations[0]!.browserSummary).toBeUndefined();
  });

  it("a non-browser operation never carries a screenshot even if its entry has images", () => {
    const entry: ZeropsCallEntry = {
      id: "dep1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_deploy",
      input: { hostname: "kanbandev" },
      status: "completed",
      resultText: JSON.stringify({ status: "DEPLOYED", hostname: "kanbandev" }),
      images: [{ mimeType: "image/jpeg", data: "AAAA" }],
    };
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations[0]!.kind).toBe("deploy");
    expect(operations[0]!.screenshot).toBeUndefined();
  });
});

describe("reduceZeropsOperations — no per-call intent (zcp ships none)", () => {
  // zcp never sends a per-call `intent` on these tools — only the bootstrap
  // founder / route-menu reply carries one (captured as `bootstrapIntent`).
  // A stray `intent` key on any other call must not be read as the agent's
  // voice; the phrase producer still wins.
  const cases: ReadonlyArray<{ name: string; entry: ZeropsCallEntry }> = [
    {
      name: "deploy",
      entry: {
        id: "ni-deploy",
        createdAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash", intent: "Deploy weatherdash" },
        status: "completed",
      },
    },
    {
      name: "verify",
      entry: {
        id: "ni-verify",
        createdAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_verify",
        input: { serviceHostname: "weatherdash", intent: "Verify weatherdash" },
        status: "completed",
      },
    },
    {
      name: "mount",
      entry: {
        id: "ni-mount",
        createdAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_mount",
        input: { action: "mount", hostname: "db", intent: "Mount db" },
        status: "completed",
      },
    },
  ];

  it.each(cases)("$name ignores a stray input.intent: voiceSource stays mate", ({ entry }) => {
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.voiceSource).toBe("mate");
  });
});

describe("reduceZeropsOperations — neutral status word for an undecoded result", () => {
  // The verify case is pinned against the real fixture in the
  // verify-and-refused-deploy describe block above (its first verify call
  // never carries a decodable result at all). This covers deploy: a
  // "completed" result with no card at all (no decoder recognizes the tool,
  // or the JSON doesn't parse) must not claim "Deployed" — only a decoded
  // card earns the kind-specific word.
  it("a done deploy with no decodable card gets the neutral word Done, not Deployed", () => {
    const entry: ZeropsCallEntry = {
      id: "d1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_deploy_batch",
      input: { targetServices: ["a", "b"] },
      status: "completed",
      resultText: JSON.stringify({ batchId: "b1", results: [] }),
    };
    const { operations } = reduceZeropsOperations([entry]);
    expect(operations).toHaveLength(1);
    const op = operations[0]!;
    expect(op.kind).toBe("deploy");
    expect(op.phase).toBe("done");
    // The JSON parses fine (hasResult tracks that) — there is simply no
    // decoder for zerops_deploy_batch, so no "deploy" card comes out of it.
    expect(op.hasResult).toBe(true);
    expect(op.statusWord).toBe("Done");
    expect(op.closing).toBe("Finished.");
  });
});

describe("reduceZeropsOperations — a failed import joining an open bootstrap", () => {
  it("marks the provision step failed with the import error's first line as note, and never becomes a second card", () => {
    const bootstrapAtProvision: ZeropsCallEntry = {
      id: "bp1",
      createdAt: "2026-09-01T00:00:00.000Z",
      turnId: "t1",
      toolName: "zerops_workflow",
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "completed",
      resultText: JSON.stringify({
        sessionId: "sessProvision",
        progress: {
          total: 3,
          completed: 1,
          steps: [
            { name: "discover", status: "complete" },
            { name: "provision", status: "in_progress" },
            { name: "close", status: "pending" },
          ],
        },
        message: "Step 2/3: provision",
      }),
    };
    const failedImport: ZeropsCallEntry = {
      id: "bp2",
      createdAt: "2026-09-01T00:01:00.000Z",
      turnId: "t1",
      toolName: "zerops_import",
      status: "failed",
      resultText: JSON.stringify({ code: "IMPORT_FAILED", error: "YAML syntax error on line 4" }),
    };
    const { operations, consumedEntryIds } = reduceZeropsOperations([
      bootstrapAtProvision,
      failedImport,
    ]);
    expect(operations.map((o) => o.kind)).toEqual(["bootstrap"]);
    const bootstrap = operations[0]!;
    expect(bootstrap.entryIds).toContain("bp2");
    expect(consumedEntryIds.has("bp2")).toBe(true);
    const provision = bootstrap.steps.find((s) => s.id === "provision")!;
    expect(provision.state).toBe("failed");
    expect(provision.note).toContain("YAML syntax error on line 4");
  });
});
