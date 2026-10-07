// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsAgentSignInDialog } from "./useZeropsAgentSignInDialog";

vi.mock("./useZeropsMates", () => ({ useZeropsMateDirectory: () => new Map() }));
vi.mock("./useZeropsFeeds", () => ({ useZeropsAgentAuth: () => undefined }));
vi.mock("~/state/environments", () => ({ useEnvironment: () => undefined }));
vi.mock("./useZeropsEnvironmentProject", () => ({ useZeropsEnvironmentProject: () => undefined }));
vi.mock("./useUsualAgent", () => ({ useUsualAgent: () => ({ usual: null, settled: true }) }));
vi.mock("./ZeropsSessionProvider", () => ({ useZeropsSessionOptional: () => null }));
vi.mock("./useZeropsMateOwners", () => ({ useHqPersonNames: () => () => undefined }));
vi.mock("./useAgentLogin", () => ({ useAgentLogin: () => () => {} }));
vi.mock("./useAgentLoginCancel", () => ({ useAgentLoginCancel: () => () => {} }));
vi.mock("./useAgentLoginSubmitCode", () => ({ useAgentLoginSubmitCode: () => () => {} }));

function Owner({ revision }: { revision: number }) {
  const { openFor, dialog } = useZeropsAgentSignInDialog(null, null);
  return (
    <>
      <button onClick={() => openFor("codex")}>Sign in {revision}</button>
      {dialog}
    </>
  );
}

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

describe("the sign-in owned by the chat, picker and crew", () => {
  it.each(["X", "Escape", "outside"])(
    "closes with %s and another render does not reopen it",
    async (method) => {
      await act(() => root.render(<Owner revision={1} />));
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Sign in a coding agent");
      await act(() => {
        if (method === "X")
          document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
        else if (method === "Escape")
          dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        else {
          const outside = document.querySelector('[data-slot="dialog-viewport"]')!;
          for (const type of ["mousedown", "mouseup", "click"])
            outside.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 }));
        }
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => root.render(<Owner revision={2} />));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );
});
