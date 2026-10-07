// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ZeropsAssignMateDialog } from "./ZeropsAssignMateDialog";
import { ZeropsChangeFaceDialog } from "./ZeropsChangeFaceDialog";
import { ZeropsDeleteMateDialog } from "./ZeropsDeleteMateDialog";
import { deleteMateWords } from "./ZeropsDeleteMateDialog.logic";
import { ZeropsRestartMateDialog } from "./ZeropsRestartMateDialog";
import { ZeropsMoveToGroupDialog } from "./ZeropsMoveToGroupDialog";

import { ZeropsDeleteProjectDialog } from "./ZeropsDeleteProjectDialog";
import { ZeropsRenameProjectDialog } from "./ZeropsRenameProjectDialog";

const writes = vi.hoisted(() => ({ remove: vi.fn(), rename: vi.fn() }));
vi.mock("../../zerops/useDeleteGroup", () => ({ useDeleteGroup: () => writes.remove }));
vi.mock("../../zerops/useRenameGroup", () => ({
  useRenameGroup: () => ({ rename: writes.rename, retry: writes.rename }),
}));
const group = {
  groupId: "rig-group",
  name: "Dialog rig",
  nameSource: "hq",
  environments: [],
  pending: [],
  production: undefined,
} as const;

const noop = () => {};
const families: ReadonlyArray<{
  name: string;
  draw: (open: boolean, change: (open: boolean) => void) => ReactNode;
  start?: () => Promise<void>;
}> = [
  {
    name: "hand-over",
    draw: (_open, change) => (
      <ZeropsAssignMateDialog
        candidates={[]}
        error={null}
        onCancel={() => change(false)}
        onOpenChange={change}
        onSubmit={noop}
        pending
        projectName="Dialog rig"
      />
    ),
  },
  {
    name: "face",
    draw: (open, change) => (
      <ZeropsChangeFaceDialog
        error={null}
        face={{ tint: "sky", shape: "seal" }}
        name="Dialog"
        onCancel={() => change(false)}
        onOpenChange={change}
        onSave={noop}
        open={open}
        pending
      />
    ),
  },
  {
    name: "delete Mate",
    draw: (open, change) => (
      <ZeropsDeleteMateDialog
        error={null}
        name="Dialog"
        onCancel={() => change(false)}
        onConfirm={noop}
        onOpenChange={change}
        open={open}
        pending
        words={deleteMateWords({
          name: "Dialog",
          environment: "rig",
          services: 1,
          owner: undefined,
        })}
      />
    ),
  },
  {
    name: "restart",
    draw: (_open, change) => (
      <ZeropsRestartMateDialog
        body="Restart the rig."
        error={null}
        name="Dialog"
        onCancel={() => change(false)}
        onConfirm={noop}
        pending
      />
    ),
  },
  {
    name: "move",
    draw: (open, change) => (
      <ZeropsMoveToGroupDialog
        choices={{ apps: [], newApp: [], none: true }}
        currentGroupId={undefined}
        currentRole={undefined}
        name="Dialog"
        onCancel={() => change(false)}
        onOpenChange={change}
        onSubmit={noop}
        open={open}
        pending
      />
    ),
  },
  {
    name: "delete project",
    draw: (_open, change) => (
      <ZeropsDeleteProjectDialog
        group={group}
        contents={{ empty: true, deletingProjectIds: [] }}
        onClose={() => change(false)}
      />
    ),
    start: startWrite,
  },
  {
    name: "rename project",
    draw: (_open, change) => (
      <ZeropsRenameProjectDialog group={group} onClose={() => change(false)} />
    ),
    start: startWrite,
  },
];

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writes.remove.mockReset().mockImplementation(() => new Promise(() => {}));
  writes.rename.mockReset().mockImplementation(() => new Promise(() => {}));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function Owner({
  draw,
  revision,
}: {
  draw: (open: boolean, change: (open: boolean) => void) => ReactNode;
  revision: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open {revision}</button>
      {open ? draw(open, setOpen) : null}
    </>
  );
}

async function startWrite() {
  await act(() =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
}

describe.each(families)("$name while its accepted operation is pending", ({ draw, start }) => {
  it.each(["X", "Escape", "outside"])(
    "closes with %s and new facts do not reopen it",
    async (method) => {
      await act(() => root.render(<Owner draw={draw} revision={1} />));
      await start?.();
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
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
      expect(document.querySelector('[role="dialog"]') === null).toBe(true);
      await act(() => root.render(<Owner draw={draw} revision={2} />));
      expect(document.querySelector('[role="dialog"]') === null).toBe(true);
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );
});

describe.each(families.filter(({ start }) => start !== undefined))(
  "$name after dismissal",
  ({ draw, start, name }) => {
    it("cannot close a new opening when its former operation finishes", async () => {
      let finish!: (value: unknown) => void;
      const write = name === "delete project" ? writes.remove : writes.rename;
      write.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await act(() => root.render(<Owner draw={draw} revision={1} />));
      await start!();
      await act(() =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click(),
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await act(() => document.querySelector<HTMLButtonElement>("button")!.click());
      await act(() => finish([]));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });
  },
);
