import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  addMariadb,
  adoptTwoServices,
  mountStatus,
  verifyAndRefusedDeploy,
  weatherdashFirstDeploy,
} from "../operations/__fixtures__/index.ts";
import { collectZeropsCalls } from "./calls.ts";
import { reduceZeropsOperations } from "./operations.ts";

// ---- a hand-built call, as one activity row (RAW, R1-R4 fold degenerately
// to one row for these synthetic cases) ----

interface EntrySpec {
  readonly id: string;
  readonly createdAt: string;
  readonly turnId?: string | null;
  readonly toolName: string;
  readonly input?: Record<string, unknown>;
  readonly status: "inProgress" | "completed" | "failed" | "declined" | "stopped";
  readonly resultText?: string;
  readonly truncated?: boolean;
}

function activityFor(entry: EntrySpec): OrchestrationThreadActivity {
  const kind = entry.status === "inProgress" ? "tool.started" : "tool.completed";
  return {
    id: entry.id,
    tone: "tool",
    kind,
    summary: "Tool call",
    turnId: entry.turnId === undefined ? "t1" : entry.turnId,
    createdAt: entry.createdAt,
    payload: {
      toolCallId: entry.id,
      status: entry.status,
      data: {
        toolName: entry.toolName,
        input: entry.input ?? {},
        zerops: {
          toolName: entry.toolName,
          ...(entry.resultText !== undefined ? { resultText: entry.resultText } : {}),
          ...(entry.truncated === true ? { truncated: true } : {}),
        },
      },
    },
  } as unknown as OrchestrationThreadActivity;
}

function reduceFrom(entries: ReadonlyArray<EntrySpec>, runningTurnId: string | null = "t1") {
  const activities = entries.map(activityFor);
  const calls = collectZeropsCalls(activities, runningTurnId);
  return reduceZeropsOperations(calls);
}

function planResult(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    sessionId: "sess1",
    progress: {
      total: 3,
      completed: 0,
      steps: [
        { name: "discover", status: "in_progress" },
        { name: "provision", status: "pending" },
        { name: "close", status: "pending" },
      ],
    },
    ...overrides,
  });
}

// ---- real threads ----

describe("reduceZeropsOperations — weatherdash-first-deploy", () => {
  const { operations } = reduceFrom2(weatherdashFirstDeploy);

  it("produces bootstrap, deploy, verify in order", () => {
    expect(operations.map((o) => o.kind)).toEqual(["bootstrap", "deploy", "verify"]);
  });

  it("keys the bootstrap operation by the founder call id, membership by the zcp session id", () => {
    const bootstrap = operations[0]!;
    expect(bootstrap.key).toMatch(/^bootstrap:/);
    expect(bootstrap.session?.sessionIds).toContain("61892e75bf9a9ad9");
  });

  it("the bootstrap operation is done, voiced by the agent, with a New service kicker", () => {
    const bootstrap = operations[0]!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.voiceSource).toBe("agent");
    expect(bootstrap.kicker).toBe("New service · weatherdash");
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

  it("the verify operation is done with two checks", () => {
    const verify = operations[2]!;
    expect(verify.phase).toBe("done");
    expect(verify.steps).toHaveLength(2);
    expect(verify.closing).toBe("All 2 checks passed.");
  });

  it("the import never becomes its own operation — it joined the bootstrap", () => {
    expect(operations.some((o) => o.kind === "import")).toBe(false);
  });
});

describe("reduceZeropsOperations — add-mariadb", () => {
  const { operations } = reduceFrom2(addMariadb);

  it("has a standalone verify operation, done", () => {
    const verifies = operations.filter((o) => o.kind === "verify");
    expect(verifies).toHaveLength(1);
    expect(verifies[0]!.phase).toBe("done");
  });

  it("bootstrap is done with a New service · db kicker", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.kicker).toBe("New service · db");
  });
});

