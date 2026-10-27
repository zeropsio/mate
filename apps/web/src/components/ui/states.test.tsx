// @vitest-environment happy-dom
/**
 * The kit's state patterns, by what a person sees: a stand-in while something loads, one line
 * where nothing is yet, one row for a long operation, a failure that names its cause and its fix.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { EmptyState } from "./empty";
import { Failure } from "./failure";
import { Loading } from "./loading";
import { Progress } from "./progress";
import { StatusPage } from "./status-page";

let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(node: ReactNode) {
  root ??= createRoot(host);
  await act(() => root?.render(node));
}

const words = () => host.querySelector("[data-slot=progress-words]")?.textContent ?? "";
const time = () => host.querySelector("[data-slot=progress-time]")?.textContent ?? null;
const bar = () => Number(host.querySelector("[role=progressbar]")?.getAttribute("aria-valuenow"));

const STEPS = ["Creating HQ's project", "Starting HQ's services", "Deploying HQ"];
const MIN = 60_000;

describe("Progress", () => {
  it("A long operation's row says one step at a time and never takes a step back", async () => {
    await render(<Progress at={0} label="Setting up HQ" nowMs={0} startedAtMs={0} steps={STEPS} />);
    expect(words()).toBe("Creating HQ's project");
    expect(host.textContent).not.toContain("Starting HQ's services");

    await render(
      <Progress at={2} label="Setting up HQ" nowMs={MIN} startedAtMs={0} steps={STEPS} />,
    );
    expect(words()).toBe("Deploying HQ");
    expect(host.textContent).not.toContain("Creating HQ's project");
    const reached = bar();

    // An input that lags behind (a stale read) names an earlier step: the row stays where it was.
    await render(
      <Progress at={1} label="Setting up HQ" nowMs={MIN + 1000} startedAtMs={0} steps={STEPS} />,
    );
    expect(words()).toBe("Deploying HQ");
    expect(bar()).toBeGreaterThanOrEqual(reached);
  });

  it("A long operation's row says how long it has run and, past its estimate, that it is taking longer than usual", async () => {
    await render(
      <Progress
        at={0}
        estimateMs={5 * MIN}
        label="Setting up HQ"
        nowMs={80_000}
        startedAtMs={0}
        steps={STEPS}
      />,
    );
    expect(time()).toBe("1:20 · usually about 5 min");

    await render(
      <Progress
        at={0}
        estimateMs={5 * MIN}
        label="Setting up HQ"
        nowMs={6 * MIN + 10_000}
        startedAtMs={0}
        steps={STEPS}
      />,
    );
    expect(time()).toBe("6:10 · Taking longer than usual");
  });

  it("A finished operation's row becomes its result line, with where to go next", async () => {
    await render(
      <Progress
        at={2}
        label="Setting up HQ"
        steps={STEPS}
        view={{ state: "done", result: "HQ is ready", action: <button type="button">Open</button> }}
      />,
    );
    expect(words()).toBe("HQ is ready");
    expect(bar()).toBe(100);
    expect(host.querySelector("button")?.textContent).toBe("Open");
  });

  it("A stopped operation's row says why and offers the one action that fixes it, its clock stopped", async () => {
    await render(
      <Progress
        at={1}
        endedAtMs={35_000}
        estimateMs={2 * MIN}
        label="Setting up HQ"
        nowMs={9 * MIN}
        startedAtMs={0}
        steps={STEPS}
        view={{
          state: "failed",
          cause: "Your organization needs credit for a second project.",
          action: <button type="button">Add credit</button>,
          details: "projectLimitReached",
        }}
      />,
    );
    expect(host.querySelector("[role=alert]")?.textContent).toBe(
      "Your organization needs credit for a second project.",
    );
    expect(time()).toBe("0:35");
    expect(host.querySelectorAll("button")[0]?.textContent).toBe("Add credit");
    // The source's words are there, folded.
    const details = host.querySelector("[data-slot=collapsible-trigger]");
    expect(details?.textContent).toBe("Details");
    expect(details?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Failure", () => {
  it("A failure names its cause in words and the one action that fixes it, the source's words folded under Details", async () => {
    await render(
      <Failure
        action={<button type="button">Read again</button>}
        cause="Couldn't read the project's people."
        details="HQ answered 502."
      />,
    );
    expect(host.querySelector("[role=alert]")?.textContent).toContain(
      "Couldn't read the project's people.",
    );
    expect(host.querySelectorAll("button")).toHaveLength(2);
    expect(
      host.querySelector("[data-slot=collapsible-trigger]")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("A failed page names its cause as its title and offers the fix", async () => {
    await render(
      <Failure
        action={<button type="button">Try again</button>}
        cause="We stopped waiting for Zerops"
        size="page"
      >
        If you created your account, sign in to continue. Nothing was lost.
      </Failure>,
    );
    expect(host.querySelector("h1")?.textContent).toBe("We stopped waiting for Zerops");
    expect(host.querySelector("[data-slot=collapsible-trigger]")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Try again");
  });
});

describe("Loading", () => {
  it("A stand-in names what is on its way for assistive technology and puts no words on the page", async () => {
    await render(<Loading label="Your projects" shape="cards" count={2} />);
    const status = host.querySelector("[role=status]");
    expect(status?.getAttribute("aria-label")).toBe("Your projects");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(host.textContent).toBe("");
  });
});

describe("EmptyState", () => {
  it("An empty place says one line and offers at most one action", async () => {
    await render(
      <EmptyState action={<button type="button">Add one</button>} size="row">
        No environments yet.
      </EmptyState>,
    );
    expect(host.textContent).toBe("No environments yet.Add one");
    expect(host.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("StatusPage", () => {
  it("A whole page that waits shows its mark, its title and its body in one frame", async () => {
    await render(
      <StatusPage
        actions={<button type="button">Cancel</button>}
        mark={<svg />}
        title="Setting up HQ"
      >
        <p>About 5 minutes.</p>
      </StatusPage>,
    );
    expect(host.querySelector("main h1")?.textContent).toBe("Setting up HQ");
    expect(host.querySelector("[data-slot=status-page-mark] svg")).not.toBeNull();
    expect(host.textContent).toContain("About 5 minutes.");
  });
});
