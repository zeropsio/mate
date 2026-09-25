import { describe, expect, it } from "vite-plus/test";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";

import {
  addMariadb,
  adoptTwoServices,
  mountStatus,
  verifyAndRefusedDeploy,
  weatherdashFirstDeploy,
} from "../operations/__fixtures__/index.ts";
import type { OperationBuildContext } from "./builders/shared.ts";
import { collectZeropsCalls } from "./calls.ts";
import { reduceZeropsOperations } from "./operations.ts";
import type { ZeropsOperation } from "./types.ts";

/** The clock at the synthetic calls' own moment, no project known — a triggered build is still running. */
const CONTEXT: OperationBuildContext = {
  nowMs: Date.parse("2026-09-01T00:00:00.000Z"),
  projectId: undefined,
};

// ---- a hand-built call, as one activity row (RAW, R1-R4 fold degenerately
// to one row for these synthetic cases; rows sharing a `toolCallId` fold into
// one call) ----

interface EntrySpec {
  readonly id: string;
  /** Rows of one call share it; defaults to `id` (one row per call). */
  readonly toolCallId?: string;
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
      toolCallId: entry.toolCallId ?? entry.id,
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
  return reduceZeropsOperations(calls, CONTEXT);
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

  it("produces discover, bootstrap, deploy, verify in order", () => {
    expect(operations.map((o) => o.kind)).toEqual(["discover", "bootstrap", "deploy", "verify"]);
  });

  it("the opening discover is its own card, done, listing the project's services", () => {
    const discover = operations[0]!;
    expect(discover.phase).toBe("done");
    expect(discover.readResult).toMatchObject({ kind: "discover", pending: false });
  });

  it("keys the bootstrap operation by the founder call id, membership by the zcp session id", () => {
    const bootstrap = operations[1]!;
    expect(bootstrap.key).toMatch(/^bootstrap:/);
    expect(bootstrap.session?.sessionIds).toContain("61892e75bf9a9ad9");
  });

  it("the bootstrap operation is done, voiced by the agent, with a New service kicker", () => {
    const bootstrap = operations[1]!;
    expect(bootstrap.phase).toBe("done");
    expect(bootstrap.voiceSource).toBe("agent");
    expect(bootstrap.kicker).toBe("New service · weatherdash");
  });