describe("reduceZeropsOperations — verify-and-refused-deploy", () => {
  const { operations } = reduceFrom2(verifyAndRefusedDeploy);

  it("has two failed deploy operations, both mentioning the missing zerops.yml", () => {
    const deploys = operations.filter((o) => o.kind === "deploy");
    expect(deploys).toHaveLength(2);
    for (const deploy of deploys) {
      expect(deploy.phase).toBe("failed");
      expect(deploy.closing).toContain("zerops.yml not found");
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
  const { operations } = reduceFrom2(adoptTwoServices);

  it("bootstrap is done with an Adopt kicker and a skipped close step", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.kicker).toBe("Adopt · s3git1, s3git2");
    const close = bootstrap.steps.find((s) => s.id === "close")!;
    expect(close.stateLabel).toBe("Skipped");
  });

  it("the failed discover continuation joins the bootstrap; the final discover step is done", () => {
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    const discover = bootstrap.steps.find((s) => s.id === "discover")!;
    expect(discover.state).toBe("done");
  });
});

describe("reduceZeropsOperations — mount-status", () => {
  it("produces no operations", () => {
    expect(reduceFrom2(mountStatus).operations).toEqual([]);
  });
});

describe("reduceZeropsOperations — determinism", () => {
  it("reducing a fixture twice gives deep-equal output", () => {
    const first = reduceFrom2(weatherdashFirstDeploy);
    const second = reduceFrom2(weatherdashFirstDeploy);
    expect(second.operations).toEqual(first.operations);
  });
});

// ---- hand-built: pending states ----

describe("reduceZeropsOperations — pending states", () => {
  it("a pending deploy is running, statusWord Deploying, hasResult false, target from input", () => {
    const { operations } = reduceFrom([
      {
        id: "e1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "inProgress",
      },
    ]);
    const deploy = operations[0]!;
    expect(deploy.phase).toBe("running");
    expect(deploy.statusWord).toBe("Deploying");
    expect(deploy.hasResult).toBe(false);
    expect(deploy.target).toEqual({ hostname: "weatherdash" });
    expect(deploy.closing).toBeUndefined();
  });

  it("a BUILD_TRIGGERED deploy result is phase running with hasResult true", () => {
    const { operations } = reduceFrom([
      {
        id: "e2",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({
          status: "BUILD_TRIGGERED",
          targetService: "weatherdash",
          message: "Build triggered.",
        }),
      },
    ]);
    const deploy = operations[0]!;
    expect(deploy.phase).toBe("running");
    expect(deploy.hasResult).toBe(true);
    expect(deploy.statusWord).toBe("Build triggered");
  });

  it("a pending complete step=provision with zero open bootstraps is its own operation", () => {
    const { operations } = reduceFrom([
      {
        id: "b3",
        createdAt: "2026-09-01T00:01:00.000Z",
        toolName: "zerops_workflow",
        input: { action: "complete", step: "provision" },
        status: "inProgress",
      },
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.key).toBe("bootstrap:b3");
  });
});

// ---- kind error ----

describe("reduceZeropsOperations — kind error", () => {
  it("a failed action=status becomes its own kind error operation, not bootstrap", () => {
    const { operations } = reduceFrom([
      {
        id: "err1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_workflow",
        input: { action: "status" },
        status: "failed",
        resultText: JSON.stringify({ code: "INTERNAL", error: "status lookup failed" }),
      },
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.kind).toBe("error");
    expect(operations[0]!.closing).toContain("status lookup failed");
  });

  it("a failed route-menu start becomes kind error, not bootstrap, and never joins an open session", () => {
    const { operations } = reduceFrom([
      {
        id: "b0",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_workflow",
        input: { action: "start", workflow: "bootstrap", route: "classic" },
        status: "completed",
        resultText: planResult({ sessionId: "sessOpen" }),
      },
      {
        id: "err2",
        createdAt: "2026-09-01T00:00:05.000Z",
        toolName: "zerops_workflow",
        input: { action: "start", workflow: "bootstrap", intent: "New service" },
        status: "failed",
        resultText: JSON.stringify({ code: "INTERNAL", error: "menu unavailable" }),
      },
    ]);
    expect(operations.map((o) => o.kind)).toEqual(["bootstrap", "error"]);
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.callIds).toEqual(["b0"]);
  });
});

// ---- bootstrap voice from the route-menu reply ----

describe("reduceZeropsOperations — bootstrap voice from the route-menu reply", () => {
  it("reads the intent off the hidden route-menu start that precedes start route=", () => {
    const { operations } = reduceFrom([
      {
        id: "menu1",
        createdAt: "2026-09-01T00:00:00.000Z",
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
      },
      {
        id: "route1",
        createdAt: "2026-09-01T00:00:05.000Z",
        toolName: "zerops_workflow",
        input: { action: "start", workflow: "bootstrap", route: "classic" },
        status: "completed",
        resultText: planResult({ sessionId: "sessMenu" }),
      },
    ]);
    expect(operations).toHaveLength(1);
    const bootstrap = operations[0]!;
    expect(bootstrap.voice).toBe("Nový service pro weather dashboard");
    expect(bootstrap.voiceSource).toBe("agent");
    expect(bootstrap.key).toBe("bootstrap:route1");
  });
});

// ---- bootstrap session identity: R5-R7 ----

describe("reduceZeropsOperations — bootstrap session identity", () => {
  const openBootstrap = (id: string, sessionId: string, createdAt: string): EntrySpec => ({
    id,
    createdAt,
    toolName: "zerops_workflow",
    input: { action: "start", workflow: "bootstrap", route: "classic" },
    status: "completed",
    resultText: planResult({ sessionId }),
  });

  it("a continuation carrying a foreign, already-known-different sessionId starts its own group instead of hijacking the one open session", () => {
    const sessA = openBootstrap("a1", "sessA", "2026-09-01T00:00:00.000Z");
    const foreignContinuation: EntrySpec = {
      id: "a2",
      createdAt: "2026-09-01T00:01:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "discover" },
      status: "completed",
      resultText: planResult({
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
    const { operations } = reduceFrom([sessA, foreignContinuation]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(2);
    const a = bootstraps.find((o) => o.session?.sessionIds.includes("sessA"))!;
    expect(a.callIds).toEqual(["a1"]);
    const b = bootstraps.find((o) => o.session?.sessionIds.includes("sessB"))!;
    expect(b.callIds).toEqual(["a2"]);
  });

  it("a second start route= for an already-open session joins it instead of duplicating the group", () => {
    const first = openBootstrap("s1", "sessDup", "2026-09-01T00:00:00.000Z");
    const second = openBootstrap("s2", "sessDup", "2026-09-01T00:05:00.000Z");
    const { operations } = reduceFrom([first, second]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]!.key).toBe("bootstrap:s1");
    expect(bootstraps[0]!.callIds).toEqual(["s1", "s2"]);
  });

  it("a second founder supersedes the still-open first session, rendered as reset — never two open groups", () => {
    const first = openBootstrap("f1", "sessFirst", "2026-09-01T00:00:00.000Z");
    const second = openBootstrap("f2", "sessSecond", "2026-09-01T00:05:00.000Z");
    const { operations } = reduceFrom([first, second]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(2);
    const supersededOne = bootstraps.find((o) => o.session?.sessionIds.includes("sessFirst"))!;
    expect(supersededOne.phase).toBe("reset");
    const newOne = bootstraps.find((o) => o.session?.sessionIds.includes("sessSecond"))!;
    expect(newOne.phase).toBe("running");

    // Two open groups cannot exist: a continuation with no decodable session
    // must land on the NEW (open) group, never the superseded one.
    const continuation: EntrySpec = {
      id: "f3",
      createdAt: "2026-09-01T00:10:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "discover" },
      status: "inProgress",
    };
    const { operations: withContinuation } = reduceFrom([first, second, continuation], "t1");
    const newAfter = withContinuation
      .filter((o) => o.kind === "bootstrap")
      .find((o) => o.session?.sessionIds.includes("sessSecond"))!;
    expect(newAfter.callIds).toContain("f3");
  });

  it("a founder refused with WORKFLOW_ACTIVE while a session is open is an attempt on it, never a new card", () => {
    const first = openBootstrap("g1", "sessOpen", "2026-09-01T00:00:00.000Z");
    const refused: EntrySpec = {
      id: "g2",
      createdAt: "2026-09-01T00:01:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "failed",
      resultText: JSON.stringify({ code: "WORKFLOW_ACTIVE", error: "a session is already active" }),
    };
    const { operations } = reduceFrom([first, refused]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]!.callIds).toEqual(["g1", "g2"]);
    expect(bootstraps[0]!.phase).toBe("running");
  });

  it("a reset closes the session; a later founder starts a fresh one", () => {
    const first = openBootstrap("r1", "sessReset", "2026-09-01T00:00:00.000Z");
    const reset: EntrySpec = {
      id: "r2",
      createdAt: "2026-09-01T00:01:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "reset" },
      status: "completed",
      resultText: JSON.stringify({ ok: true }),
    };
    const { operations } = reduceFrom([first, reset]);
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("reset");
  });

  it("a founder whose own result never decodes (truncated) still holds the session — a decoded continuation joins it as ONE session", () => {
    const undecodableFounder: EntrySpec = {
      id: "u1",
      createdAt: "2026-09-01T00:00:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "completed",
      truncated: true,
    };
    const decodedContinuation: EntrySpec = {
      id: "u2",
      createdAt: "2026-09-01T00:01:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "discover" },
      status: "completed",
      resultText: planResult({
        sessionId: "sessU",
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
    const { operations } = reduceFrom([undecodableFounder, decodedContinuation]);
    const bootstraps = operations.filter((o) => o.kind === "bootstrap");
    expect(bootstraps).toHaveLength(1);
    expect(bootstraps[0]!.callIds).toEqual(["u1", "u2"]);
  });
});

// ---- retries: R8/R9 ----

describe("reduceZeropsOperations — retry fold (R8/R9)", () => {
  it("N failed retries of the same tool+target in one turn fold into one operation with attempts: N", () => {
    const failedDeploy = (id: string, createdAt: string): EntrySpec => ({
      id,
      createdAt,
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "failed",
      resultText: JSON.stringify({ code: "API_ERROR", error: "zerops.yml not found" }),
    });
    const { operations } = reduceFrom([
      failedDeploy("t1a", "2026-09-01T00:00:00.000Z"),
      failedDeploy("t1b", "2026-09-01T00:01:00.000Z"),
      failedDeploy("t1c", "2026-09-01T00:02:00.000Z"),
    ]);
    expect(operations).toHaveLength(1);
    expect(operations[0]!.attempts).toBe(3);
    expect(operations[0]!.callIds).toEqual(["t1a", "t1b", "t1c"]);
    expect(operations[0]!.key).toBe("op:t1a");
  });

  it("a succeeding attempt after failures is its own new operation, numbered as the 2nd attempt (R9)", () => {
    const { operations } = reduceFrom([
      {
        id: "s1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "failed",
        resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }),
      },
      {
        id: "s2",
        createdAt: "2026-09-01T00:01:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({ status: "DEPLOYED", target: "weatherdash" }),
      },
    ]);
    expect(operations).toHaveLength(2);
    expect(operations[0]!.attempts).toBe(1);
    expect(operations[1]!.phase).toBe("done");
    expect(operations[1]!.attempts).toBe(2);
  });

  it("R9's attempt count spans turns, independent of the R8 same-turn join", () => {
    const failedDeploy = (id: string, createdAt: string, turnId: string): EntrySpec => ({
      id,
      createdAt,
      turnId,
      toolName: "zerops_deploy",
      input: { targetService: "weatherdash" },
      status: "failed",
      resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }),
    });
    const { operations } = reduceFrom([
      failedDeploy("d1", "2026-09-01T00:00:00.000Z", "t1"),
      failedDeploy("d2", "2026-09-01T00:01:00.000Z", "t2"),
      {
        id: "d3",
        createdAt: "2026-09-01T00:02:00.000Z",
        turnId: "t3",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "completed",
        resultText: JSON.stringify({ status: "DEPLOYED", target: "weatherdash" }),
      },
    ]);
    // three turns, each failure in its own turn, never join by R8 —
    // three separate operations, not folded into one.
    expect(operations).toHaveLength(3);
    expect(operations[0]!.attempts).toBe(1);
    expect(operations[1]!.attempts).toBe(2);
    expect(operations[2]!.phase).toBe("done");
    expect(operations[2]!.attempts).toBe(3);
  });

  it("a bootstrap card between two same-turn failures of one target breaks the R8 join", () => {
    const { operations } = reduceFrom([
      {
        id: "d1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "failed",
        resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }),
      },
      {
        id: "w1",
        createdAt: "2026-09-01T00:01:00.000Z",
        toolName: "zerops_workflow",
        input: { action: "start", workflow: "bootstrap", route: "adopt" },
        status: "failed",
        resultText: JSON.stringify({ code: "WORKFLOW_ACTIVE", error: "already running" }),
      },
      {
        id: "d2",
        createdAt: "2026-09-01T00:02:00.000Z",
        toolName: "zerops_deploy",
        input: { targetService: "weatherdash" },
        status: "failed",
        resultText: JSON.stringify({ code: "API_ERROR", error: "boom again" }),
      },
    ]);
    const deploys = operations.filter((o) => o.kind === "deploy");
    // d1 and d2 stay two separate deploy operations — the bootstrap attempt
    // in between (no open session, so it founds its own card) means d2 is
    // not a retry of d1.
    expect(deploys).toHaveLength(2);
    expect(deploys[0]!.callIds).toEqual(["d1"]);
    expect(deploys[1]!.callIds).toEqual(["d2"]);
  });
});

// ---- declined / stopped: not "done" ----

describe("reduceZeropsOperations — declined and stopped are their own phase, never done", () => {
  it("a declined call is phase declined", () => {
    const { operations } = reduceFrom([
      {
        id: "d1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_delete",
        input: { hostname: "old" },
        status: "declined",
      },
    ]);
    expect(operations[0]!.phase).toBe("declined");
    expect(operations[0]!.statusWord).toBe("Declined");
  });

  it("a stopped call is phase stopped", () => {
    const { operations } = reduceFrom([
      {
        id: "s1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_scale",
        input: { hostname: "old" },
        status: "stopped",
      },
    ]);
    expect(operations[0]!.phase).toBe("stopped");
    expect(operations[0]!.statusWord).toBe("Stopped");
  });

  it("an interrupted call (orphaned by the client's own R10) is phase interrupted", () => {
    const activities = [
      activityFor({
        id: "i1",
        createdAt: "2026-09-01T00:00:00.000Z",
        turnId: "t1",
        toolName: "zerops_deploy",
        input: { targetService: "app" },
        status: "inProgress",
      }),
    ];
    const calls = collectZeropsCalls(activities, "t2"); // t2 is running now, not t1
    const { operations } = reduceZeropsOperations(calls);
    expect(operations[0]!.phase).toBe("interrupted");
    expect(operations[0]!.statusWord).toBe("Interrupted");
    expect(operations[0]!.closing).toBe("The agent did not report a result.");
  });
});

// ---- standalone card kinds ----

describe("reduceZeropsOperations — standalone card kinds", () => {
  it("a standalone import, done: subject, step, closing from the summary", () => {
    const { operations } = reduceFrom([
      {
        id: "imp1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_import",
        status: "completed",
        resultText: JSON.stringify({
          projectId: "p1",
          processes: [
            { processId: "1", actionName: "stack.create", status: "FINISHED", service: "newsvc" },
          ],
          summary: "1 service created",
        }),
      },
    ]);
    const op = operations[0]!;
    expect(op.kind).toBe("import");
    expect(op.phase).toBe("done");
    expect(op.subject).toBe("newsvc");
    expect(op.closing).toBe("1 service created");
  });

  it("a mount call: subject, step, closing counting mounted services", () => {
    const { operations } = reduceFrom([
      {
        id: "mnt1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_mount",
        input: { action: "mount", hostname: "db" },
        status: "completed",
        resultText: JSON.stringify({
          mounts: [{ hostname: "db", mounted: true, mountPath: "/mnt/db" }],
        }),
      },
    ]);
    const op = operations[0]!;
    expect(op.kind).toBe("mount");
    expect(op.closing).toBe("1 of 1 services mounted.");
  });

  it("a subdomain call: statusWord and closing by action, links from the URLs", () => {
    const { operations } = reduceFrom([
      {
        id: "sub1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_subdomain",
        input: { serviceHostname: "weatherdash", action: "enable" },
        status: "completed",
        resultText: JSON.stringify({
          serviceHostname: "weatherdash",
          action: "enable",
          subdomainUrls: ["https://weatherdash-abcd.prg1.zerops.app"],
        }),
      },
    ]);
    const op = operations[0]!;
    expect(op.statusWord).toBe("Enabled");
    expect(op.closing).toBe("Enabled.");
    expect(op.links).toEqual([
      {
        label: "weatherdash-abcd.prg1.zerops.app",
        url: "https://weatherdash-abcd.prg1.zerops.app",
      },
    ]);
  });
});

// helper: real fixtures go through collectZeropsCalls first — the running
// turn is irrelevant since every real call is already settled.
function reduceFrom2(thread: { activities: ReadonlyArray<OrchestrationThreadActivity> }) {
  const calls = collectZeropsCalls(thread.activities, null);
  return reduceZeropsOperations(calls);
}
