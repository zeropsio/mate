// @vitest-environment happy-dom
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const effects = vi.hoisted(() => ({ review: vi.fn() }));
vi.mock("~/zerops/review", () => ({ useOpenReview: () => effects.review }));

import {
  changeReviewItem,
  crewTaskReviewItem,
  ProjectReviewTags,
  type ProjectReviewItem,
} from "./SidebarProjectReview";

const pull = (number: number, title: string): FlowPullRequest =>
  ({
    repository: "appdev",
    number,
    title,
    kind: "code",
    mateProjectId: "mate-vira",
    url: undefined,
    mergeability: "clean",
    behind: false,
    merged: false,
    mergedAt: undefined,
  }) as unknown as FlowPullRequest;

const VIRA = { name: "Vira", tint: "amber", shape: "clover" } as const;
const change = (number: number, title: string): ProjectReviewItem =>
  changeReviewItem({
    pull: pull(number, title),
    among: [],
    groupId: "orbit",
    by: VIRA,
    mine: true,
  });
const ENVIRONMENT = EnvironmentId.make("environment-orbit");

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  effects.review.mockReset();
});

type Props = Partial<ComponentProps<typeof ProjectReviewTags>>;

async function mount(props: Props) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const row = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const render = (next: Props) =>
    act(async () => {
      root.render(
        // The project row as the menu draws it: a container whose own press does something.
        <div onClick={row} onPointerDown={row} onKeyDown={row} role="presentation">
          <ProjectReviewTags
            groupId="orbit"
            items={[]}
            projectName="Orbit"
            release={undefined}
            {...next}
          />
        </div>,
      );
    });
  await render(props);
  unmounts.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, row, rerender: render };
}

const tag = (container: HTMLElement, label: RegExp) =>
  [...container.querySelectorAll("button")].find((button) =>
    label.test(button.getAttribute("aria-label") ?? ""),
  );

const press = (element: Element) =>
  act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    (element as HTMLElement).click();
  });

const popover = () => document.querySelector('[data-zerops-surface="sidebar-project-changes"]');
const popoverItems = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-zerops-surface="sidebar-project-change"]'),
];

describe("a project's Review tag", () => {
  it("one change says Review and opens that change's review at once", async () => {
    const { container } = await mount({ items: [change(4, "Add a due date")] });
    const review = tag(container, /^Review Add a due date$/u);
    expect(review?.textContent).toBe("Review");
    await press(review!);
    expect(effects.review).toHaveBeenCalledWith(
      { kind: "change", groupId: "orbit", repository: "appdev", number: 4 },
      { from: review },
    );
    expect(popover()).toBeNull();
  });

  it("two changes say Review 2 and open a popover listing both, each opening its own review", async () => {
    const { container } = await mount({
      items: [change(4, "Add a due date"), change(5, "Sort by priority")],
    });
    const review = tag(container, /^2 to review in Orbit$/u)!;
    expect(review.textContent).toBe("Review2");
    await press(review);
    expect(effects.review).not.toHaveBeenCalled();
    expect(popover()?.textContent).toContain("2 changes in Orbit");
    expect(popoverItems().map((item) => item.getAttribute("aria-label"))).toEqual([
      "Review Add a due date",
      "Review Sort by priority",
    ]);
    expect(popoverItems()[1]?.textContent).toContain("Vira · #5");
    await press(popoverItems()[1]!);
    expect(effects.review).toHaveBeenCalledWith(
      { kind: "change", groupId: "orbit", repository: "appdev", number: 5 },
      { from: review },
    );
  });

  it("a crew task is said as its crewmate in its Mate's crew, and opens the crew task's review", async () => {
    const task = crewTaskReviewItem({
      environmentId: ENVIRONMENT,
      taskId: "task-7",
      title: "Write the scoring rules",
      by: { name: "Sid", tint: "sky", shape: "gem", crewOf: "Vira" },
      mine: true,
    });
    const { container } = await mount({ items: [change(4, "Add a due date"), task] });
    await press(tag(container, /^2 to review in Orbit$/u)!);
    expect(popover()?.textContent).toContain("2 to review in Orbit");
    const crew = popoverItems()[1]!;
    expect(crew.textContent).toContain("Sid, in Vira's crew");
    await press(crew);
    expect(effects.review).toHaveBeenCalledWith(
      { kind: "crew-task", environmentId: ENVIRONMENT, taskId: "task-7" },
      expect.anything(),
    );
  });

  it("the open popover follows the project: the count follows, and it closes when the last leaves", async () => {
    vi.useFakeTimers();
    try {
      const first = change(4, "Add a due date");
      const second = change(5, "Sort by priority");
      const third = change(6, "Archive done todos");
      const { container, rerender } = await mount({ items: [first, second, third] });
      await press(tag(container, /^3 to review in Orbit$/u)!);
      await rerender({ items: [first, third] });
      expect(popover()?.textContent).toContain("2 changes in Orbit");
      expect(tag(container, /^2 to review in Orbit$/u)).toBeDefined();
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(popoverItems()).toHaveLength(2);
      await rerender({ items: [] });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(popover()).toBeNull();
      expect(container.querySelector("button")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing when nothing waits", async () => {
    const { container } = await mount({ items: [], release: undefined });
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("a project's Release tag", () => {
  it.each([
    { release: { waiting: 3, atLeast: false }, says: "3 changes wait for production" },
    { release: { waiting: 1, atLeast: false }, says: "1 change waits for production" },
    { release: { waiting: 5, atLeast: true }, says: "At least 5 changes wait for production" },
  ])("opens the release review and says what waits: $says", async ({ release, says }) => {
    const { container } = await mount({ release });
    const tagged = tag(container, /^Release/u)!;
    // Its word, then how many wait where more than one does.
    expect(tagged.textContent).toBe(
      release.waiting > 1 ? `Release${String(release.waiting)}` : "Release",
    );
    expect(tagged.getAttribute("aria-label")).toBe(`Release: ${says}`);
    await press(tagged);
    expect(effects.review).toHaveBeenCalledWith(
      { kind: "release", groupId: "orbit" },
      { from: tagged },
    );
  });
});

describe("the tags inside a project's row", () => {
  it("a press on a tag never presses the row behind it", async () => {
    const { container, row } = await mount({
      items: [change(4, "Add a due date"), change(5, "Sort by priority")],
      release: { waiting: 2, atLeast: false },
    });
    await press(tag(container, /^Release/u)!);
    await press(tag(container, /to review in Orbit$/u)!);
    await press(popoverItems()[0]!);
    expect(row).not.toHaveBeenCalled();
  });
});
