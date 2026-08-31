import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsActivityResult } from "@t3tools/client-runtime/zerops/activityResult";
import { readZeropsCardSource } from "@t3tools/client-runtime/zerops/cards/decode";
import { LIVE_DEPLOY_ERROR_RESULT } from "@t3tools/client-runtime/zerops/cards/liveFixtures";
import { decodeZeropsCard } from "@t3tools/client-runtime/zerops/cards/payloads";
import { ZeropsToolCard } from "./ZeropsToolCard";

/** The whole path a timeline row takes: result text → payload → markup. */
const render = (toolName: string, body: unknown, failed = false): string => {
  const result: ZeropsActivityResult = {
    toolName,
    resultText: typeof body === "string" ? body : JSON.stringify(body),
  };
  const payload = decodeZeropsCard(readZeropsCardSource(result, { failed }));
  return payload === undefined ? "" : renderToStaticMarkup(<ZeropsToolCard payload={payload} />);
};

/** Direct deploy receipt returned before the asynchronous build/deploy settles. */
const BUILD_TRIGGERED_DEPLOY_RESULT = {
  status: "BUILD_TRIGGERED",
  mode: "ssh",
  sourceService: "kanbandev",
  targetService: "kanbanstage",
  targetServiceId: "svc-stage",
  targetServiceType: "nodejs@22",
  message: "Build triggered from kanbandev to kanbanstage via SSH",
  monitorHint: "Build runs asynchronously. Poll zerops_events for build/deploy FINISHED status.",
};

