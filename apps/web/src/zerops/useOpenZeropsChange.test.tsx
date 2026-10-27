import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

const HQ = "https://hq.example.test";

/** Where the resolver sent the person: the page it navigated to, or the tab it opened. */
const went = vi.hoisted(() => ({
  pages: [] as Array<unknown>,
  tabs: [] as Array<unknown>,
  hqAddress: "https://hq.example.test" as string | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => async (to: unknown) => {
    went.pages.push(to);
  },
}));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: {
    getState: () => ({
      openChange: (_ref: unknown, change: unknown) => {
        went.tabs.push(change);
      },
    }),
  },
}));
vi.mock("./projectFlows", () => ({ useHqAddress: () => went.hqAddress }));

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  return document;
}

/** The resolver as a conversation (`threadRef`) or a page without one holds it. */
async function resolverOf(
  threadRef: Parameters<typeof import("./useOpenZeropsChange").useOpenZeropsChange>[0],
) {
  const document = installTestDom();
  const { act, createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useOpenZeropsChange } = await import("./useOpenZeropsChange");
  const seen: Array<(href: string) => (() => void) | null> = [];
  function Probe() {
    seen.push(useOpenZeropsChange(threadRef));
    return null;
  }
  const root = createRoot(document.createElement("div") as unknown as Element);
  await act(async () => root.render(createElement(Probe)));
  await act(async () => root.unmount());
  return seen.at(-1)!;
}

afterEach(() => {
  went.pages = [];
  went.tabs = [];
  went.hqAddress = HQ;
  vi.unstubAllGlobals();
});

describe("useOpenZeropsChange", () => {
  it("opens a change at the official HQ as a tab beside the conversation", async () => {
    const resolve = await resolverOf({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
    });
    resolve(`${HQ}/changes/g1/app/7`)?.();
    expect(went.tabs).toEqual([{ groupId: "g1", repository: "app", number: 7 }]);
  });

  it("opens it on its own page with no conversation to sit beside", async () => {
    const resolve = await resolverOf(null);
    resolve(`${HQ}/changes/g1/app/7`)?.();
    expect(went.pages).toEqual([
      {
        to: "/change/$groupId/$repository/$number",
        params: { groupId: "g1", repository: "app", number: "7" },
      },
    ]);
  });

  it.each([
    ["another HQ's change", "https://hq.elsewhere.test/changes/g1/app/7", HQ],
    ["a change while the official HQ is not known", `${HQ}/changes/g1/app/7`, undefined],
    ["anything else at the official HQ", `${HQ}/api/apps/g1/changes`, HQ],
  ])("leaves %s to open where it points", async (_name, href, hqAddress) => {
    went.hqAddress = hqAddress;
    const resolve = await resolverOf(null);
    expect(resolve(href)).toBeNull();
  });
});
