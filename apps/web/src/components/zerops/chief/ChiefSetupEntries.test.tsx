// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { chiefSetupEntry, hqOwnChief } from "~/zerops/chief";
import { ZeropsProjectsHeader } from "../ZeropsProjectsPage";
import { SidebarChiefTop } from "./SidebarChiefTop";

vi.mock("../SidebarZeropsTree", () => ({ MenuMateLine: () => null }));
const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});
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
          <SidebarChiefTop
            chief={undefined}
            coming={undefined}
            conversationsRead={false}
            timestampFormat="locale"
            setup={null}
            unfinished={false}
            currentMate={false}
            currentPage={false}
            onOpenMate={() => {}}
            onOpenPage={open}
            waiting={undefined}
            offer={offer}
          />
          <ZeropsProjectsHeader setupChief={offer} onSetupChief={open} />
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

it("a no-Chief viewer sees the setup entry in menu and overview and it opens the Chief page", async () => {
  const { container, open } = await mount(true);
  const menu = container.querySelector(".menu-chief-name");
  expect(menu?.textContent).toBe("Set up your Chief");
  expect(container.querySelector(".menu-chief-line")?.textContent).toBe("Across this organization");
  const overview = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Set up Chief",
  );
  expect(overview).toBeDefined();
  await act(async () => {
    menu?.closest("button")?.click();
    overview?.click();
  });
  expect(open).toHaveBeenCalledTimes(2);
});

it.each([
  ["a viewer with a Chief never sees the setup entry", true, { chief: { chief: "mine" } }],
  ["unknown Chief state shows neither setup entry", false, {}],
] as const)("%s", async (_title, read, facts) => {
  const { container } = await mount(chiefSetupEntry(hqOwnChief(facts, read), "idle"));
  expect(container.textContent).not.toContain("Set up");
});

it("HQ's no-Chief answer arriving after first paint reveals both setup entries", async () => {
  const view = await mount(false);
  expect(view.container.textContent).not.toContain("Set up");
  await view.render(true);
  expect(view.container.textContent).toContain("Set up your Chief");
  expect(view.container.textContent).toContain("Set up Chief");
});
