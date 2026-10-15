import type * as React from "react";
import { act } from "react";
import { ZeropsProjectsFlow } from "./ZeropsProjectsFlow";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async () => {
  const { createElement } = await import("react");
  return {
    Link: ({
      to,
      params = {},
      ...props
    }: React.ComponentProps<"a"> & { to: string; params?: Record<string, string> }) =>
      createElement("a", {
        href: to.replace(/\$(\w+)/gu, (_, key: string) => params[key] ?? ""),
        ...props,
      }),
  };
});

import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";
import { item, MERGING, renderFlow, mount, FLOW_PROPS } from "./flowTestFixtures";

const render = renderFlow;

describe("the containers no project holds", () => {
  const rows = (kinds: ReadonlyArray<ZeropsRowAction["kind"]>) =>
    kinds.map((action, index) => ({ item: item(`loose-${String(index)}`), action }));

  it("fold into one line with their states and a re-probe for the ones not answering", () => {
    const html = render({
      groups: [MERGING],
      ungrouped: rows(["open", "retry-probe", "start", "retry-probe"]),
    });
    const line = html.slice(html.indexOf('data-zerops-surface="other-containers"'));
    expect(line).toContain("Other containers");
    // Only the ones that need the person are named: the ready one is not the overview's.
    expect(line).toContain("Not in a project · 2 not answering · 1 stopped");
    expect(line).toContain("Try again (2)");
    // Folded: the rows themselves wait behind the line.
    expect(line).not.toContain("data-test-mate=");
  });

  it("keeps their summary for a container with room for it, never a cut 'Not in a…'", () => {
    const html = render({ ungrouped: rows(["open", "start"]) });
    const summary = html.slice(
      html.lastIndexOf("<span", html.indexOf("Not in a project")),
      html.indexOf("Not in a project"),
    );
    expect(summary).toContain("hidden");
    expect(summary).toContain("@2xl/flow:block");
  });

  it("offers no re-probe when every container answers", () => {
    expect(render({ ungrouped: rows(["open"]) })).not.toContain("Try again");
  });

  // The organization's inner workings are not the overview's (the owner, 2026-10-11): a container
  // that answers, or a project waiting for a Mate, says nothing there.
  it("names a container outside every project only while it needs the person", () => {
    expect(render({ ungrouped: rows(["open", "set-up-mate"]) })).not.toContain(
      'data-zerops-surface="other-containers"',
    );
  });
});

describe("HQ's card", () => {
  it("waits for an account that has started", () => {
    expect(render({ onCreateProject: () => {} })).not.toContain('data-test-hq-card="true"');
  });
});

describe("first run", () => {
  it("says what a Mate is, and offers one, to an account with no project", () => {
    const html = render({ onCreateProject: () => {} });
    expect(html).toContain('data-zerops-surface="first-run"');
    expect(html).toContain("Start a project");
    expect(html).toContain('data-mate-face-size="64"');
    expect(html).toContain('data-zerops-primitive="pill"');
  });

  it("drops the invitation once the account has a project", () => {
    expect(render({ groups: [MERGING], onCreateProject: () => {} })).not.toContain(
      'data-zerops-surface="first-run"',
    );
  });

  it("gives nothing to a view with no way to create", () => {
    expect(render()).not.toContain('data-zerops-surface="first-run"');
  });

  it("tells a member given nothing yet that nothing is shared, and offers no New project", () => {
    const html = render({ noProjectYet: true, reachesEveryProject: false });
    expect(html).toContain('data-zerops-surface="first-run"');
    expect(html).toContain("Nothing is shared with you yet");
    expect(html).not.toContain("Start a project");
    expect(html).not.toContain('data-zerops-primitive="pill"');
  });

  it("tells a Developer given nothing yet that shared projects appear here, beside New project", () => {
    const html = render({
      noProjectYet: true,
      reachesEveryProject: false,
      onCreateProject: () => {},
    });
    expect(html).toContain("Start a project");
    expect(html).toContain("Projects your team gives you access to appear here");
    expect(html).toContain('data-zerops-primitive="pill"');
  });
});

it("does not declare a first run before HQ placement is read", () => {
  const html = render({
    onCreateProject: () => {},
    placementNotice: "Placement not read — HQ is unavailable",
  });
  expect(html).not.toContain("Start a project");
  expect(html).toContain("Placement not read — HQ is unavailable");
});

// A reload paints nothing it takes back: placement on its way says nothing for the beat it takes,
// and neither the first run nor HQ's line stands in for it.
it("says nothing while HQ placement is only on its way", () => {
  const html = render({
    onCreateProject: () => {},
    placementNotice: "Reading HQ placement…",
    placementReading: true,
    hqCard: <p data-zerops-surface="hq-card">HQ</p>,
  });
  expect(html).not.toContain("Reading HQ placement…");
  expect(html).not.toContain("Start a project");
  expect(html).not.toContain('data-zerops-surface="hq-card"');
});

// Containers no project holds stand behind the overview unless they need the person: an overview
// with nothing else to draw still says why it is empty.
it("says why it is empty though containers no project holds stand behind it", () => {
  const html = render({
    ungrouped: [{ item: item("loose"), action: "open" }],
    placementNotice: "Placement not read — HQ is unavailable",
  });
  expect(html).toContain("Placement not read — HQ is unavailable");
  expect(html).not.toContain('data-zerops-surface="other-containers"');
});

it("cold HQ placement stays unknown on Projects until owner evidence arrives", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  const unknown = {
    ...FLOW_PROPS,
    placementReading: true,
    placementNotice: "Reading HQ placement…",
  };
  const tree = mount(<ZeropsProjectsFlow {...unknown} />);
  const words = () => JSON.stringify(tree.toJSON());
  try {
    expect(words()).not.toContain("Not in a project");
    expect(words()).not.toContain("Other containers");
    act(() => vi.advanceTimersByTime(1_000));
    expect(words()).toContain("Reading HQ placement…");
    expect(words()).not.toContain("Not in a project");
    expect(words()).not.toContain("Other containers");
    // A later owner delivery replaces the unknown state with the actual placement.
    act(() => tree.update(<ZeropsProjectsFlow {...FLOW_PROPS} groups={[MERGING]} />));
    expect(words()).toContain("sm-fixture");
    expect(words()).not.toContain("Reading HQ placement…");
  } finally {
    act(() => tree.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
