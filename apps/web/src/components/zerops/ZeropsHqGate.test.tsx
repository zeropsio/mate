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

/** The row's words: the one step it is on, or why it stopped. */
const row = (html: string) =>
  /data-slot="progress-words"[^>]*>([^<]*)</u.exec(html)?.[1]?.replaceAll("&#x27;", "'") ?? null;
/** How far its bar reaches, in percent. */
const reached = (html: string) => Number(/aria-valuenow="(\d+)"/u.exec(html)?.[1]);

describe("HqGateScreen", () => {
  it("explains HQ creation and waits for an administrator to choose Set up HQ", () => {
    const html = screen({});
    expect(html).toContain("Set up HQ");
    expect(html).toContain("a project named Headquarters in Zerops");
    expect(row(html)).toBeNull();
    expect(html).not.toContain("Setting up HQ");
  });
  it("shows an owner HQ being set up, step by step, with the one it is on", () => {
    const html = screen({ birth: { kind: "running", step: "deploy" } });
    expect(html).toContain("Setting up HQ for Acme");
    // One row says the step it is on; the bar stands past the three steps behind it.
    expect(row(html)).toBe("Deploying HQ");
    expect(html).not.toContain("Creating the Headquarters project");
    expect(html).not.toContain("Giving HQ its address");
    expect(reached(html)).toBeGreaterThanOrEqual(Math.floor((3 / 7) * 100));
    expect(reached(html)).toBeLessThan(Math.ceil((4 / 7) * 100));
    expect(html).not.toContain("<button");
  });

  it("a finished setup says HQ is ready once, and that Mate connects to it", () => {
    const html = screen({ birth: { kind: "running", step: "done" } });
    expect(html).toContain("HQ is ready for Acme");
    expect(html).not.toContain("Setting up HQ");
    expect(html).not.toContain("Keep this tab open");
    expect(html).toContain("Connecting to your new HQ");
    // Said once on the page; the bar's label names it for a screen reader.
    expect(html.replaceAll(/<[^>]*>/gu, " ").split("HQ is ready").length - 1).toBe(1);
    expect(reached(html)).toBe(100);
  });

  it("names the step that stopped it, and offers Try again", () => {
    const html = screen({
      birth: { kind: "failed", step: "deploy", reason: "offline." },
    });
    expect(row(html)).toBe("Deploying HQ stopped. offline.");
    expect(html).toContain("Try again");
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
    expect(html).toContain("Try again");
    expect(html).not.toContain("Start over");
  });

  it("runs the setup's clock from when its record says it began", () => {
    const html = screen({
      birth: { kind: "running", step: "deploy", startedAt: Date.now() - 130_000 },
    });
    expect(html).toMatch(/2:1\d · usually about 5 min/u);
  });

  it("tells anybody else whom to ask, and offers nothing", () => {
    const line = "An admin sets up Mate for this organization. Ask Ada.";
    const html = screen({ gate: { kind: "ask", line } });
    expect(html).toContain(line);
    expect(html).not.toContain("<button");
  });

  it("waits for the member list, and offers reading it again once it failed", () => {
    // The boot's one wait, never a second line naming the organization.
    const reading = screen({ gate: { kind: "reading", failed: false } });
    expect(reading).toContain('data-zerops-surface="hq-gate"');
    expect(reading).not.toContain("Reading Acme");
    const failed = screen({ gate: { kind: "reading", failed: true } });
    expect(failed).toContain("Couldn");
    expect(failed).toContain("Try again");
  });
});
