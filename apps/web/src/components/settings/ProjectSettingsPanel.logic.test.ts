import { describe, expect, it } from "vite-plus/test";

import { projectGroupTitleNeedsUpdate, projectSettingsState } from "./ProjectSettingsPanel.logic";

describe("projectGroupTitleNeedsUpdate", () => {
  it("updates divergent member titles even when the next title is the derived group label", () => {
    expect(
      projectGroupTitleNeedsUpdate(["local-title", "remote-title"], "Repository name", true),
    ).toBe(true);
  });

  it("skips an untouched blur when the derived label differs from member titles", () => {
    expect(projectGroupTitleNeedsUpdate(["repo-slug", "repo-slug"], "Repository Name", false)).toBe(
      false,
    );
  });

  it("skips an update when every member already has the next title", () => {
    expect(projectGroupTitleNeedsUpdate(["Shared name", "Shared name"], "Shared name", true)).toBe(
      false,
    );
  });
});

describe("projectSettingsState: no answer about a project before the projects are read", () => {
  it.each([
    ["the project found", { found: true, read: false, count: 1 }, "detail"],
    ["the projects not read yet, none held", { found: false, read: false, count: 0 }, "reading"],
    ["the projects not read yet, others held", { found: false, read: false, count: 2 }, "reading"],
    ["the projects read, none at all", { found: false, read: true, count: 0 }, "no-projects"],
    ["the projects read, this one not among them", { found: false, read: true, count: 2 }, "gone"],
  ] as const)("%s", (_case, input, state) => {
    expect(projectSettingsState(input)).toBe(state);
  });
});
