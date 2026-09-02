import { describe, expect, it } from "vite-plus/test";

import type { ZeropsActivityResult } from "../activityResult.ts";
import { readZeropsCardSource } from "./decode.ts";
import { LIVE_DEPLOY_ERROR_RESULT, LIVE_VERIFY_RESULT } from "./liveFixtures.ts";
import { decodeZeropsCard } from "./payloads.ts";

const result = (toolName: string, body: unknown): ZeropsActivityResult => ({
  toolName,
  resultText: typeof body === "string" ? body : JSON.stringify(body),
});

const card = (toolName: string, body: unknown, failed = false) =>
  decodeZeropsCard(readZeropsCardSource(result(toolName, body), { failed }));

describe("decodeZeropsCard — deploy", () => {
  /** `internal/ops/deploy_common.go` `DeployResult` + `deployLocalResponse`. */
  it("reads a successful deploy, including the URL chip", () => {
    expect(
      card("zerops_deploy", {
        status: "DEPLOYED",
        mode: "ssh",
        targetService: "kanbandev",
        targetServiceId: "svc-1",
        message: "Deployed kanbandev",
        buildStatus: "ACTIVE",
        buildDuration: "48s",
        subdomainAccessEnabled: true,
        subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
        envelope: { phase: "develop-active" },
      }),
    ).toEqual({
      kind: "deploy",
      target: "kanbandev",
      status: "DEPLOYED",
      message: "Deployed kanbandev",
      buildStatus: "ACTIVE",
      buildDuration: "48s",
      subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
      warnings: [],
    });
  });

  it("reads a failed deploy with its phase and classification", () => {
    expect(
      card("zerops_deploy", {
        status: "BUILD_FAILED",
        targetService: "kanbandev",
        buildStatus: "BUILD_FAILED",
        failedPhase: "build",
        failureClassification: {
          category: "build",
          likelyCause: "missing dependency",
          suggestedAction: "add it to package.json",
        },
        warnings: ["build logs truncated"],
      }),
    ).toEqual({
      kind: "deploy",
      target: "kanbandev",
      status: "BUILD_FAILED",
      buildStatus: "BUILD_FAILED",
      failedPhase: "build",
      failureCause: "missing dependency",
      failureAction: "add it to package.json",
      warnings: ["build logs truncated"],
    });
  });

  it("ignores a field zcp adds that this build knows nothing about", () => {
    const decoded = card("zerops_deploy", {
      status: "DEPLOYED",
      targetService: "kanbandev",
      somethingNewInZcp: { nested: true },
    });

    expect(decoded).toEqual({
      kind: "deploy",
      target: "kanbandev",
      status: "DEPLOYED",
      warnings: [],
    });
  });
});

describe("decodeZeropsCard — verify", () => {
  /** `internal/ops/verify.go` `VerifyResult`. */
  it("reads a scoped verify with its HTTP check", () => {
    expect(
      card("zerops_verify", {
        hostname: "kanbandev",
        type: "runtime",
        status: "healthy",
        checks: [
          { name: "service_running", status: "pass" },
          { name: "http_root", status: "pass", httpStatus: 200, detail: "OK" },
        ],
      }),
    ).toEqual({
      kind: "verify",
      hostname: "kanbandev",
      status: "healthy",
      checks: [
        { name: "service_running", status: "pass" },
        { name: "http_root", status: "pass", httpStatus: 200, detail: "OK" },
      ],
    });
  });

  /** `VerifyAllResult` has no hostname; each service becomes one line. */
  it("folds the all-services shape into one reading", () => {
    expect(
      card("zerops_verify", {
        summary: "2 services",
        status: "degraded",
        services: [
          { hostname: "kanbandev", status: "healthy", checks: [] },
          { hostname: "kanbanstage", status: "unhealthy", checks: [] },
        ],
      }),
    ).toEqual({
      kind: "verify",
      hostname: "2 services",
      status: "degraded",
      checks: [
        { name: "kanbandev", status: "healthy" },
        { name: "kanbanstage", status: "unhealthy" },
      ],
    });
  });
});

