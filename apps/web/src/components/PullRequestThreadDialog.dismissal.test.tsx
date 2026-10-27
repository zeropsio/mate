// @vitest-environment happy-dom
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";

vi.mock("~/lib/sourceControlActions", () => ({
  readCachedPullRequestResolution: () => null,
  usePullRequestResolution: () => ({ data: null, isPending: false, isFetching: false }),
  usePreparePullRequestThreadAction: () => ({ isPending: true, error: null }),
}));
vi.mock("@tanstack/react-pacer", async (original) => ({
  ...(await original<typeof import("@tanstack/react-pacer")>()),
  useDebouncedValue: (value: string) => [value, { state: { isPending: false } }],
}));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));

function Owner({ revision }: { revision: number }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open {revision}</button>
      <PullRequestThreadDialog
        open={open}
        environmentId={EnvironmentId.make("rig")}
        threadId={ThreadId.make("rig-thread")}
        cwd="/rig"
        initialReference="#123"
        onOpenChange={setOpen}
        onPrepared={() => {}}
      />
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

describe("preparing a pull request thread", () => {
  it.each(["X", "Escape", "outside"])(
    "accepts %s while pending and remains closed after a render",
    async (method) => {
      await act(() => root.render(<Owner revision={1} />));
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(dialog).not.toBeNull();
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
