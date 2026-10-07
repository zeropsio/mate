import { RegistryContext } from "@effect/atom-react";
import { mountRoster } from "@t3tools/client-runtime/zerops/testing";
import { platformInventory } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { project } from "./__fixtures__/platformData";
import { TestNode, buttonsLabelled, press } from "./__fixtures__/testDom";
import { AccountDataContext, type AccountData } from "./ZeropsAccountData";
import { ZeropsInventoryProvider } from "./ZeropsInventoryProvider";
import { conversationAccess, useProjectDialog, useZeropsInventory } from "./inventoryContext";

const owner = project("protected");
const viewer = {
  id: owner.organization.organizationId,
  name: "Org",
  membershipId: "member",
  roleCode: "ADMIN",
};
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    status: "signed-in",
    organizationStatus: "selected",
    activeOrganization: viewer,
  }),
}));
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: () => owner.organization,
    projectRef: (_org: string, id: string) => project(id),
  }),
}));

afterEach(() => vi.unstubAllGlobals());
it.each(["denial", "outage"] as const)(
  "an open conversation, draft and dialog follow projected %s",
  async (source) => {
    const registry = AtomRegistry.make();
    const store = mountRoster(registry, viewer.id, [
      { id: owner.projectId, name: "Protected", status: "ACTIVE", clientId: viewer.id },
    ]);
    const document = new TestNode("#document", null, 9);
    vi.stubGlobal("document", document);
    vi.stubGlobal("window", { document, HTMLIFrameElement: TestNode, setTimeout, clearTimeout });
    vi.stubGlobal("HTMLIFrameElement", TestNode);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const { createRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    const root = createRoot(container as unknown as Element);
    function Protected() {
      const inventory = useZeropsInventory();
      const access = conversationAccess(inventory, owner.projectId);
      const [dialog, setDialog] = useProjectDialog(
        (held: { readonly projectId: string }) => held.projectId,
      );
      return createElement(
        "div",
        null,
        access.kind === "authorized"
          ? "protected conversation and draft"
          : "protected content closed",
        createElement(
          "button",
          { onClick: () => setDialog({ projectId: owner.projectId }) },
          "Open dialog",
        ),
        dialog === null ? "dialog closed" : "captured protected dialog",
      );
    }
    const data = {
      data: store.data,
      orgId: viewer.id,
      retry: () => undefined,
    } as unknown as AccountData;
    try {
      await act(async () =>
        root.render(
          createElement(
            RegistryContext,
            { value: registry },
            createElement(
              AccountDataContext,
              { value: data },
              createElement(ZeropsInventoryProvider, null, createElement(Protected)),
            ),
          ),
        ),
      );
      await act(async () => press(buttonsLabelled(container, "Open dialog")[0]!));
      expect(container.textContent).toContain("protected conversation and draft");
      expect(container.textContent).toContain("captured protected dialog");
      await act(async () => {
        store.dispatch(
          source === "denial"
            ? { kind: "access", family: "project", id: owner.projectId, access: "denied" }
            : {
                kind: "stream",
                key: `zerops:${viewer.id}`,
                now: 0,
                event: {
                  kind: "fault",
                  jitter: 0,
                  fault: { outcome: "transient", message: "offline" },
                },
              },
        );
      });
      const read = registry.get(
        store.data.project(platformInventory, { orgId: viewer.id, viewer }),
      );
      expect(read.denied).toEqual(source === "denial" ? [owner.projectId] : []);
      expect(container.textContent).toContain(
        source === "denial" ? "protected content closed" : "protected conversation and draft",
      );
      expect(container.textContent).toContain(
        source === "denial" ? "dialog closed" : "captured protected dialog",
      );
    } finally {
      await act(async () => root.unmount());
      registry.dispose();
    }
  },
);
