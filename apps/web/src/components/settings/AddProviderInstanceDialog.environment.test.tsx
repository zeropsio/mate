import { EnvironmentId } from "@t3tools/contracts";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { DialogFooter, DialogHeader, DialogPanel, DialogPopup } from "../ui/dialog";

const settingsHooks = vi.hoisted(() => ({
  read: vi.fn(() => ({ providerInstances: {} })),
  update: vi.fn(() => vi.fn()),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useMemo: reactHookHarness.useMemo,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: settingsHooks.read,
  useUpdateEnvironmentSettings: settingsHooks.update,
}));

import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";

const remoteEnvironmentId = EnvironmentId.make("remote-device");

function elementChildren(element: ReactElement): ReactElement[] {
  return Children.toArray((element.props as { children?: ReactNode }).children).filter(
    isValidElement,
  );
}

describe("AddProviderInstanceDialog", () => {
  beforeEach(() => {
    hooks.reset();
    settingsHooks.read.mockClear();
    settingsHooks.update.mockClear();
  });

  it("reads and writes settings through the supplied environment", () => {
    hooks.beginRender();
    AddProviderInstanceDialog({
      open: true,
      environmentId: remoteEnvironmentId,
      environmentLabel: "Remote device",
      onOpenChange: vi.fn(),
    });

    expect(settingsHooks.read).toHaveBeenCalledWith(remoteEnvironmentId);
    expect(settingsHooks.update).toHaveBeenCalledWith(remoteEnvironmentId);
  });

  it("keeps the header and actions outside the shared scrollable panel", () => {
    hooks.beginRender();
    const dialog = AddProviderInstanceDialog({
      open: true,
      environmentId: remoteEnvironmentId,
      environmentLabel: "Remote device",
      onOpenChange: vi.fn(),
    });

    const [popup] = elementChildren(dialog);
    expect(popup?.type).toBe(DialogPopup);

    const [header, panel, footer] = elementChildren(popup!);
    expect(header?.type).toBe(DialogHeader);
    expect(panel?.type).toBe(DialogPanel);
    expect(footer?.type).toBe(DialogFooter);
    expect(header?.props).toMatchObject({ className: "shrink-0" });
    expect(footer?.props).toMatchObject({ className: "shrink-0" });
  });
});
