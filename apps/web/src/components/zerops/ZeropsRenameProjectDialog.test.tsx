/**
 * M04 (e2e, 2026-10-03): renaming a project closed its dialog at once, with no pending state and
 * no error: two of five renames had not applied when the watch ended, the door being slow. The
 * dialog stays until HQ answers — closed once HQ takes the name, open with its refusal — and says
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
  rename: null as ((group: unknown, name: string) => Promise<void>) | null,
}));

vi.mock("./ZeropsRenameDialog", () => ({
  ZeropsRenameDialog: (props: DialogProps) => {
    mock.dialog = props;
    return null;
  },
}));

vi.mock("../../zerops/useRenameGroup", () => ({
  useRenameGroup: () => mock.rename,
}));

const GROUP = { groupId: "app-1", name: "Shop", nameSource: "hq" } as unknown as ZeropsGroup;

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  mock.dialog = null;
  mock.rename = null;
});

/** The dialog over a rename HQ answers when the test says. */
function mount(group: ZeropsGroup = GROUP) {
  let settle = { take: () => {}, refuse: (_cause: unknown) => {} };
  const rename = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { take: resolve, refuse: reject };
      }),
  );
  mock.rename = rename;
  const onClose = vi.fn();
  act(() => {
    mounted.push(create(<ZeropsRenameProjectDialog group={group} onClose={onClose} />));
  });
  return {
    rename,
    onClose,
    take: () => settle.take(),
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

  it("says Mate shows the new name, and its environments in Zerops keep theirs", () => {
    mount();
    expect(mock.dialog?.description).toBe(
      "Mate shows the new name. Its environments in Zerops keep the names they have.",
    );
  });

  it("stays open and pending until HQ answers, then closes", async () => {
    const press = mount();
    act(() => {
      mock.dialog!.onSubmit("Harbor");
    });
    expect(press.rename).toHaveBeenCalledWith(GROUP, "Harbor");
    expect(mock.dialog).toMatchObject({ pending: true, error: null });
    // Nothing closes it while HQ is answering: its refusal has somewhere to land.
    act(() => {
      mock.dialog!.onOpenChange(false);
    });
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
});
