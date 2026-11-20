import { describe, expect, it } from "vite-plus/test";

import { projectSettingsState } from "./ProjectSettingsPanel.logic";

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
