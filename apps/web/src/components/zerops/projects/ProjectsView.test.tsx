import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { STEP_CELL_CLASS } from "./flowSteps";
import {
  brokenProduction,
  entry,
  FLOW_PROPS,
  MERGING,
  RELEASING,
  STAGE,
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

  it("is a flat card the page can scroll to", () => {
    const html = card(MERGING);
    const open = html.slice(0, html.indexOf(">"));
    expect(open).toContain('data-zerops-primitive="flat-card"');
    expect(open).toContain('id="project-aaa"');
    expect(open).toContain('data-zerops-group="aaa"');
    expect(open).toContain("scroll-mt-4");
    expect(open).not.toContain("border-border/60");
  });
});
