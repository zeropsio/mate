// @vitest-environment happy-dom
import type { ProjectScript } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import ProjectScriptsControl from "./ProjectScriptsControl";

const PRIMARY_SCRIPT: ProjectScript = {
  id: "dev",
  name: "Dev",
  command: "vp dev",
  icon: "play",
  runOnWorktreeCreate: false,
};
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
async function renderControl(scripts: ReadonlyArray<ProjectScript>) {
  const onRunScript = vi.fn();
  await act(() =>
    root.render(
      <ProjectScriptsControl
        scripts={scripts}
        keybindings={[]}
        onRunScript={onRunScript}
        onAddScript={vi.fn()}
        onUpdateScript={vi.fn()}
        onDeleteScript={vi.fn()}
      />,
    ),
  );
  return onRunScript;
}
describe("ProjectScriptsControl", () => {
  it("runs the named primary action when pressed", async () => {
    const onRunScript = await renderControl([PRIMARY_SCRIPT]);
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Run Dev"]');
    expect(button).not.toBeNull();
    await act(() => button!.click());
    expect(onRunScript).toHaveBeenCalledWith({
      id: "dev",
      name: "Dev",
      command: "vp dev",
      icon: "play",
      runOnWorktreeCreate: false,
    });
  });
  it("opens the action editor from Add action", async () => {
    await renderControl([]);
    const button = document.querySelector<HTMLButtonElement>('button[aria-label="Add action"]');
    expect(button).not.toBeNull();
    await act(() => button!.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Add Action");
    expect(dialog?.querySelector("input")).not.toBeNull();
  });
});
