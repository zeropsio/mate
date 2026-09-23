import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  interimRouteTarget,
  routeGatePhrase,
  selectRouteGate,
  type InterimRegistration,
  type RouteContent,
} from "@t3tools/client-runtime/zerops/environments";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "../zerops/__fixtures__/testDom";
import { RouteGateView } from "./-routeGate";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");

/** The route's Mate as the inventory lists it, with its zcp service in `status`. */
const mate = (status: string): ZeropsCandidate => ({
  key: "project-1:service-1",
  project: { id: "project-1", name: "shop", status: "ACTIVE" } as ZeropsProject,
  group: status === "ACTIVE" ? "ready" : "provisioning",
  service: { id: "service-1", name: "zcp", status },
  ...(status === "ACTIVE" ? { containerOrigin: ORIGIN } : {}),
});

/** The gate `__root` renders for what today's shell holds about the route's environment. */
function gateFor(
  connection: InterimRegistration["connection"],
  serviceStatus: string,
  content: RouteContent,
) {
  const gate = selectRouteGate(
    interimRouteTarget({
      environmentId: ENV_A,
      registration: { origin: ORIGIN, connection },
      recordKey: "project-1:service-1",
      candidates: [mate(serviceStatus)],
      exchangePending: () => false,
      restoring: false,
      organization: "chosen",
      content,
    }),
  );
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
  it("platform RESTARTING while connected keeps the ChatView instance", () => {
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

    render(gateFor("connected", "ACTIVE", "live"));
    texts.push(container.textContent);
    render(gateFor("connected", "RESTARTING", "live"));
    texts.push(container.textContent);
    render(gateFor("reconnecting", "RESTARTING", "live"));
    texts.push(container.textContent);
    render(gateFor("connected", "ACTIVE", "live"));
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
    const refused = selectRouteGate({
      kind: "resolved",
      reachability: { kind: "refused-role" },
      content: "live",
    });

    act(() =>
      root.render(
        <RouteGateView {...gateFor("connected", "ACTIVE", "live")} projectId="project-1">
          <ChatView />
        </RouteGateView>,
      ),
    );
    expect(mounted).toBe(true);
    act(() =>
      root.render(
        <RouteGateView
          gate={refused}
          phrase={routeGatePhrase(refused, { nowMs: 0, mateName: "shop" })}
          projectId="project-1"
        >
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
