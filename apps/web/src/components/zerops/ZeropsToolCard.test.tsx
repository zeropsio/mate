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

describe("ZeropsToolCard", () => {
  it("shows a deploy with its URL chip", () => {
    const html = render("zerops_deploy", {
      status: "DEPLOYED",
      targetService: "kanbandev",
      buildStatus: "ACTIVE",
      buildDuration: "48s",
      subdomainUrl: "https://kanbandev-26a7-3000.prg1.zerops.app",
    });

    expect(html).toContain("kanbandev · DEPLOYED");
    expect(html).toContain("build ACTIVE");
    expect(html).toContain("48s");
    expect(html).toContain('href="https://kanbandev-26a7-3000.prg1.zerops.app"');
    expect(html).toContain("data-zerops-card");
  });

  it("shows a failed deploy as a failure, with the phase and the cause", () => {
    const html = render("zerops_deploy", {
      status: "BUILD_FAILED",
      targetService: "kanbandev",
      failedPhase: "build",
      failureClassification: { category: "build", likelyCause: "missing dependency" },
    });

    expect(html).toContain("failed during build");
    expect(html).toContain("missing dependency");
    expect(html).toContain("border-destructive/40");
  });

  it("shows a verify as HTTP 200 with a tick", () => {
    const html = render("zerops_verify", {
      hostname: "kanbandev",
      status: "healthy",
      checks: [{ name: "http_root", status: "pass", httpStatus: 200 }],
    });

    expect(html).toContain("kanbandev · healthy");
    expect(html).toContain("HTTP 200");
    expect(html).toContain('aria-label="passed"');
  });

  it("shows import progress per service", () => {
    const html = render("zerops_import", {
      projectName: "z3-eval",
      processes: [
        { service: "kanbandev", status: "FINISHED", actionName: "stack.create" },
        { service: "kanbanstage", status: "RUNNING", actionName: "stack.create" },
      ],
      serviceErrors: [{ service: "db", code: "INVALID", message: "unknown type" }],
    });

    expect(html).toContain("kanbandev");
    expect(html).toContain("RUNNING");
    expect(html).toContain("db: unknown type");
  });

  it("shows a mount with its path", () => {
    const html = render("zerops_mount", {
      status: "MOUNTED",
      hostname: "kanbandev",
      mountPath: "/var/www/kanbandev",
      message: "Mounted",
    });

    expect(html).toContain("/var/www/kanbandev");
  });

  it("shows a subdomain's URLs as chips", () => {
    const html = render("zerops_subdomain", {
      serviceHostname: "kanbandev",
      action: "enable",
      subdomainUrls: ["https://kanbandev-26a7-3000.prg1.zerops.app"],
    });

    expect(html).toContain("Subdomain enable · kanbandev");
    expect(html).toContain("kanbandev-26a7-3000.prg1.zerops.app");
  });

  it("shows a plan with its steps", () => {
    const html = render("zerops_workflow", {
      intent: "build a kanban",
      message: "Confirm these services",
      progress: {
        total: 3,
        completed: 1,
        steps: [
          { name: "discover", status: "done" },
          { name: "provision", status: "current" },
        ],
      },
    });

    expect(html).toContain("build a kanban");
    expect(html).toContain("step 1 of 3");
    expect(html).toContain("provision");
  });

  it("shows a structured error with its code and suggestion", () => {
    const html = render(
      "zerops_deploy",
      {
        code: "GIT_TOKEN_INVALID",
        error: "the git token was rejected",
        suggestion: "ask the user for a fresh token",
      },
      true,
    );

    expect(html).toContain("GIT_TOKEN_INVALID");
    expect(html).toContain("the git token was rejected");
    expect(html).toContain("ask the user for a fresh token");
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
