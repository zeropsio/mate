import { act, createElement } from "react";
import * as Effect from "effect/Effect";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";
import { TestNode, buttonsLabelled, press } from "~/zerops/__fixtures__/testDom";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { ZeropsDataContext, type ZeropsDataContextValue } from "~/zerops/zeropsDataContext";
import { StopReadAgain } from "./StopReadAgain";
const calls = vi.hoisted(() => [] as string[]);
vi.mock("~/zerops/accountForge", () => ({ againStopDeployment: () => calls.push("demand") }));
vi.mock("~/zerops/projectFlowContext", () => ({
  useZeropsProjectFlowOptional: () => ({
    deployments: new Map([
      [
        "prod",
        {
          state: "failed",
          failure: { kind: "transport", detail: "closed" },
          atMs: 0,
          attempt: 1,
          retryAtMs: null,
        },
      ],
    ]),
  }),
}));
vi.mock("../ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: import("react").ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => createElement("button", { onClick, disabled }, children),
}));
afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});
it("a failed runtime read offers one manual Again that renews its demand and refreshes that project", async () => {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { document, HTMLIFrameElement: TestNode, setTimeout, clearTimeout });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  const root = createRoot(container as unknown as Element);
  const project = {
    kind: "project",
    projectId: "prod",
    organization: { kind: "organization" },
  } as ProjectRef;
  const inventory = { projectRefs: new Map([["prod", project]]) } as unknown as Inventory;
  const data = {
    runtime: { refresh: (ref: ProjectRef) => Effect.sync(() => calls.push(ref.projectId)) },
  } as unknown as ZeropsDataContextValue;
  await act(async () =>
    root.render(
      createElement(
        InventoryContext,
        { value: inventory },
        createElement(
          ZeropsDataContext,
          { value: data },
          createElement(StopReadAgain, { projectId: "prod" }),
        ),
      ),
    ),
  );
  expect(buttonsLabelled(container, "Again")).toHaveLength(1);
  expect(calls).toEqual([]);
  await act(async () => press(buttonsLabelled(container, "Again")[0]!));
  expect(calls).toEqual(["demand", "prod"]);
  await act(async () => root.unmount());
});
