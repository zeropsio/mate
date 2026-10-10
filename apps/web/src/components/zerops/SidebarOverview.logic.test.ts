import { describe, expect, it } from "vite-plus/test";

import {
  overviewHeadline,
  overviewKeyPressed,
  overviewProjectOf,
  type OverviewProject,
} from "./SidebarOverview.logic";

const project = (name: string, standing: Partial<OverviewProject> = {}): OverviewProject => ({
  name,
  attention: false,
  releasing: false,
  ...standing,
});

describe("overviewHeadline — the Overview row's second line", () => {
  it.each([
    {
      title: "names the first project that needs attention, and how many more do",
      projects: [
        project("Tea Shop"),
        project("Ledger API", { attention: true }),
        project("Mobile App", { attention: true }),
      ],
      line: "Ledger API needs attention · 1 more",
    },
    {
      title: "names one project that needs attention alone",
      projects: [project("Tea Shop"), project("Mobile App", { attention: true })],
      line: "Mobile App needs attention",
    },
    {
      title: "puts trouble before a release on its way",
      projects: [project("Tea Shop", { releasing: true }), project("Docs", { attention: true })],
      line: "Docs needs attention",
    },
    {
      title: "says a release on its way while nothing needs attention",
      projects: [project("Tea Shop"), project("Internal Tools", { releasing: true })],
      line: "Releasing Internal Tools…",
    },
    {
      title: "counts the projects while all of them run",
      projects: [project("Tea Shop"), project("Ledger API"), project("Docs")],
      line: "3 projects, all running",
    },
    {
      title: "counts one project in the singular",
      projects: [project("Tea Shop")],
      line: "1 project, all running",
    },
    { title: "says there are none yet", projects: [], line: "No projects yet" },
  ])("$title", ({ projects, line }) => {
    expect(overviewHeadline(projects)).toBe(line);
  });
});

describe("overviewProjectOf — what one project adds to the headline", () => {
  const environment = (
    tier: "stage" | "production",
    tone: "neutral" | "pending" | "good" | "bad",
    serving: "serving" | "stopped" | "down" | "unknown" = "serving",
  ) => ({ tier, tone, serving });

  it.each([
    {
      title: "a production whose deploy failed needs attention",
      environments: [environment("production", "bad")],
      releaseFailed: false,
      attention: true,
    },
    {
      title: "a stage that is down needs attention",
      environments: [environment("stage", "good", "down"), environment("production", "good")],
      releaseFailed: false,
      attention: true,
    },
    {
      title: "a release that failed needs attention, the old one still serving",
      environments: [environment("production", "good")],
      releaseFailed: true,
      attention: true,
    },
    {
      title: "a stopped production is no trouble: somebody stopped it",
      environments: [environment("production", "good", "stopped")],
      releaseFailed: false,
      attention: false,
    },
    {
      title: "running stage and production need nothing",
      environments: [environment("stage", "pending"), environment("production", "good")],
      releaseFailed: false,
      attention: false,
    },
  ])("$title", ({ environments, releaseFailed, attention }) => {
    expect(
      overviewProjectOf({ name: "Tea Shop", environments, releaseFailed, releasing: false }),
    ).toEqual({ name: "Tea Shop", attention, releasing: false });
  });

  it("is releasing while a release is on its way to production", () => {
    expect(
      overviewProjectOf({
        name: "Tea Shop",
        environments: [],
        releaseFailed: false,
        releasing: true,
      }).releasing,
    ).toBe(true);
  });
});

describe("overviewKeyPressed — ⌥0 selects Overview", () => {
  const key = { code: "Digit0", altKey: true, metaKey: false, ctrlKey: false, shiftKey: false };
  it.each([
    { title: "⌥0 selects it", event: { ...key, typing: false }, pressed: true },
    {
      title: "⌥0 typed into a field is the field's",
      event: { ...key, typing: true },
      pressed: false,
    },
    {
      title: "0 alone is a digit",
      event: { ...key, altKey: false, typing: false },
      pressed: false,
    },
    {
      title: "⌘⌥0 is another key",
      event: { ...key, metaKey: true, typing: false },
      pressed: false,
    },
    {
      title: "⌥1 is not Overview",
      event: { ...key, code: "Digit1", typing: false },
      pressed: false,
    },
  ])("$title", ({ event, pressed }) => {
    expect(overviewKeyPressed(event)).toBe(pressed);
  });
});
