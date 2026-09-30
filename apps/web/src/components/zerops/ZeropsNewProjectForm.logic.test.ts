import { describe, expect, it } from "vite-plus/test";

import { newProjectButton } from "./ZeropsNewProjectForm.logic";

// Board D1, 2026-09-30: the button names what it makes, as Add a Mate's names its Mate and project.
describe("newProjectButton — what Create makes, by name", () => {
  it.each([
    { projectName: "Acme Shop", botName: "Vera", says: "Create Acme Shop with Vera" },
    { projectName: "  Acme   Shop ", botName: " Vera ", says: "Create Acme Shop with Vera" },
    { projectName: "", botName: "Vera", says: "Create a project with Vera" },
    { projectName: "Acme Shop", botName: "  ", says: "Create Acme Shop" },
    { projectName: " ", botName: "", says: "Create a project" },
  ])("'$projectName' with '$botName': $says", ({ projectName, botName, says }) => {
    expect(newProjectButton({ projectName, botName })).toBe(says);
  });
});
