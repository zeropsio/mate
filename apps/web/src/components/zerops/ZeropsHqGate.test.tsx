import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { HqGateScreen } from "./ZeropsHqGate";

const screen = (props: Partial<Parameters<typeof HqGateScreen>[0]>) =>
  renderToStaticMarkup(
    <HqGateScreen
      organizationName="Acme"
      gate={{ kind: "birth" }}
      birth={undefined}
      onTryAgain={() => undefined}
      onReadAgain={() => undefined}
      {...props}
    />,
  );

/** The steps as drawn, each `<state>:<words>`. */
const steps = (html: string) =>
  [...html.matchAll(/data-hq-birth-step="([a-z]+)"[^>]*>(?:<[^>]+>)*([^<]+)/gu)].map(
    (match) => `${match[1]}:${match[2]!.replaceAll("&#x27;", "'")}`,
  );

describe("HqGateScreen", () => {
  it("explains HQ creation and waits for an administrator to choose Set up HQ", () => {
    const html = screen({});
    expect(html).toContain("Set up HQ");
    expect(html).toContain("a project named Headquarters in Zerops");
    expect(steps(html)).toEqual([]);
    expect(html).not.toContain("Setting up Mate");
  });
  it("shows an owner HQ being set up, step by step, with the one it is on", () => {
    const html = screen({ birth: { kind: "running", step: "deploy" } });
    expect(html).toContain("Setting up Mate for Acme");
    expect(steps(html)).toEqual([
      "done:Creating HQ's project",
      "done:Starting HQ's services",
      "done:Giving HQ its access",
      "running:Deploying HQ",
      "waiting:Giving HQ its address",
      "waiting:Marking it this organization's HQ",
      "waiting:Waiting for HQ to answer",
    ]);
    expect(html).not.toContain("<button");
  });

  it("names the step that stopped it, and offers Try again", () => {
    const html = screen({
      birth: { kind: "failed", step: "deploy", reason: "offline." },
    });
    expect(steps(html)).toContain("failed:Deploying HQ");
    expect(html).toContain("offline.");
    expect(html).toContain("Again");
    expect(html).not.toContain("Start over");
  });

  it("an uncertain import offers Again without discarding the birth's identity", () => {
    const html = screen({
      birth: {
        kind: "failed",
        step: "project",
        reason: "Look for a Headquarters project in Zerops first.",
      },
    });
    expect(html).toContain("Again");
    expect(html).not.toContain("Start over");
  });

  it("tells anybody else whom to ask, and offers nothing", () => {
    const line = "An admin sets up Mate for this organization. Ask Ada.";
    const html = screen({ gate: { kind: "ask", line } });
    expect(html).toContain(line);
    expect(html).not.toContain("<button");
  });

  it("waits for the member list, and offers reading it again once it failed", () => {
    expect(screen({ gate: { kind: "reading", failed: false } })).toContain("Reading Acme");
    const failed = screen({ gate: { kind: "reading", failed: true } });
    expect(failed).toContain("Couldn");
    expect(failed).toContain("Try again");
  });
});