describe("decodeZeropsCard — import, mount, subdomain, plan", () => {
  /** `internal/ops/import.go` `ImportResult`. */
  it("reads per-service import progress and errors together", () => {
    expect(
      card("zerops_import", {
        projectId: "proj-1",
        projectName: "z3-eval",
        summary: "3 services",
        processes: [
          { processId: "p1", actionName: "stack.create", status: "FINISHED", service: "kanbandev" },
          {
            processId: "p2",
            actionName: "stack.create",
            status: "RUNNING",
            service: "kanbanstage",
          },
        ],
        serviceErrors: [{ service: "db", code: "INVALID", message: "unknown type" }],
      }),
    ).toEqual({
      kind: "import",
      projectName: "z3-eval",
      summary: "3 services",
      services: [
        { hostname: "kanbandev", status: "FINISHED", action: "stack.create" },
        { hostname: "kanbanstage", status: "RUNNING", action: "stack.create" },
      ],
      errors: [{ hostname: "db", message: "unknown type" }],
    });
  });

  /** `internal/ops/mount.go` `MountResult`. */
  it("reads a single mount", () => {
    expect(
      card("zerops_mount", {
        status: "MOUNTED",
        hostname: "kanbandev",
        mountPath: "/var/www/kanbandev",
        message: "Mounted kanbandev",
      }),
    ).toEqual({
      kind: "mount",
      mounts: [
        {
          hostname: "kanbandev",
          mounted: true,
          mountPath: "/var/www/kanbandev",
          message: "Mounted kanbandev",
        },
      ],
    });
  });

  /** `MountStatusResult` — the `action="status"` shape. */
  it("reads a mount listing", () => {
    expect(
      card("zerops_mount", {
        mounts: [
          { hostname: "kanbandev", mountPath: "/var/www/kanbandev", mounted: true },
          { hostname: "kanbanstage", mounted: false, message: "not mounted" },
        ],
      }),
    ).toEqual({
      kind: "mount",
      mounts: [
        { hostname: "kanbandev", mounted: true, mountPath: "/var/www/kanbandev" },
        { hostname: "kanbanstage", mounted: false, message: "not mounted" },
      ],
    });
  });

  /** `internal/ops/subdomain.go` `SubdomainResult`. */
  it("reads a subdomain enable", () => {
    expect(
      card("zerops_subdomain", {
        serviceHostname: "kanbandev",
        serviceId: "svc-1",
        action: "enable",
        status: "FINISHED",
        subdomainUrls: ["https://kanbandev-26a7-3000.prg1.zerops.app"],
      }),
    ).toEqual({
      kind: "subdomain",
      hostname: "kanbandev",
      action: "enable",
      urls: ["https://kanbandev-26a7-3000.prg1.zerops.app"],
    });
  });

  /** `internal/workflow/bootstrap.go` `BootstrapResponse` — the plan to confirm. */
  it("reads the bootstrap plan and its progress", () => {
    expect(
      card("zerops_workflow", {
        kind: "session-active",
        sessionId: "s1",
        intent: "build a kanban",
        message: "Confirm these services",
        progress: {
          total: 3,
          completed: 1,
          steps: [
            { name: "discover", status: "done" },
            { name: "provision", status: "current" },
            { name: "close", status: "pending" },
          ],
        },
      }),
    ).toEqual({
      kind: "plan",
      sessionId: "s1",
      intent: "build a kanban",
      message: "Confirm these services",
      completed: 1,
      total: 3,
      steps: [
        { name: "discover", status: "done" },
        { name: "provision", status: "current" },
        { name: "close", status: "pending" },
      ],
    });
  });

  it("reads a bootstrap plan with no sessionId (route-discovery has none)", () => {
    expect(
      card("zerops_workflow", {
        progress: { total: 1, completed: 0, steps: [{ name: "discover", status: "current" }] },
      }),
    ).toEqual({
      kind: "plan",
      completed: 0,
      total: 1,
      steps: [{ name: "discover", status: "current" }],
    });
  });
});

describe("decodeZeropsCard — errors", () => {
  /** `internal/tools/errwire.go` `ErrorWire`; never carries an envelope. */
  it("reads a structured error whatever tool it came from", () => {
    expect(
      card(
        "zerops_deploy",
        {
          code: "GIT_TOKEN_INVALID",
          error: "the git token was rejected",
          suggestion: "ask the user for a fresh token",
          checks: [{ kind: "preflight", name: "clone", status: "fail", detail: "auth failed" }],
          failureClassification: { category: "credential" },
        },
        true,
      ),
    ).toEqual({
      kind: "error",
      code: "GIT_TOKEN_INVALID",
      message: "the git token was rejected",
      suggestion: "ask the user for a fresh token",
      failureClass: "credential",
      checks: [{ name: "clone", status: "fail", detail: "auth failed" }],
    });
  });

  /**
   * A failed call whose body is not an ErrorWire gets no card. Reading it with
   * the success decoder would render half a result as if it had worked.
   */
  it("gives a failed call no card rather than a success-shaped one", () => {
    expect(
      card("zerops_deploy", { status: "DEPLOYED", targetService: "kanbandev" }, true),
    ).toBeUndefined();
  });
});