  it("the deploy operation is done, subject weatherdash, live with a link", () => {
    const deploy = operations[2]!;
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
    const verify = operations[3]!;
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

  it("a session with no decoded plan anywhere (founder truncated, continuation still pending) reads 'New service' / 'In progress', never 'Done' (F3b)", () => {
    const undecodableFounder: EntrySpec = {
      id: "v1",
      createdAt: "2026-09-01T00:00:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "start", workflow: "bootstrap", route: "classic" },
      status: "completed",
      truncated: true,
    };
    const pendingContinuation: EntrySpec = {
      id: "v2",
      createdAt: "2026-09-01T00:01:00.000Z",
      toolName: "zerops_workflow",
      input: { action: "complete", step: "discover" },
      status: "inProgress",
    };
    const { operations } = reduceFrom([undecodableFounder, pendingContinuation]);
    const bootstrap = operations.find((o) => o.kind === "bootstrap")!;
    expect(bootstrap.phase).toBe("running");
    expect(bootstrap.kicker).toBe("New service");
    expect(bootstrap.statusWord).toBe("In progress");
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
    const { operations } = reduceZeropsOperations(calls, CONTEXT);
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

  it("condenses a browser batch into viewport, media, step count and failed step; tail steps are not listed", () => {
    const { operations } = reduceFrom([
      {
        id: "brw5",
        createdAt: "2026-09-01T00:00:00.000Z",
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
      },
    ]);
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
    const { operations } = reduceFrom([
      {
        id: "brw6",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_browser",
        input: { url: "https://kanbandev-26a7.prg1.zerops.app" },
        status: "completed",
        resultText: "## Browser walk\n\nEverything looks fine.",
      },
    ]);
    expect(operations[0]!.browserSummary).toBeUndefined();
  });
});

// helper: real fixtures go through collectZeropsCalls first — the running
// turn is irrelevant since every real call is already settled.
function reduceFrom2(thread: { activities: ReadonlyArray<OrchestrationThreadActivity> }) {
  const calls = collectZeropsCalls(thread.activities, null);
  return reduceZeropsOperations(calls, CONTEXT);
}

describe("a verify whose checks failed", () => {
  // The tool answers whether it could look; the checks answer what it saw. A
  // verify that ran to completion over a service that is down came back
  // `completed`, and the card said HEALTHY above three red steps (measured on
  // the test account, 2026-09-20).
  const verifyWith = (checks: ReadonlyArray<{ name: string; status: string }>) =>
    reduceFrom([
      {
        id: "v1",
        createdAt: "2026-09-20T10:00:00.000Z",
        toolName: "zerops_verify",
        input: { serviceHostname: "appdev" },
        status: "completed",
        resultText: JSON.stringify({
          hostname: "appdev",
          type: "runtime",
          typeVersion: "alpine/nginx@1.22",
          runtimeClass: "worker",
          status: "healthy",
          checks,
        }),
      },
    ]).operations[0]!;

  it("is failed, whatever the tool call's own status was", () => {
    const verify = verifyWith([
      { name: "service_running", status: "fail" },
      { name: "http_internal", status: "skip" },
      { name: "http_public", status: "fail" },
    ]);
    expect(verify.phase).toBe("failed");
    expect(verify.statusWord).not.toBe("Healthy");
    expect(verify.closing).toBe("2 of 3 checks failed.");
  });

  it("stays healthy when nothing failed, so a skipped check is not a failure", () => {
    const verify = verifyWith([
      { name: "service_running", status: "pass" },
      { name: "http_public", status: "skip" },
    ]);
    expect(verify.phase).toBe("done");
  });
});

// ---- the attempt ordinal ----

describe("reduceZeropsOperations — the attempt ordinal", () => {
  const at = (minute: number) => `2026-09-01T00:${String(minute).padStart(2, "0")}:00.000Z`;
  const deploy = (
    id: string,
    minute: number,
    status: EntrySpec["status"],
    input: Record<string, unknown> = { targetService: "appdev" },
    turnId = "t1",
  ): EntrySpec => ({
    id,
    createdAt: at(minute),
    turnId,
    toolName: "zerops_deploy",
    input,
    status,
    ...(status === "failed"
      ? { resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }) }
      : {}),
  });
  const browser = (id: string, minute: number, url: string): EntrySpec => ({
    id,
    createdAt: at(minute),
    toolName: "zerops_browser",
    input: { url },
    status: "completed",
  });

  interface OrdinalCase {
    readonly name: string;
    readonly entries: ReadonlyArray<EntrySpec>;
    readonly runningTurnId?: string | null;
    /** Operation key → its attempt ordinal (`undefined` = no number). */
    readonly expected: Readonly<Record<string, number | undefined>>;
  }

  const cases: ReadonlyArray<OrdinalCase> = [
    {
      name: "two concurrent in-flight calls on one target get distinct ordinals by anchor",
      entries: [deploy("a", 0, "inProgress"), deploy("b", 1, "inProgress")],
      expected: { "op:a": 1, "op:b": 2 },
    },
    {
      name: "a call whose target has not streamed in yet has no number",
      entries: [
        deploy("p", 0, "completed"),
        { ...deploy("x-start", 1, "inProgress", {}), toolCallId: "x" },
      ],
      expected: { "op:p": 1, "op:x": undefined },
    },
    {
      name: "a target arriving late gives the call its number by anchor",
      entries: [
        deploy("p", 0, "completed"),
        { ...deploy("x-start", 1, "inProgress", {}), toolCallId: "x" },
        { ...deploy("x-done", 2, "completed"), toolCallId: "x" },
      ],
      expected: { "op:p": 1, "op:x": 2 },
    },
    {
      name: "a first call is attempt 1",
      entries: [deploy("a", 0, "completed")],
      expected: { "op:a": 1 },
    },
    {
      name: "a repeat after a success is attempt 2",
      entries: [deploy("a", 0, "completed"), deploy("b", 1, "completed")],
      expected: { "op:a": 1, "op:b": 2 },
    },
    {
      name: "repeats after failures fold into one card showing its latest member's number",
      entries: [deploy("a", 0, "failed"), deploy("b", 1, "failed"), deploy("c", 2, "completed")],
      expected: { "op:a": 2, "op:c": 3 },
    },
    {
      name: "an interrupted call counts, and the retry in the next turn is attempt 2",
      entries: [
        deploy("a", 0, "inProgress", undefined, "t1"),
        deploy("b", 1, "completed", undefined, "t2"),
      ],
      runningTurnId: "t2",
      expected: { "op:a": 1, "op:b": 2 },
    },
    {
      name: "declined and stopped calls count",
      entries: [deploy("a", 0, "declined"), deploy("b", 1, "stopped"), deploy("c", 2, "completed")],
      expected: { "op:a": 1, "op:b": 2, "op:c": 3 },
    },
    {
      name: "two hosts interleaved count independently",
      entries: [
        deploy("a", 0, "completed", { targetService: "appdev" }),
        deploy("b", 1, "completed", { targetService: "apistage" }),
        deploy("c", 2, "completed", { targetService: "appdev" }),
        deploy("d", 3, "completed", { targetService: "apistage" }),
      ],
      expected: { "op:a": 1, "op:b": 1, "op:c": 2, "op:d": 2 },
    },
    {
      name: "a hostname is trimmed and lowercased",
      entries: [
        deploy("a", 0, "completed", { targetService: "appdev" }),
        deploy("b", 1, "completed", { targetService: " AppDev " }),
      ],
      expected: { "op:a": 1, "op:b": 2 },
    },
    {
      name: "one host, different kinds: deploy and verify count independently",
      entries: [
        deploy("a", 0, "completed"),
        {
          id: "v",
          createdAt: at(1),
          toolName: "zerops_verify",
          input: { serviceHostname: "appdev" },
          status: "completed",
        },
        deploy("b", 2, "completed"),
      ],
      expected: { "op:a": 1, "op:v": 1, "op:b": 2 },
    },
    {
      name: "the count continues across turns",
      entries: [
        deploy("a", 0, "completed", undefined, "t1"),
        deploy("b", 1, "completed", undefined, "t2"),
        deploy("c", 2, "completed", undefined, "t3"),
      ],
      runningTurnId: null,
      expected: { "op:a": 1, "op:b": 2, "op:c": 3 },
    },
    {
      name: "a browser check is one target up to host case, trailing slash, query order and fragment",
      entries: [
        browser("b1", 0, "https://App.example.com/board/?b=2&a=1"),
        browser("b2", 1, "https://app.example.com/board?a=1&b=2#top"),
        browser("b3", 2, "https://app.example.com/board?a=1&b=2"),
        browser("b4", 3, "https://app.example.com/other"),
        browser("b5", 4, "https://app.example.com/board?a=1"),
      ],
      expected: { "op:b1": 1, "op:b2": 2, "op:b3": 3, "op:b4": 1, "op:b5": 1 },
    },
    {
      name: "a browser check at the root is one target with or without the slash",
      entries: [
        browser("b1", 0, "https://app.example.com"),
        browser("b2", 1, "https://app.example.com/"),
      ],
      expected: { "op:b1": 1, "op:b2": 2 },
    },
    {
      name: "a browser check with no parseable URL has no number",
      entries: [browser("b1", 0, "not a url"), browser("b2", 1, "not a url")],
      expected: { "op:b1": undefined, "op:b2": undefined },
    },
    {
      name: "a bootstrap session and a failed generic tool (error) have no number",
      entries: [
        {
          id: "w",
          createdAt: at(0),
          toolName: "zerops_workflow",
          input: { action: "start", workflow: "bootstrap", route: "classic" },
          status: "completed",
          resultText: planResult({}),
        },
        {
          id: "e1",
          createdAt: at(1),
          toolName: "zerops_knowledge",
          input: { hostname: "appdev" },
          status: "failed",
          resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }),
        },
        {
          id: "e2",
          createdAt: at(2),
          toolName: "zerops_export",
          // another host, so the R8 fold keeps it a card of its own
          input: { hostname: "apistage" },
          status: "failed",
          resultText: JSON.stringify({ code: "API_ERROR", error: "boom" }),
        },
      ],
      expected: { "bootstrap:w": undefined, "op:e1": undefined, "op:e2": undefined },
    },
  ];

