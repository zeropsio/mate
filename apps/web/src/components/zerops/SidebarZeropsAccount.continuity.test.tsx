// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { SidebarProvider } from "../ui/sidebar";
import { SidebarAccountMenuProvider, SidebarZeropsAccount } from "./SidebarZeropsAccount";
import { zeropsAccountDisplay } from "./landing/ZeropsAccountControl.logic";

it("an account menu opened before HQ is ready stays open when the Mate menu arrives", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const props = {
    account: zeropsAccountDisplay({ email: "owner@example.com", fullName: "Owner" }),
    activeOrganization: { id: "acme", name: "ACME", membershipId: "acme-owner" },
    organizations: [
      { id: "acme", name: "ACME", membershipId: "acme-owner" },
      { id: "second", name: "Second", membershipId: "second-owner" },
    ],
    destination: null,
    destinationIcon: () => null,
    onGo: () => undefined,
    onSelectOrganization: () => undefined,
    onSignOut: () => undefined,
  };
  const draw = async (ready: boolean) => {
    await act(async () => {
      root.render(
        <SidebarProvider defaultOpen>
          <SidebarAccountMenuProvider>
            <section key={ready ? "mates" : "gate"}>
              {ready ? <SidebarZeropsAccount {...props} collapsed /> : null}
              <SidebarZeropsAccount {...props} />
            </section>
          </SidebarAccountMenuProvider>
        </SidebarProvider>,
      );
    });
  };
  const choices = () =>
    [...document.querySelectorAll('[role="menuitemradio"]')].map((item) => item.textContent);
  try {
    await draw(false);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-zerops-surface="sidebar-account"]')!
        .click();
    });
    expect(choices(), "Account menu must open before HQ is ready").toContain("Second");
    await draw(true);
    expect(choices(), "HQ becoming ready must retain the open account menu").toContain("Second");
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
