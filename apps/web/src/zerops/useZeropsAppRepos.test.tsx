/**
 * Each application's repositories for the Git page, read as the person through the
 * organization's HQ: together, again every minute while the page is open, and an application whose
 * read fails keeps what it read before and says why — it never answers "no repositories".
 */
import type { HqAppRepo } from "@t3tools/client-runtime/zerops/hq";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { APP_REPOS_REFRESH_MS, useZeropsAppRepos, type ZeropsAppRepos } from "./useZeropsAppRepos";

/**
 * The organization's official HQ — one object, as `useOfficialHq` keeps it, or `null` while it is
 * not open here — what it answers each application, and what it was asked.
 */
const hq = vi.hoisted(() => {
  const state = {
    open: true,
    asked: [] as Array<string>,
    answers: new Map<string, ReadonlyArray<HqAppRepo> | Error>(),
  };
  const official = {
    address: "https://hq.example.test",
    api: {
      appRepos: async (appId: string) => {
        state.asked.push(appId);
        const answer = state.answers.get(appId);
        if (answer === undefined || answer instanceof Error) {
          throw answer ?? new Error("HQ has no such project.");
        }
        return answer;
      },
    },
  };
  return { state, official };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.state.open ? hq.official : null),
}));

const APPDEV: HqAppRepo = { name: "appdev", mainHead: "a".repeat(40), updatedAt: null };
const API: HqAppRepo = { name: "api", mainHead: null, updatedAt: null };

/** What the hook said, render by render. */
const renders: ZeropsAppRepos[] = [];
const seen = () => renders.at(-1);

function Probe({ appIds }: { readonly appIds: ReadonlyArray<string> }) {
  renders.push(useZeropsAppRepos(appIds));
  return null;
}

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  hq.state.open = true;
  hq.state.asked = [];
  hq.state.answers = new Map();
  renders.length = 0;
  vi.useRealTimers();
});

async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(element);
  });
  mounted.push(tree!);
  return tree!;
}

const TWO = ["a-todo", "a-crm"];

describe("useZeropsAppRepos", () => {
  it("reads each application's repositories through HQ", async () => {
    hq.state.answers = new Map([
      ["a-todo", [APPDEV]],
      ["a-crm", [API]],
    ]);
    await mount(<Probe appIds={TWO} />);
    expect(hq.state.asked.toSorted()).toEqual(["a-crm", "a-todo"]);
    expect(seen()?.repos).toEqual(
      new Map([
        ["a-todo", [APPDEV]],
        ["a-crm", [API]],
      ]),
    );
    expect(seen()?.failures).toEqual(new Map());
  });

  it("keeps what an application read before when its read fails, and says why", async () => {
    vi.useFakeTimers();
    hq.state.answers = new Map([
      ["a-todo", [APPDEV]],
      ["a-crm", [API]],
    ]);
    await mount(<Probe appIds={TWO} />);
    hq.state.answers = new Map<string, ReadonlyArray<HqAppRepo> | Error>([
      ["a-todo", [APPDEV]],
      ["a-crm", new Error("HQ is not answering right now.")],
    ]);
    await act(async () => {
      vi.advanceTimersByTime(APP_REPOS_REFRESH_MS);
    });
    expect(seen()?.repos.get("a-crm")).toEqual([API]);
    expect(seen()?.failures).toEqual(new Map([["a-crm", "HQ is not answering right now."]]));
  });

  it("reads again every minute while it is open", async () => {
    vi.useFakeTimers();
    hq.state.answers = new Map([["a-todo", [APPDEV]]]);
    await mount(<Probe appIds={["a-todo"]} />);
    expect(hq.state.asked).toEqual(["a-todo"]);
    await act(async () => {
      vi.advanceTimersByTime(APP_REPOS_REFRESH_MS);
    });
    expect(hq.state.asked).toEqual(["a-todo", "a-todo"]);
  });

  it("asks nothing while the organization's HQ is not open here", async () => {
    hq.state.open = false;
    await mount(<Probe appIds={TWO} />);
    expect(hq.state.asked).toEqual([]);
    expect(seen()?.repos).toEqual(new Map());
  });
});
