import type * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

import { STEP_CELL_CLASS } from "./flowSteps";
import {
  brokenProduction,
  entry,
  FLOW_PROPS,
  MERGING,
  PROD,
  PRODUCTION_STOP,
  RELEASING,
  STAGE,
  STAGE_STOP,
  VERA_COMING,
  WREN,
  type Item,
} from "./flowTestFixtures";
import { ProjectCard } from "./ProjectsView";
import type { ProjectsFlowGroup, ZeropsProjectsFlowProps } from "./ZeropsProjectsFlow";

function card(value: ProjectsFlowGroup<Item>, over: Partial<ZeropsProjectsFlowProps<Item>> = {}) {
  return renderToStaticMarkup(
    <ProjectCard entry={value} props={{ ...FLOW_PROPS, view: "projects", ...over }} />,
  );
}

/** The markup from `start` up to `end`, both markers searched in order. */
function between(html: string, start: string, end: string | undefined): string {
  const from = html.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  if (end === undefined) return html.slice(from);
  const to = html.indexOf(end, from + start.length);
  return html.slice(from, to === -1 ? undefined : to);
}

const STEPS = ["mates", "pull-requests", "main", "production"] as const;

/** One step's cell: from its marker to the next step's. */
function step(html: string, name: string): string {
  const from = html.indexOf(`data-zerops-step-cell="${name}"`);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = html.indexOf("data-zerops-step-cell=", from + 1);
  return html.slice(from, to === -1 ? undefined : to);
}

