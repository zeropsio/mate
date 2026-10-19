// @vitest-environment happy-dom
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => Date.parse("2026-10-18T12:00:00Z") }));

import { ProjectChangesCard } from "./ProjectChangesCard";
import { projectChangeGroups } from "./projectChangesCard.logic";

function pull(number: number, over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number,
    title: `Change ${String(number)}`,
    kind: "code",
    mateProjectId: "p-raya",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: `app #${String(number)}`,
    updatedAt: "2026-10-18T11:00:00Z",
    ...over,
  };
}

const GROUPS = projectChangeGroups({
  open: [pull(9, { title: "Gift cards at checkout" })],
  merged: [
    pull(8, {
      title: "Prices per 100 g",
      merged: true,
      mergedAt: "2026-10-18T11:35:00Z",
      pullRequest: {
        number: 5,
        url: "https://github.com/acme/tea-shop/pull/5",
        state: "merged",
      },
    }),
    pull(7, { title: "Show how many teas", merged: true, mergedAt: "2026-10-11T09:00:00Z" }),
    pull(6, { title: "Sold-out badge", merged: true, mergedAt: "2026-10-04T09:00:00Z" }),
    pull(5, { title: "First tea list", merged: true, mergedAt: "2026-09-20T09:00:00Z" }),
  ],
  releases: [
    { tag: "v0.1.3", taggedAt: "2026-10-12T09:00:00Z", live: true },
    { tag: "v0.1.2", taggedAt: "2026-10-06T09:00:00Z", live: false },
    { tag: "v0.1.1", taggedAt: "2026-09-28T09:00:00Z", live: false },
  ],
  stage: undefined,
  production: true,
});

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  unmounts.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const MATES = (projectId: string) => (projectId === "p-raya" ? { name: "Raya" } : undefined);

describe("a project's Changes card", () => {
  it("lifts what waits on you with its Review, whose it is, and opens the change from it", async () => {
    const onOpen = vi.fn();
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={onOpen}
        read={{ state: "known" }}
      />,
    );
    const waiting = host.querySelector('[data-zerops-changes="waiting"]');
    expect(waiting?.textContent).toContain("Waiting on you · 1");
    expect(waiting?.textContent).toContain("Gift cards at checkout");
    expect(waiting?.textContent).toContain("Raya · 1h");
    const review = [...(waiting?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Review",
    );
    await act(async () => {
      review?.click();
    });
    expect(onOpen.mock.calls[0]?.[0].pull.number).toBe(9);
  });

  it("holds merged work no release took as ready to release, with when it merged", async () => {
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        read={{ state: "known" }}
      />,
    );
    const ready = host.querySelector('[data-zerops-changes="ready"]');
    expect(ready?.textContent).toContain("Ready to release · 1");
    expect(ready?.textContent).toContain("Prices per 100 g");
    expect(ready?.textContent).toContain("Raya · merged 25m ago");
  });

  it("puts released work under the release that carried it, production's marked Live, and an older release opens production's releases", async () => {
    const onOpenRelease = vi.fn();
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        onOpenRelease={onOpenRelease}
        read={{ state: "known" }}
      />,
    );
    const live = host.querySelector('[data-zerops-release="v0.1.3"]');
    expect(live?.textContent).toContain("Live");
    expect(live?.textContent).toContain("Show how many teas");
    const older = host.querySelector<HTMLButtonElement>(
      'button[data-zerops-release-line="v0.1.2"]',
    );
    expect(older?.textContent).toContain("1 change");
    expect(host.textContent).not.toContain("Sold-out badge");
    await act(async () => {
      older?.click();
    });
    expect(onOpenRelease).toHaveBeenCalledWith("v0.1.2");
  });

  it("holds its rows at their size until HQ tells the changes, then says why where it never does", async () => {
    const reading = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        read={{ state: "reading" }}
      />,
    );
    expect(reading.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(reading.textContent).not.toContain("Gift cards");
    const untold = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        read={{ state: "untold", words: "HQ did not answer." }}
      />,
    );
    expect(untold.textContent).toContain("HQ did not answer.");
  });

  it("the Changes card's ready group releases", async () => {
    const onRelease = vi.fn();
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        onRelease={onRelease}
        read={{ state: "known" }}
      />,
    );
    const ready = host.querySelector('[data-zerops-changes="ready"]');
    const release = [...(ready?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Release",
    );
    await act(async () => {
      release?.click();
    });
    expect(onRelease).toHaveBeenCalledTimes(1);
    const merged = await mount(
      <ProjectChangesCard
        groups={{ ...GROUPS, ready: { ...GROUPS.ready, title: "Merged" } }}
        mateOf={MATES}
        onOpen={vi.fn()}
        onRelease={onRelease}
        read={{ state: "known" }}
      />,
    );
    const nowhere = [...merged.querySelectorAll("button")].find(
      (button) => button.textContent === "Release",
    );
    expect(nowhere).toBeUndefined();
  });

  it("the Changes card's Release holds off while a release is on its way", async () => {
    const onRelease = vi.fn();
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        onRelease={onRelease}
        read={{ state: "known" }}
        releasing
      />,
    );
    const ready = host.querySelector('[data-zerops-changes="ready"]');
    const buttons = [...(ready?.querySelectorAll("button") ?? [])].filter((button) =>
      button.textContent?.startsWith("Releas"),
    );
    expect(buttons.map((button) => [button.textContent, button.disabled])).toEqual([
      ["Releasing…", true],
    ]);
  });

  it("a change shows its GitHub pull request where it has one, opened on GitHub", async () => {
    const host = await mount(
      <ProjectChangesCard
        groups={GROUPS}
        mateOf={MATES}
        onOpen={vi.fn()}
        read={{ state: "known" }}
      />,
    );
    const row = host.querySelector('[data-zerops-change="app#8"]');
    const link = row?.querySelector<HTMLAnchorElement>("a");
    // The GitHub object is "PR #n"; the change itself is named by its title, never HQ's number.
    expect(link?.textContent).toBe("PR #5");
    expect(row?.textContent).toContain("Prices per 100 g");
    expect(row?.textContent).not.toContain("#8");
    expect(link?.getAttribute("href")).toBe("https://github.com/acme/tea-shop/pull/5");
    expect(host.querySelector('[data-zerops-change="app#7"] a')).toBeNull();
  });
});
