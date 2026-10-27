// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AccountDataContext, type AccountData, useDetailReadAsOpened } from "./accountData";

const roots: Array<() => void> = [];
afterEach(() => {
  for (const unmount of roots.splice(0)) unmount();
});

function Opened({ ownerId }: { readonly ownerId: string | null }) {
  useDetailReadAsOpened("organizationMembers", ownerId);
  return null;
}

async function open(ownerId: string | null) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const revalidate = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  const account = { revalidate } as unknown as AccountData;
  await act(async () => {
    root.render(
      createElement(
        AccountDataContext.Provider,
        { value: account },
        createElement(Opened, { ownerId }),
      ),
    );
  });
  roots.push(() => root.unmount());
  return {
    revalidate,
    rerender: (next: string | null) =>
      act(async () => {
        root.render(
          createElement(
            AccountDataContext.Provider,
            { value: account },
            createElement(Opened, { ownerId: next }),
          ),
        );
      }),
  };
}

describe("a decision read from a detail read once a session", () => {
  it("reads the organization's members again as the screen opens, so whoever joined since is listed", async () => {
    const { revalidate, rerender } = await open("org");
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(revalidate).toHaveBeenCalledWith({ family: "organizationMembers", ownerId: "org" });
    // Drawn again, the screen is still the one opened: nothing more is read.
    await rerender("org");
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while the organization is not known", async () => {
    const { revalidate } = await open(null);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