describe("the Projects card", () => {
  it("names the next step in its header, without the verb", () => {
    const header = between(card(MERGING), "<header", "</header>");
    expect(header).toContain(">Pull request #1 waits for your merge<");
    expect(header).not.toContain("Next:");
    expect(header).not.toContain("data-test-verb");
    expect(header).toContain('data-test-menu="aaa"');
  });

  it.each([
    ["a merge", MERGING, "pull-requests", "merge"],
    ["a release", RELEASING, "production", "release"],
  ] as const)("puts %s's verb in the step it acts on, once", (_name, value, where, kind) => {
    const html = card(value);
    expect(html.split(`data-test-verb="${kind}"`)).toHaveLength(2);
    expect(step(html, where)).toContain(`data-test-verb="${kind}"`);
  });

  it.each([
    ["filled", RELEASING],
    ["empty", entry([WREN], { mainHasCode: false })],
  ] as const)(
    "lays the four steps out as one row of labels over one row of equal cells: %s",
    (_name, value) => {
      const html = card(value);
      const labels = ["Mates", "Pull requests", "main", "Production"].map((label) =>
        html.indexOf(`>${label}</span>`),
      );
      const cells = STEPS.map((name) => html.indexOf(`data-zerops-step-cell="${name}"`));
      expect([...labels, ...cells].every((index) => index >= 0)).toBe(true);
      expect([...cells].sort((left, right) => left - right)).toEqual(cells);
      expect(html).toContain("@5xl/flow:grid-rows-[auto_1fr]");
      for (const name of STEPS) {
        // One surface per step, empty or not, stretched to its row: never a
        // cell painted over another, never a dashed place.
        const cell = step(html, name);
        expect(cell.split(`class="${STEP_CELL_CLASS}`)).toHaveLength(2);
        expect(cell).toContain(`data-zerops-step="${name}"`);
        expect(cell).not.toContain("border-dashed");
      }
    },
  );

  it("draws each Mate as a row that carries its Preview on its first line", () => {
    const withPreview = entry([WREN], {
      mates: [
        {
          projectId: "wren-dev",
          name: "Wren",
          preview: "https://wren.example/",
          waiting: false,
          talked: true,
        },
      ],
    });
    const mates = step(card(withPreview), "mates");
    expect(mates).toContain(
      'data-test-mate="wren-dev" data-test-layout="row" data-test-preview="https://wren.example/"',
    );
    // The row draws it on its own line 1: never a second link under the Mate.
    expect(mates).not.toContain('data-zerops-surface="mate-preview"');
  });

  it("merges once: the step's verb, not a second Merge on the row it names", () => {
    expect(step(card(MERGING), "pull-requests")).toContain(
      'data-test-compact="true" data-test-pull="1" data-test-with-merge="false"',
    );
  });

  it("gives the stage its own menu and production its own", () => {
    const html = card(entry([WREN, STAGE, PROD], { stops: [STAGE_STOP, PRODUCTION_STOP] }));
    expect(step(html, "main")).toContain('data-test-stop-menu="fixture-stage"');
    expect(step(html, "production")).toContain('data-test-stop-menu="fixture-prod"');
  });

  it("says an empty step's word in the muted hand", () => {
    const html = card(entry([WREN], { mainHasCode: false }));
    expect(step(html, "pull-requests")).toContain("None yet");
    expect(step(html, "pull-requests")).toContain('data-zerops-empty-step="true"');
    expect(step(html, "main")).toContain('data-zerops-empty-step="true"');
    expect(step(html, "production")).toContain('data-zerops-empty-step="true"');
  });

  it.each([
    ["offered once the group is ready", { onCreateEnvironment: () => {} }, "enabled"],
    [
      "disabled while a creation runs",
      { onCreateEnvironment: () => {}, creating: true },
      "disabled",
    ],
    [
      "held while the group is not ready",
      { onCreateEnvironment: () => {}, addsOffered: () => false },
      "absent",
    ],
    ["absent where nothing can create", {}, "absent"],
  ] as const)("draws Add Mate as a + beside the Mates label: %s", (_name, over, expected) => {
    const html = card(RELEASING, over);
    // The Mates label's line: from the label up to its cell.
    const label = between(html, ">Mates</span>", 'data-zerops-step-cell="mates"');
    const plus = /<button[^>]*aria-label="Add a Mate to sm-fixture"[^>]*>/u.exec(label)?.[0];
    if (expected === "absent") {
      expect(html).not.toContain("Add a Mate to");
      return;
    }
    expect(plus).toBeDefined();
    expect(plus!.includes(` disabled=""`)).toBe(expected === "disabled");
  });

  it("keeps Add stage and Add production in the group menu: no footer links", () => {
    const html = card(RELEASING, { onCreateEnvironment: () => {} });
    expect(html).not.toContain('data-zerops-surface="add-roles"');
    expect(html).not.toContain("Add stage");
    expect(html).not.toContain("(optional)");
    expect(html).not.toContain("Add production");
  });

  it("still offers the release beside a broken production, after the fix (D28)", () => {
    const production = step(card(brokenProduction()), "production");
    const fix = production.indexOf('data-test-verb="fix-deploy"');
    expect(fix).toBeGreaterThanOrEqual(0);
    expect(production.indexOf('data-test-release-verb="true"')).toBeGreaterThan(fix);
  });

  it("puts what a release carries, and the group's other environments, under the steps, full width", () => {
    const value = { ...RELEASING, others: [{ item: STAGE, role: "stage" as const }] };
    const html = card(value, { renderGroupRows: () => <li data-test-release="v0.0.9" /> });
    const steps = between(
      html,
      'data-zerops-step="mates"',
      'data-zerops-surface="environment-rows"',
    );
    expect(steps).not.toContain("data-test-environment");
    expect(steps).not.toContain("data-test-release");
    const bottom = between(html, 'data-zerops-surface="environment-rows"', undefined);
    expect(bottom.indexOf('data-test-environment="fixture-stage"')).toBeLessThan(
      bottom.indexOf('data-test-release="v0.0.9"'),
    );
  });

  it("draws no bottom section where there is nothing under the steps", () => {
    expect(card(RELEASING)).not.toContain('data-zerops-surface="environment-rows"');
  });

  it("holds an unread group's pull requests, main and production as pending, claiming nothing", () => {
    const html = card(entry([WREN], {}, false));
    for (const name of ["pull-requests", "main", "production"]) {
      const cell = step(html, name);
      expect(cell).toContain('data-zerops-step-pending="true"');
      expect(cell).toContain('data-slot="skeleton"');
      expect(cell).toContain(STEP_CELL_CLASS);
    }
    expect(step(html, "mates")).not.toContain("data-zerops-step-pending");
    for (const word of ["None yet", "Nothing merged", "Not set up", "After the first merge"])
      expect(html).not.toContain(word);
  });

  it("is a flat card the page can scroll to", () => {
    const html = card(MERGING);
    const open = html.slice(0, html.indexOf(">"));
    expect(open).toContain('data-zerops-primitive="flat-card"');
    expect(open).toContain('id="project-aaa"');
    expect(open).toContain('data-zerops-group="aaa"');
    expect(open).toContain("scroll-mt-4");
    expect(open).not.toContain("border-border/60");
  });

  it("draws a Mate being created under the listed ones: asleep, named, how far it has got, still", () => {
    const mates = step(card(entry([WREN], { pending: [VERA_COMING] })), "mates");
    expect(mates).toContain('data-test-mate="wren-dev"');
    const coming = mates.slice(
      mates.lastIndexOf("<div", mates.indexOf('data-zerops-mate-card="still"')),
    );
    expect(mates.indexOf('data-test-mate="wren-dev"')).toBeLessThan(
      mates.indexOf('data-zerops-mate-card="still"'),
    );
    expect(coming).toContain('aria-busy="true"');
    expect(coming).toContain(">Vera<");
    expect(coming).toContain(">Coming up. A few minutes.<");
    expect(coming).not.toContain("<button");
    expect(mates).not.toContain("No Mate yet");
  });

  it("reads a production being created as setting up, with no menu and no Add production", () => {
    const html = card(
      entry([WREN], {
        mainHasCode: true,
        productionAddable: true,
        missing: [{ tier: "production" }],
        pending: [
          { ...VERA_COMING, projectId: "prod-new", kind: "production", name: "production" },
        ],
      }),
    );
    const production = step(html, "production");
    expect(production).toContain(">Setting up production…<");
    expect(production).toContain('data-zerops-status-tone="busy"');
    expect(production).not.toContain("data-test-stop-menu");
    expect(html).not.toContain('data-test-verb="add-production"');
  });

  it("counts a Mate being created in its header", () => {
    const header = between(card(entry([WREN], { pending: [VERA_COMING] })), "<header", "</header>");
    expect(header).toContain("2 Mates");
  });
});