  // A live stream, row by row in arrival order: turn t1 settles, turn t2 is
  // still running when the page reloads.
  const stream: ReadonlyArray<EntrySpec> = [
    deploy("a", 0, "failed", undefined, "t1"),
    deploy("b", 1, "completed", undefined, "t1"),
    deploy("d", 2, "inProgress", { targetService: "apistage" }, "t2"),
    { ...deploy("c-start", 3, "inProgress", {}, "t2"), toolCallId: "c" },
    { ...deploy("c-args", 4, "inProgress", undefined, "t2"), toolCallId: "c" },
    { ...deploy("c-done", 5, "failed", undefined, "t2"), toolCallId: "c" },
    deploy("e", 6, "failed", undefined, "t2"),
    deploy("f", 7, "inProgress", undefined, "t2"),
  ];
  const attemptsByKey = (operations: ReadonlyArray<ZeropsOperation>) =>
    Object.fromEntries(operations.map((o) => [o.key, o.attempts]));

  it("a card's number never changes while the stream grows, unless a retry folds into it", () => {
    const seen = new Map<string, { readonly callCount: number; readonly attempts: number }>();
    for (let length = 1; length <= stream.length; length += 1) {
      for (const operation of reduceFrom(stream.slice(0, length), "t2").operations) {
        const before = seen.get(operation.key);
        if (before !== undefined && before.callCount === operation.callIds.length) {
          expect(operation.attempts).toBe(before.attempts);
        }
        if (operation.attempts !== undefined) {
          seen.set(operation.key, {
            callCount: operation.callIds.length,
            attempts: operation.attempts,
          });
        }
      }
    }
    expect(attemptsByKey(reduceFrom(stream, "t2").operations)).toStrictEqual({
      "op:a": 1,
      "op:b": 2,
      "op:c": 4,
      "op:d": 1,
      "op:f": 5,
    });
  });

