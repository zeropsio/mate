import {
  routeGatePhrase,
  selectRouteGate,
  type Reachability,
  type RouteContent,
} from "@t3tools/client-runtime/zerops/environments";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../zerops/__fixtures__/testDom";
import { RouteGateView } from "./-routeGate";

const READY: Reachability = { kind: "ready", notice: null };
const RESTARTING_UNDER_LINK: Reachability = {
  kind: "ready",
  notice: { level: "restarting", by: "platform", overdue: false },
};
const RESTARTING: Reachability = {
  kind: "container",
  container: { level: "restarting", by: "platform", overdue: false },
};

/** The gate `__root` renders for the route environment's verdict and content. */
function gateFor(reachability: Reachability, content: RouteContent) {
  const gate = selectRouteGate({ kind: "resolved", reachability, content });
  return { gate, phrase: routeGatePhrase(gate, { nowMs: 0, mateName: "shop" }) };
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
          <RouteGateView gate={view.gate} phrase={view.phrase} projectId="project-1">
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
});
