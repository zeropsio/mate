/**
 * The dialog that deletes a project holding nothing stays until HQ answers: closed once HQ took
 * it, open with HQ's refusal for another look.
 */
import type { ZeropsGroup } from "@t3tools/client-runtime/zerops";
import { HqError, type HqAppContents } from "@t3tools/client-runtime/zerops/hq";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsDeleteProjectForm } from "./ZeropsDeleteProjectForm";
import { ZeropsDeleteProjectDialog } from "./ZeropsDeleteProjectDialog";

type FormProps = Parameters<typeof ZeropsDeleteProjectForm>[0];

const mock = vi.hoisted(() => ({
  form: null as FormProps | null,
  remove: null as ((group: unknown) => Promise<void>) | null,
}));

vi.mock("./ZeropsDeleteProjectForm", () => ({
  ZeropsDeleteProjectForm: (props: FormProps) => {
    mock.form = props;
    return null;
  },
}));

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: { readonly children: React.ReactNode }) => children,
  DialogPopup: ({ children }: { readonly children: React.ReactNode }) => children,
}));

vi.mock("../../zerops/useDeleteGroup", () => ({
  useDeleteGroup: () => mock.remove,
}));

const GROUP = { groupId: "app-1", name: "mate-rig-e2e-a" } as unknown as ZeropsGroup;

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
  mock.form = null;
  mock.remove = null;
});

/** The dialog over a delete HQ answers when the test says. */
function mount() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let settle = { take: () => {}, refuse: (_cause: unknown) => {} };
  const remove = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settle = { take: resolve, refuse: reject };
      }),
  );
  mock.remove = remove;
  const onClose = vi.fn();
  act(() => {
    mounted.push(
      create(
        <ZeropsDeleteProjectDialog
          group={GROUP}
          onClose={onClose}
          contents={{ empty: true, deletingProjectIds: [] }}
        />,
      ),
    );
  });
  return {
    remove,
    onClose,
    updateContents: (contents: HqAppContents | undefined) =>
      act(() => {
        mounted
          .at(-1)!
          .update(
            <ZeropsDeleteProjectDialog group={GROUP} onClose={onClose} contents={contents} />,
          );
      }),
    take: () => settle.take(),
    refuse: (cause: unknown) => settle.refuse(cause),
  };
}

describe("ZeropsDeleteProjectDialog", () => {
  it.each([
    undefined,
    { empty: false, deletingProjectIds: [] },
    { empty: false, deletingProjectIds: ["zed"] },
  ])("stops confirmation when HQ's contents change while open: %j", (contents) => {
    const press = mount();
    press.updateContents(contents);
    expect(mock.form?.contents).toEqual(contents);
    act(() => mock.form!.onConfirm());
    expect(press.remove).not.toHaveBeenCalled();
    expect(press.onClose).not.toHaveBeenCalled();
  });

  it("asks about the project by its name", () => {
    mount();
    expect(mock.form).toMatchObject({ name: "mate-rig-e2e-a", pending: false, error: null });
  });

  it("stays open and pending until HQ answers, then closes", async () => {
    const press = mount();
    act(() => {
      mock.form!.onConfirm();
    });
    expect(press.remove).toHaveBeenCalledWith(GROUP);
    expect(mock.form).toMatchObject({ pending: true });
    expect(press.onClose).not.toHaveBeenCalled();
    await act(async () => {
      press.take();
    });
    expect(press.onClose).toHaveBeenCalledOnce();
  });

  it("keeps HQ's refusal in the dialog", async () => {
    const press = mount();
    act(() => {
      mock.form!.onConfirm();
    });
    await act(async () => {
      press.refuse(
        new HqError({
          kind: "refused",
          code: "conflict",
          status: 409,
          message:
            "This project is no longer empty: a Mate, an environment or a change is in it now.",
        }),
      );
    });
    expect(mock.form).toMatchObject({
      pending: false,
      error: "This project is no longer empty: a Mate, an environment or a change is in it now.",
    });
    expect(press.onClose).not.toHaveBeenCalled();
  });
});
