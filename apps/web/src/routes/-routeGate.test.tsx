import {
  routeGatePhrase,
  selectRouteGate,
  type ConversationView,
  type Reachability,
  type RouteContent,
} from "@t3tools/client-runtime/zerops/environments";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { gatedPortal } from "../components/ui/portal-gate";
import { readableText, TestNode } from "../zerops/__fixtures__/testDom";
import { RouteGateView } from "./-routeGate";

// "Go to projects" is a router link; no router runs here.
vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { readonly children?: ReactNode }) => children ?? null,
}));

/** A floating layer as the UI kit gates one; it renders in place here. */
const FloatingLayer = gatedPortal(({ children }: { readonly children?: ReactNode }) => children);

const READY: Reachability = { kind: "ready", notice: null };
const SHOWN: ConversationView = { kind: "shown", until: null };
const RESTARTING_UNDER_LINK: Reachability = {
  kind: "ready",
  notice: { level: "restarting", by: "platform", overdue: false },
};
const RESTARTING: Reachability = {
  kind: "container",
  container: { level: "restarting", by: "platform", overdue: false },
};

/** The gate `__root` renders for the route environment's verdict and content. */
function gateFor(
  reachability: Reachability,
  content: RouteContent,
  conversation: ConversationView = SHOWN,
) {
  const gate = selectRouteGate({ kind: "resolved", reachability, content });
  return { gate, phrase: routeGatePhrase(gate, { nowMs: 0, mateName: "shop" }), conversation };
}

let container: TestNode;
let root: Root;

beforeEach(() => {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container as unknown as Element);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("RouteGateView", () => {
  it("a restart under a live link, then with the link down, keeps the ChatView instance", () => {
    const mounts: Array<number> = [];
    let next = 0;
    function ChatView() {
      useEffect(() => {
        next += 1;
        mounts.push(next);
      }, []);
      return "conversation";
    }
    const render = (view: ReturnType<typeof gateFor>) =>
      act(() =>
        root.render(
          <RouteGateView {...view} projectId="project-1">
            <ChatView />
          </RouteGateView>,
        ),
      );
    const texts: Array<string> = [];

    render(gateFor(READY, "live"));
    texts.push(container.textContent);
    render(gateFor(RESTARTING_UNDER_LINK, "live"));
    texts.push(container.textContent);
    render(gateFor(RESTARTING, "live"));
    texts.push(container.textContent);
    render(gateFor(READY, "live"));
    texts.push(container.textContent);

    expect(mounts).toEqual([1]);
    expect(texts).toEqual([
      "conversation",
      "conversationZerops is restarting this Mate.",
      "conversationZerops is restarting this Mate.",
      "conversation",
    ]);
    expect(texts.join(" ")).not.toContain("not reachable");
  });

  it("replaces the outlet only on a terminal verdict", () => {
    let mounted = false;
    function ChatView() {
      useEffect(() => {
        mounted = true;
        return () => {
          mounted = false;
        };
      }, []);
      return "conversation";
    }
    const refused = gateFor({ kind: "refused-role" }, "live");

    act(() =>
      root.render(
        <RouteGateView {...gateFor(READY, "live")} projectId="project-1">
          <ChatView />
        </RouteGateView>,
      ),
    );
    expect(mounted).toBe(true);
    act(() =>
      root.render(
        <RouteGateView {...refused} projectId="project-1">
          <ChatView />
        </RouteGateView>,
      ),
    );

    expect(mounted).toBe(false);
    expect(container.textContent).toBe(
      "You can see this project in Zerops but can't operate its Mate.",
    );
  });

  // DESIGN §9 C1b: hidden, never unmounted, until the access vouches for it again.
  it("a suppressed conversation keeps the ChatView instance and hides it, its floating layers and drafts included", () => {
    const mounts: Array<number> = [];
    function ChatView() {
      useEffect(() => {
        mounts.push(mounts.length + 1);
      }, []);
      return (
        <>
          conversation
          <FloatingLayer>menu</FloatingLayer>
        </>
      );
    }
    const render = (conversation: ConversationView) =>
      act(() =>
        root.render(
          <RouteGateView {...gateFor(RESTARTING_UNDER_LINK, "live", conversation)} projectId="p1">
            <ChatView />
          </RouteGateView>,
        ),
      );

    render(SHOWN);
    expect(readableText(container)).toContain("conversationmenu");
    render({ kind: "suppressed", reason: "access-denied" });
    const suppressed = readableText(container);
    const suppressedText = container.textContent;
    render(SHOWN);

    expect(mounts).toEqual([1]);
    expect(suppressed).toBe("Your access to this project changed.Go to projects");
    expect(suppressedText).not.toContain("menu");
    expect(readableText(container)).toContain("conversationmenu");
    expect(container.textContent).toContain("conversationmenu");
  });
});