describe("decodeZeropsCard — degrading", () => {
  it("has no card for a result that is not JSON", () => {
    expect(card("zerops_deploy", "## Status\n\nEverything is fine.")).toBeUndefined();
  });

  it("has no card for JSON that is not an object", () => {
    expect(card("zerops_deploy", [1, 2, 3])).toBeUndefined();
    expect(card("zerops_deploy", "42")).toBeUndefined();
  });

  it("has no card when the document is the wrong shape for its tool", () => {
    expect(card("zerops_deploy", { unrelated: true })).toBeUndefined();
    expect(card("zerops_verify", { unrelated: true })).toBeUndefined();
    expect(card("zerops_import", { processes: [] })).toBeUndefined();
    expect(card("zerops_mount", { mounts: [] })).toBeUndefined();
    expect(card("zerops_workflow", { kind: "route-menu" })).toBeUndefined();
  });

  it("has no card for a zerops tool this build does not draw", () => {
    expect(card("zerops_logs", { lines: ["hello"] })).toBeUndefined();
    expect(card("zerops_scale", { status: "OK" })).toBeUndefined();
  });

  /** Text absent: the call is still running, or the server dropped it as oversized. */
  it("has no card when the server carried no text", () => {
    expect(decodeZeropsCard(readZeropsCardSource({ toolName: "zerops_deploy" }))).toBeUndefined();
    expect(
      decodeZeropsCard(readZeropsCardSource({ toolName: "zerops_deploy", truncated: true })),
    ).toBeUndefined();
    expect(decodeZeropsCard(readZeropsCardSource(undefined))).toBeUndefined();
  });
});

/**
 * The decoders against results captured from a live container, byte-exact.
 *
 * The constructed fixtures above are built from zcp's Go structs and prove the
 * rules; these prove the rules were read off the right thing. They caught two
 * differences from what the structs suggested — see the assertions.
 */
describe("decodeZeropsCard — live payloads", () => {
  it("reads a real zerops_verify result", () => {
    const decoded = decodeZeropsCard(
      readZeropsCardSource({ toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT }),
    );

    expect(decoded).toEqual({
      kind: "verify",
      hostname: "s3git1",
      status: "healthy",
      checks: [
        { name: "service_running", status: "pass" },
        { name: "error_logs", status: "pass" },
      ],
    });
  });

  /**
   * The live document carries `workSessionState` and a top-level `envelope`
   * beside the VerifyResult fields. Both are ignored — the envelope reaches the
   * client through the lifecycle feed, and a card that also read it could
   * disagree with the strip about the same state.
   */
  it("ignores the envelope and workSessionState riding along with it", () => {
    const document = JSON.parse(LIVE_VERIFY_RESULT) as Record<string, unknown>;

    expect(document.envelope).toBeDefined();
    expect(document.workSessionState).toBeDefined();
    expect(
      decodeZeropsCard(
        readZeropsCardSource({ toolName: "zerops_verify", resultText: LIVE_VERIFY_RESULT }),
      ),
    ).not.toHaveProperty("envelope");
  });

  it("reads a real failed zerops_deploy as the error card", () => {
    const decoded = decodeZeropsCard(
      readZeropsCardSource(
        { toolName: "zerops_deploy", resultText: LIVE_DEPLOY_ERROR_RESULT },
        { failed: true },
      ),
    );

    expect(decoded?.kind).toBe("error");
    expect(decoded).toMatchObject({
      code: "SSH_DEPLOY_FAILED",
      suggestion: "Check the diagnostic field for full command output.",
      failureClass: "network",
      checks: [],
    });
  });

  /**
   * A real error `message` is MULTI-LINE — zcli's log output is embedded in it.
   * The card has to preserve those newlines; collapsing them runs five log
   * lines into one unreadable sentence.
   */
  it("carries the error message with its line breaks intact", () => {
    const decoded = decodeZeropsCard(
      readZeropsCardSource(
        { toolName: "zerops_deploy", resultText: LIVE_DEPLOY_ERROR_RESULT },
        { failed: true },
      ),
    );

    expect(decoded?.kind === "error" && decoded.message).toContain("\n");
    expect(decoded?.kind === "error" && decoded.message.split("\n").length).toBeGreaterThan(4);
  });
});
