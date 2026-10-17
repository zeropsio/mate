// @vitest-environment happy-dom
import { act, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RightPanelPage, RightPanelPageEdge, RightPanelPageEdgeScope } from "./RightPanelPage";

const NEVER = new Promise<never>(() => undefined);
function StillReading(): never {
  throw NEVER;
}

async function draw(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(() => root.render(node));
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const head = () => document.querySelector("[data-slot=page-header]");

describe("RightPanelPage — every side-panel page opens the same way", () => {
  it("paints its title and its line before the page itself has answered", async () => {
    const root = await draw(
      <RightPanelPage kind="vault" mate="Nova">
        <Suspense fallback={null}>
          <StillReading />
        </Suspense>
      </RightPanelPage>,
    );
    expect(head()?.querySelector("h2")?.textContent).toBe("Vault");
    expect(head()?.textContent).toContain("Settings and secrets your apps read.");
    await act(() => root.unmount());
  });

  it("stands the page's one action at its title's edge", async () => {
    const root = await draw(
      <RightPanelPage kind="data" mate="Nova">
        <p>Tables</p>
        <RightPanelPageEdge>
          <button type="button">Refresh</button>
        </RightPanelPageEdge>
      </RightPanelPage>,
    );
    expect(head()?.querySelector("button")?.textContent).toBe("Refresh");
    expect(document.body.querySelectorAll("button")).toHaveLength(1);
    await act(() => root.unmount());
  });

  it("a page kept open behind another puts nothing at the edge", async () => {
    const root = await draw(
      <RightPanelPage kind="data" mate="Nova">
        <RightPanelPageEdgeScope hidden>
          <RightPanelPageEdge>
            <button type="button">Refresh db2</button>
          </RightPanelPageEdge>
        </RightPanelPageEdgeScope>
        <RightPanelPageEdgeScope hidden={false}>
          <RightPanelPageEdge>
            <button type="button">Refresh db</button>
          </RightPanelPageEdge>
        </RightPanelPageEdgeScope>
      </RightPanelPage>,
    );
    expect([...document.body.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Refresh db",
    ]);
    await act(() => root.unmount());
  });

  it("outside a side panel, the action stays where the page put it", async () => {
    const root = await draw(
      <section>
        <RightPanelPageEdge>
          <button type="button">Refresh</button>
        </RightPanelPageEdge>
      </section>,
    );
    expect(document.querySelector("section button")?.textContent).toBe("Refresh");
    await act(() => root.unmount());
  });

  it("a page that wears its own head opens with nothing above it", async () => {
    const root = await draw(
      <RightPanelPage kind="overview" mate="Nova">
        <p>Projects</p>
      </RightPanelPage>,
    );
    expect(head()).toBeNull();
    expect(document.body.textContent).toBe("Projects");
    await act(() => root.unmount());
  });
});
