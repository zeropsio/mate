/**
 * M04 (e2e, 2026-10-03): renaming a project closed its dialog at once, with no pending state and
 * no error: two of five renames had not applied when the watch ended, the door being slow. Unless dismissed, the
 * dialog follows HQ until it answers — closed once HQ takes the name, open with its refusal — and says
 * what a rename does: Mate shows the new name, and its environments in Zerops keep theirs.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsRenameDialog } from "./ZeropsRenameDialog";
import { ZeropsRenameProjectDialog } from "./ZeropsRenameProjectDialog";

type DialogProps = Parameters<typeof ZeropsRenameDialog>[0];

const mock = vi.hoisted(() => ({
  dialog: null as DialogProps | null,
  rename: null as ((group: unknown, name: string) => Promise<ReadonlyArray<unknown>>) | null,
  retry: null as ((renames: ReadonlyArray<unknown>) => Promise<ReadonlyArray<unknown>>) | null,
}));

vi.mock("./ZeropsRenameDialog", () => ({
  ZeropsRenameDialog: (props: DialogProps) => {
    mock.dialog = props;
    return null;
  },
}));

vi.mock("../../zerops/useRenameGroup", () => ({
  useRenameGroup: () => ({ rename: mock.rename, retry: mock.retry }),
}));

const GROUP = { groupId: "app-1", name: "Shop", nameSource: "hq" } as unknown as ZeropsGroup;

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  mock.dialog = null;
  mock.rename = null;
  mock.retry = null;
});

/** The dialog over a rename HQ answers when the test says. */
function mount(group: ZeropsGroup = GROUP) {
  let settle = {
    take: (_failures: ReadonlyArray<unknown> = []) => {},
    refuse: (_cause: unknown) => {},
  };
  const rename = vi.fn(
    () =>
      new Promise<ReadonlyArray<unknown>>((resolve, reject) => {
        settle = { take: (failures = []) => resolve(failures), refuse: reject };
      }),
  );
  mock.rename = rename;
  const retry = vi.fn(async () => [] as ReadonlyArray<unknown>);
  mock.retry = retry;
  const onClose = vi.fn();
  act(() => {
    mounted.push(create(<ZeropsRenameProjectDialog group={group} onClose={onClose} />));
  });
  return {
    rename,
    retry,
    onClose,
    take: (failures: ReadonlyArray<unknown> = []) => settle.take(failures),
    refuse: (cause: unknown) => settle.refuse(cause),
  };
}

describe("ZeropsRenameProjectDialog", () => {
  it.each([
    { name: "starts from the name HQ holds", nameSource: "hq", initialValue: "Shop" },
    // Its id is a handle, not a name: the field does not offer it as one.
    {
      name: "starts empty where the name could not be read",
      nameSource: "unread",
      initialValue: "",
    },
  ])("$name, and renames", ({ nameSource, initialValue }) => {
    mount({ ...GROUP, nameSource } as ZeropsGroup);
    expect(mock.dialog).toMatchObject({ initialValue, title: "Rename the project" });
  });

  it("says Mate shows the new name, and its projects in Zerops are renamed to match", () => {
    mount();
    expect(mock.dialog?.description).toBe(
      "Mate shows the new name, and its projects in Zerops are renamed to match.",
    );
  });

  it("follows the rename until HQ answers when not dismissed", async () => {
    const press = mount();
    act(() => {
      mock.dialog!.onSubmit("Harbor");
    });
    expect(press.rename).toHaveBeenCalledWith(GROUP, "Harbor");
    expect(mock.dialog).toMatchObject({ pending: true, error: null });
    expect(press.onClose).not.toHaveBeenCalled();

    await act(async () => {
      press.take();
    });
    expect(press.onClose).toHaveBeenCalledTimes(1);
  });

  it("says HQ's refusal in the dialog, which stays open for another try", async () => {
    const press = mount();
    act(() => {
      mock.dialog!.onSubmit("Harbor");
    });
    await act(async () => {
      press.refuse(new Error("HQ did not answer."));
    });
    expect(mock.dialog).toMatchObject({ pending: false, error: "HQ did not answer." });
    expect(press.onClose).not.toHaveBeenCalled();
  });

  it("says which projects Zerops did not rename, and retries those with the targets planned", async () => {
    const press = mount();
    const refused = { projectId: "p2", from: "Shop - stage", to: "Harbor - stage" };
    act(() => {
      mock.dialog!.onSubmit("Harbor");
    });
    await act(async () => {
      press.take([{ rename: refused, reason: "No access." }]);
    });
    expect(press.onClose).not.toHaveBeenCalled();
    expect(mock.dialog).toMatchObject({
      pending: false,
      submitLabel: "Retry",
      readOnly: true,
      error:
        "Shop - stage was not renamed to Harbor - stage in Zerops: No access. Still named Shop - stage in Zerops.",
    });

    await act(async () => {
      mock.dialog!.onSubmit("Harbor");
    });
    expect(press.retry).toHaveBeenCalledWith([refused]);
    expect(press.rename).toHaveBeenCalledTimes(1);
    expect(press.onClose).toHaveBeenCalledTimes(1);
  });
});