describe("ZeropsToolCard", () => {
  it.each([
    {
      name: "plan in progress",
      toolName: "zerops_workflow",
      body: {
        intent: "Build a kanban",
        message: "Confirm these services",
        progress: {
          total: 3,
          completed: 1,
          steps: [
            { name: "Discover services", status: "done" },
            { name: "Provision services", status: "current" },
            { name: "Close workflow", status: "pending" },
          ],
        },
      },
      kind: "plan",
      title: "Build a kanban",
      status: "In progress",
      tone: "busy",
      outcome: "1 of 3 steps complete",
      stepState: "running",
    },
    {
      name: "partial import",
      toolName: "zerops_import",
      body: {
        projectName: "z3-eval",
        processes: [
          { service: "kanbandev", status: "FINISHED", actionName: "stack.create" },
          { service: "kanbanstage", status: "RUNNING", actionName: "stack.create" },
        ],
        serviceErrors: [{ service: "db", code: "INVALID", message: "unknown type" }],
      },
      kind: "import",
      title: "Import z3-eval",
      status: "Partially imported",
      tone: "attention",
      outcome: "1 of 3 services imported",
      stepState: "failed",
    },
    {
      name: "partial mount",
      toolName: "zerops_mount",
      body: {
        mounts: [
          { hostname: "kanbandev", mountPath: "/var/www/kanbandev", mounted: true },
          { hostname: "kanbanstage", mounted: false, message: "not mounted" },
        ],
      },
      kind: "mount",
      title: "Mount services",
      status: "Partially mounted",
      tone: "attention",
      outcome: "1 of 2 services mounted",
      stepState: "failed",
    },
    {
      name: "triggered asynchronous deploy",
      toolName: "zerops_deploy",
      body: BUILD_TRIGGERED_DEPLOY_RESULT,
      kind: "deploy",
      title: "Deploy kanbanstage",
      status: "Build triggered",
      tone: "busy",
      outcome: "Build triggered from kanbandev to kanbanstage via SSH",
      stepState: "running",
    },
    {
      name: "successful deploy",
      toolName: "zerops_deploy",
      body: {
        status: "DEPLOYED",
        targetService: "kanbandev",
        buildStatus: "ACTIVE",
        buildDuration: "48s",
        subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
      },
      kind: "deploy",
      title: "Deploy kanbandev",
      status: "Deployed",
      tone: "ok",
      outcome: "Deployment completed in 48s",
      stepState: "done",
    },
    {
      name: "failed verification",
      toolName: "zerops_verify",
      body: {
        hostname: "kanbandev",
        status: "degraded",
        checks: [
          { name: "service_running", status: "pass" },
          { name: "http_root", status: "fail", httpStatus: 503 },
        ],
      },
      kind: "verify",
      title: "Verify kanbandev",
      status: "Checks failed",
      tone: "failed",
      outcome: "1 of 2 checks passed",
      stepState: "failed",
    },
    {
      name: "enabled subdomain",
      toolName: "zerops_subdomain",
      body: {
        serviceHostname: "kanbandev",
        action: "enable",
        subdomainUrls: ["https://kanbandev-26a7-3000.prg1.zerops.app"],
      },
      kind: "subdomain",
      title: "Enable subdomain for kanbandev",
      status: "Enabled",
      tone: "ok",
      outcome: "Subdomain enabled",
      stepState: "done",
    },
    {
      name: "structured error",
      toolName: "zerops_deploy",
      body: {
        code: "GIT_TOKEN_INVALID",
        error: "the git token was rejected",
        suggestion: "ask the user for a fresh token",
      },
      failed: true,
      kind: "error",
      title: "Operation failed",
      status: "Failed",
      tone: "failed",
      outcome: "the git token was rejected",
      stepState: "failed",
    },
  ])(
    "renders plan/import/mount/deploy/verify/subdomain/error as semantic process shells: $name",
    ({ body, failed, kind, outcome, status, stepState, title, tone, toolName }) => {
      const html = render(toolName, body, failed);

      expect(html).toContain(`data-zerops-card-kind="${kind}"`);
      expect(html).toContain(`data-zerops-card-tone="${tone}"`);
      expect(html).toContain('data-zerops-primitive="flat-card"');
      expect(html).toContain('data-zerops-primitive="micro-label"');
      expect(html).toContain('data-zerops-primitive="status-dot"');
      expect(html).toContain('data-zerops-primitive="process-steps"');
      expect(html).toContain(`data-zerops-process-state="${stepState}"`);
      expect(html).toContain(`<h3>${title}</h3>`);
      expect(html).toContain(`>${status}</span>`);
      expect(html).toContain(`data-zerops-card-outcome="true">${outcome}</p>`);
    },
  );

  it("separates URLs from technical detail and exposes a status word", () => {
    const html = render("zerops_deploy", {
      status: "DEPLOYED",
      targetService: "kanbandev",
      buildStatus: "ACTIVE",
      buildDuration: "48s",
      subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
    });

    const technicalDetails = html.match(/<div aria-label="Technical details".*?<\/div>/su)?.[0];
    const urls = html.match(/<div aria-label="URLs".*?<\/div>/su)?.[0];

    expect(html).toContain('aria-label="Result status"');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-zerops-primitive="status-dot"');
    expect(html).toContain(">Deployed</span>");
    expect(technicalDetails).toContain('data-zerops-chip-kind="info"');
    expect(technicalDetails).toContain("Build ACTIVE");
    expect(technicalDetails).toContain("48s");
    expect(technicalDetails).not.toContain('data-zerops-chip-kind="url"');
    expect(urls).toContain('data-zerops-chip-kind="url"');
    expect(urls).toContain('href="https://kanbandev-26a7-3000.prg1.zerops.app"');
    expect(urls).not.toContain('data-zerops-chip-kind="info"');
  });

  /**
   * The degrade path. Each of these renders nothing here, which is the signal
   * the timeline uses to fall back to its generic tool block.
   */
  it("draws no card for a payload it cannot read", () => {
    expect(render("zerops_deploy", "## Status\n\nprose, not a document")).toBe("");
    expect(render("zerops_deploy", { unrelated: true })).toBe("");
    expect(render("zerops_logs", { lines: ["hello"] })).toBe("");
    expect(render("zerops_deploy", [1, 2, 3])).toBe("");
  });
});

/**
 * Captured from a live container: a failed zerops_deploy whose `error` embeds
 * five lines of zcli log output.
 */
describe("ZeropsToolCard — a real error payload", () => {
  const html = () => render("zerops_deploy", JSON.parse(LIVE_DEPLOY_ERROR_RESULT) as unknown, true);

  it("shows the code, the suggestion and the classification", () => {
    expect(html()).toContain("SSH_DEPLOY_FAILED");
    expect(html()).toContain("Check the diagnostic field for full command output.");
    expect(html()).toContain("network");
  });

  /** Without this the five log lines render as one run-on sentence. */
  it("preserves the message's line breaks and bounds its height", () => {
    expect(html()).toContain("whitespace-pre-wrap");
    expect(html()).toContain("max-h-40");
    expect(html()).toContain("overflow-y-auto");
  });

  /** `diagnostic` is 2 KB of duplicate log output; the card never shows it. */
  it("leaves the diagnostic blob out of the card", () => {
    expect(html()).not.toContain(".zcli.yml");
  });
});
