/**
 * Each application's releases and the repositories a release reads, through the organization's
 * HQ: together, each application on its own, again only for one whose reason moved — HQ saying
 * they moved, its production moving, a release just made — never on a clock; and an application
 * whose read fails keeps what it read before and says why.
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { act, type ReactElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useZeropsAppReleases, type ZeropsAppReleases } from "./useZeropsAppReleases";

/**
 * The organization's official HQ — one object, as `useOfficialHq` keeps it, or `null` while it is
 * not open here — what it answers each application, and what it was asked.
 */
const hq = vi.hoisted(() => {
  const state = {
    open: true,
    asked: [] as Array<string>,
    releases: new Map<string, ReadonlyArray<Release> | Error | "silent">(),
    repos: new Map<string, ReadonlyArray<RepoListEntry>>(),
  };
  const official = {
    address: "https://hq.example.test",
    api: {
      releases: async (appId: string) => {
        state.asked.push(appId);
        const answer = state.releases.get(appId);
        // An HQ slow to answer for this application: no answer comes.
        if (answer === "silent") return new Promise<never>(() => undefined);
        if (answer === undefined || answer instanceof Error) {
          throw answer ?? new Error("HQ has no such project.");
        }
        return answer;
      },
      appRepos: async (appId: string) => state.repos.get(appId) ?? [],
    },
  };
  return { state, official };
});

vi.mock("./accountHq", () => ({
  useOfficialHq: () => (hq.state.open ? hq.official : null),
}));

const RELEASE: Release = {
  tag: "v0.1.0",
  sha: "a".repeat(40),
  entries: [{ service: "app", sha: "b".repeat(40) }],
  by: "u1",
  at: "2026-10-02T10:00:00.000Z",
  state: "approved",
  reason: null,
  rollbackOf: null,
};
const GROUP: RepoListEntry = {
  name: "group",
  mainHead: "a".repeat(40),
  updatedAt: "2026-10-02T09:00:00.000Z",
};

/** What the hook said, render by render. */
const renders: ZeropsAppReleases[] = [];
const seen = () => renders.at(-1);

function Probe({ apps }: { readonly apps: ReadonlyMap<string, string> }) {
  renders.push(useZeropsAppReleases(apps));
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
  hq.state.releases = new Map();
  hq.state.repos = new Map();
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

const TWO = new Map([
  ["a-todo", ""],
  ["a-crm", ""],
]);

describe("useZeropsAppReleases", () => {
  it("reads each application's releases, and its repositories with them, through HQ", async () => {
    hq.state.releases = new Map([
      ["a-todo", [RELEASE]],
      ["a-crm", []],
    ]);
    hq.state.repos = new Map([["a-todo", [GROUP]]]);
    await mount(<Probe apps={TWO} />);
    expect(hq.state.asked.toSorted()).toEqual(["a-crm", "a-todo"]);
    expect(seen()?.releases).toEqual(
      new Map([
        ["a-todo", [RELEASE]],
        ["a-crm", []],
      ]),
    );
    expect(seen()?.repos).toEqual(
      new Map([
        ["a-todo", [GROUP]],
        ["a-crm", []],
      ]),
    );
    expect(seen()?.failures).toEqual(new Map());
  });

  // Audit R4: every open tab read every application's releases and repositories each minute.
  it("never reads again on a clock: only what moved is read", async () => {
    vi.useFakeTimers();
    hq.state.releases = new Map([
      ["a-todo", [RELEASE]],
      ["a-crm", []],
    ]);
    await mount(<Probe apps={TWO} />);
    hq.state.asked = [];
    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(hq.state.asked).toEqual([]);
  });

  it("shows each application as it answers: one slow to answer holds no other back", async () => {
    hq.state.releases = new Map<string, ReadonlyArray<Release> | Error | "silent">([
      ["a-todo", [RELEASE]],
      ["a-crm", "silent"],
    ]);
    await mount(<Probe apps={TWO} />);
    expect(seen()?.releases).toEqual(new Map([["a-todo", [RELEASE]]]));
  });

  it("keeps what an application read before when its read fails", async () => {
    hq.state.releases = new Map([
      ["a-todo", [RELEASE]],
      ["a-crm", []],
    ]);
    const tree = await mount(<Probe apps={TWO} />);
    hq.state.releases = new Map<string, ReadonlyArray<Release> | Error | "silent">([
      ["a-todo", new Error("HQ is not answering right now.")],
      ["a-crm", []],
    ]);
    await act(async () => {
      tree.update(
        <Probe
          apps={
            new Map([
              ["a-todo", "moved"],
              ["a-crm", ""],
            ])
          }
        />,
      );
    });
    expect(seen()?.releases.get("a-todo")).toEqual([RELEASE]);
    expect(seen()?.failures).toEqual(new Map([["a-todo", "HQ is not answering right now."]]));
  });

  it("reads one application again when its production moves, and no other", async () => {
    hq.state.releases = new Map([
      ["a-todo", [RELEASE]],
      ["a-crm", []],
    ]);
    const tree = await mount(<Probe apps={TWO} />);
    hq.state.asked = [];
    await act(async () => {
      tree.update(
        <Probe
          apps={
            new Map([
              ["a-todo", "app deploying"],
              ["a-crm", ""],
            ])
          }
        />,
      );
    });
    expect(hq.state.asked).toEqual(["a-todo"]);
  });

  it("reads an application again at once when a release of it was just made", async () => {
    hq.state.releases = new Map([
      ["a-todo", []],
      ["a-crm", []],
    ]);
    await mount(<Probe apps={TWO} />);
    hq.state.asked = [];
    hq.state.releases = new Map([
      ["a-todo", [RELEASE]],
      ["a-crm", []],
    ]);
    await act(async () => {
      seen()?.refresh("a-todo");
    });
    expect(hq.state.asked).toEqual(["a-todo"]);
    expect(seen()?.releases.get("a-todo")).toEqual([RELEASE]);
  });

  it("asks nothing while the organization's HQ is not open here", async () => {
    hq.state.open = false;
    await mount(<Probe apps={TWO} />);
    expect(hq.state.asked).toEqual([]);
    expect(seen()?.releases).toEqual(new Map());
  });
});
