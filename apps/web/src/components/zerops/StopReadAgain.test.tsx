import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ProjectRef } from "@t3tools/client-runtime/zerops/data";
import { TestNode, buttonsLabelled, press } from "~/zerops/__fixtures__/testDom";
import { InventoryContext, type Inventory } from "~/zerops/inventoryContext";
import { AccountDataContext, type AccountData } from "~/zerops/ZeropsAccountData";
import { StopReadAgain } from "./StopReadAgain";
const calls = vi.hoisted(() => [] as string[]);
const drawn = vi.hoisted(() => [] as string[]);
vi.mock("~/zerops/accountForge", () => ({
  useStopDeploymentDemand: (ref: ProjectRef | null) => {
    if (ref !== null) drawn.push(ref.projectId);
  },
}));
const read = vi.hoisted(() => ({ failure: "transport" }));
vi.mock("~/zerops/projectFlows", () => ({
  useStopDeploymentsShown: () =>
    new Map([
      [
        "prod",
        read.failure === "unread"
          ? { state: "unread", waitingFor: null }
          : read.failure !== "transport"
            ? {
                state: "withheld",
                reason: read.failure,
                cause:
                  read.failure === "access-lapsed"
                    ? {
                        failure: { kind: "transport", detail: "closed" },
                        attempt: 1,
                        retryAtMs: null,
                      }
                    : null,
              }
            : {
                state: "failed",
                failure: { kind: "transport", detail: "closed" },
                atMs: 0,
                attempt: 1,
                retryAtMs: null,
              },
      ],
    ]),
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
  drawn.length = 0;
  vi.unstubAllGlobals();
});
it.each(["transport", "access-denied", "access-lapsed", "unread"])(
  "a failed/refused source read offers one manual Again: %s",
  async (failure) => {
    read.failure = failure;
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
      retry: () => calls.push("navigation"),
      retryDetail: (demand: { readonly ownerId: string }) =>
        calls.push(`invalid detail:${demand.ownerId}`),
    } as unknown as AccountData;
    await act(async () =>
      root.render(
        createElement(
          InventoryContext,
          { value: inventory },
          createElement(
            AccountDataContext,
            { value: data },
            createElement(StopReadAgain, { projectId: "prod" }),
          ),
        ),
      ),
    );
    expect(drawn).toEqual(["prod"]);
    expect(buttonsLabelled(container, "Again")).toHaveLength(failure === "unread" ? 0 : 1);
    expect(calls).toEqual([]);
    if (failure !== "unread") {
      await act(async () => press(buttonsLabelled(container, "Again")[0]!));
      expect(calls).toEqual(["navigation"]);
    }
    await act(async () => root.unmount());
  },
);
