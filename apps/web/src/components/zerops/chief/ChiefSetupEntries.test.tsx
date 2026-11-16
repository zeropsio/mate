// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { chiefSetupEntry, hqOwnChief } from "~/zerops/chief";
import { Menu } from "../../ui/menu";
import { SidebarZeropsAccountMenu } from "../SidebarZeropsAccount";
import { ZeropsProjectsHeader } from "../ZeropsProjectsPage";

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** The account menu and the overview's header, the Chief offered (`chiefOffered`) or not. */
async function mount(offer: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const open = vi.fn();
  const render = async (offer: boolean) =>
    act(async () =>
      root.render(
        <>
          <Menu>
            <SidebarZeropsAccountMenu
              account={{ name: "Ada", fullName: null, initials: "A", email: null, avatarUrl: null }}
              activeOrganization={null}
              chief={offer ? { icon: null, onSetUp: open } : undefined}
              destination={null}
              destinationIcon={() => null}
              onGo={() => {}}
              onSelectOrganization={() => {}}
              onSignOut={() => {}}
              organizations={[]}
            />
          </Menu>
          <ZeropsProjectsHeader />
        </>,
      ),
    );
  await render(offer);
  unmounts.push(() => {
    root.unmount();
    container.remove();
  });
  return { container, open, render };
}

it("a person offered a Chief sets it up from the account menu, which opens the Chief page", async () => {
  const { container, open } = await mount(true);
  const entry = container.querySelector<HTMLElement>("[data-zerops-account-chief]");
  expect(entry?.textContent).toContain("Set up Chief");
  await act(async () => entry?.click());
  expect(open).toHaveBeenCalledTimes(1);
});

it("the overview offers no Chief: the account menu is its only entry", async () => {
  const { container } = await mount(true);
  const offers = [...container.querySelectorAll("[role=menuitem], button")].filter((one) =>
    one.textContent?.includes("Set up"),
  );
  expect(offers).toHaveLength(1);
});

it.each([
  ["a viewer with a Chief never sees the setup entry", true, { chief: { chief: "mine" } }],
  ["unknown Chief state shows neither setup entry", false, {}],
] as const)("%s", async (_title, read, facts) => {
  const { container } = await mount(chiefSetupEntry(hqOwnChief(facts, read), "idle"));
  expect(container.textContent).not.toContain("Set up");
});

it("HQ's no-Chief answer arriving after first paint reveals the account menu's setup entry", async () => {
  const view = await mount(false);
  expect(view.container.textContent).not.toContain("Set up");
  await view.render(true);
  expect(view.container.querySelector("[data-zerops-account-chief]")?.textContent).toContain(
    "Set up Chief",
  );
});