  it("a reload — rows in any order, the turn no longer running — gives the same numbers", () => {
    const live = attemptsByKey(reduceFrom(stream, "t2").operations);
    const reloaded = attemptsByKey(reduceFrom(stream.toReversed(), null).operations);
    expect(reloaded).toStrictEqual(live);
  });

  it.each(cases)("$name", ({ entries, runningTurnId, expected }) => {
    const { operations } = reduceFrom(entries, runningTurnId === undefined ? "t1" : runningTurnId);
    const actual = Object.fromEntries(operations.map((o) => [o.key, o.attempts]));
    expect(actual).toStrictEqual(expected);
    for (const operation of operations) {
      expect(operation.attemptWord).toBe(
        operation.attempts !== undefined && operation.attempts > 1
          ? `attempt ${operation.attempts}`
          : undefined,
      );
    }
  });
});

describe("reduceZeropsOperations — read tools", () => {
  const cases = [
    {
      toolName: "zerops_logs",
      kind: "logs",
      input: { serviceHostname: "app" },
      result: { entries: [], hasMore: false },
    },
    {
      toolName: "zerops_events",
      kind: "events",
      input: { serviceHostname: "app" },
      result: { events: [] },
    },
    {
      toolName: "zerops_process",
      kind: "process",
      input: { action: "wait", service: "app" },
      result: { processes: [], settled: true },
    },
    {
      toolName: "zerops_discover",
      kind: "discover",
      input: { service: "app" },
      result: { project: {}, services: [] },
    },
  ] as const;

  for (const { toolName, kind, input, result } of cases) {
    it(`${toolName} is a ${kind} card from its start, filled in place under one key`, () => {
      const running = reduceFrom([
        { id: "c1", createdAt: "2026-09-01T00:00:00.000Z", toolName, input, status: "inProgress" },
      ]);
      const done = reduceFrom([
        {
          id: "c1",
          createdAt: "2026-09-01T00:00:00.000Z",
          toolName,
          input,
          status: "completed",
          resultText: JSON.stringify(result),
        },
      ]);
      expect(running.genericCalls).toEqual([]);
      expect(running.operations[0]).toMatchObject({
        key: "op:c1",
        kind,
        phase: "running",
        readResult: { kind, pending: true },
      });
      expect(done.operations[0]).toMatchObject({
        key: "op:c1",
        kind,
        phase: "done",
        readResult: { kind, pending: false },
      });
    });

    it(`${toolName} read again is never "attempt 2"`, () => {
      const { operations } = reduceFrom([
        {
          id: "c1",
          createdAt: "2026-09-01T00:00:00.000Z",
          toolName,
          input,
          status: "completed",
          resultText: JSON.stringify(result),
        },
        {
          id: "c2",
          createdAt: "2026-09-01T00:00:05.000Z",
          toolName,
          input,
          status: "completed",
          resultText: JSON.stringify(result),
        },
      ]);
      expect(operations.map((operation) => operation.attemptWord)).toEqual([undefined, undefined]);
    });
  }

  it("keeps the kind of a read call that failed, drawn as the error card", () => {
    const { operations } = reduceFrom([
      {
        id: "c1",
        createdAt: "2026-09-01T00:00:00.000Z",
        toolName: "zerops_logs",
        input: { serviceHostname: "app" },
        status: "failed",
        resultText: JSON.stringify({ code: "SERVICE_NOT_FOUND", error: "No service app" }),
      },
    ]);
    expect(operations[0]).toMatchObject({
      key: "op:c1",
      kind: "logs",
      phase: "failed",
      kicker: "Error · SERVICE_NOT_FOUND",
      closing: "No service app",
    });
    expect(operations[0]).not.toHaveProperty("readResult");
  });
});
