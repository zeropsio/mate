import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  changeReviewItem,
  crewTaskReviewItem,
  releaseCount,
  releaseTagTip,
  reviewItemByline,
  reviewListWithLeaving,
  reviewPopoverTitle,
  reviewMarkOf,
  reviewTagLabel,
  headerReviewItems,
  taskReviewItems,
  type ProjectReviewItem,
} from "./SidebarProjectReview.logic";

const pull = (
  repository: string,
  number: number,
  title = `Change ${String(number)}`,
  mateProjectId = "mate-vira",
): FlowPullRequest =>
  ({
    repository,
    number,
    title,
    kind: "code",
    mateProjectId,
    url: undefined,
    mergeability: "clean",
    behind: false,
    merged: false,
    mergedAt: undefined,
  }) as unknown as FlowPullRequest;

const VIRA = { name: "Vira", tint: "amber", shape: "clover" } as const;
const ENVIRONMENT = EnvironmentId.make("environment-orbit");

const item = (key: string, input: Partial<ProjectReviewItem> = {}): ProjectReviewItem => ({
  ...changeReviewItem({
    pull: pull("appdev", Number(key)),
    among: [],
    groupId: "orbit",
    by: VIRA,
    mine: true,
  }),
  ...input,
});

describe("a change as a review item", () => {
  it.each([
    {
      case: "one repository: the number alone",
      among: [pull("appdev", 4), pull("appdev", 5, "Other", "mate-theo")],
      label: "#4",
    },
    {
      case: "the project's changes span repositories: the repository leads",
      among: [pull("appdev", 4), pull("apidev", 2, "Other", "mate-theo")],
      label: "appdev #4",
    },
    { case: "nothing beside it", among: [], label: "#4" },
  ])("is labelled by its number, with its repository where several: $case", ({ among, label }) => {
    const review = changeReviewItem({
      pull: pull("appdev", 4, "Add a due date to each todo"),
      among,
      groupId: "orbit",
      by: VIRA,
      mine: true,
    });
    expect(review.label).toBe(label);
    expect(review.title).toBe("Add a due date to each todo");
  });

  it("opens that change's review and is keyed as the menu keys the change", () => {
    const review = changeReviewItem({
      pull: pull("appdev", 4),
      among: [],
      groupId: "orbit",
      by: VIRA,
      mine: true,
    });
    expect(review.key).toBe("appdev#4");
    expect(review.target).toEqual({
      kind: "change",
      groupId: "orbit",
      repository: "appdev",
      number: 4,
    });
  });

  it("a crew task is keyed by its environment and task, and opens the crew task's review", () => {
    const review = crewTaskReviewItem({
      environmentId: ENVIRONMENT,
      taskId: "task-7",
      title: "Write the scoring rules",
      by: { ...VIRA, name: "Sid", crewOf: "Vira" },
      mine: true,
    });
    expect(review.key).toBe("crew:environment-orbit:task-7");
    expect(review.target).toEqual({
      kind: "crew-task",
      environmentId: ENVIRONMENT,
      taskId: "task-7",
    });
  });
});

describe("what a review item says under its title", () => {
  it.each([
    { case: "the viewer's Mate", by: VIRA, mine: true, says: "Vira · #12" },
    {
      case: "a colleague's Mate, in review",
      by: { ...VIRA, ownerFirstName: "Theo" },
      mine: false,
      says: "Vira · Theo's · #12 · in review",
    },
    {
      case: "a colleague's Mate whose review waits on the viewer",
      by: { ...VIRA, ownerFirstName: "Theo" },
      mine: true,
      says: "Vira · Theo's · #12",
    },
    { case: "nobody named", by: undefined, mine: true, says: "#12" },
  ])("names who made it and its number: $case", ({ by, mine, says }) => {
    expect(
      reviewItemByline(
        changeReviewItem({ pull: pull("appdev", 12), among: [], groupId: "orbit", by, mine }),
      ),
    ).toBe(says);
  });

  it("a crew task names its crewmate in its Mate's crew", () => {
    const review = crewTaskReviewItem({
      environmentId: ENVIRONMENT,
      taskId: "task-7",
      title: "Write the scoring rules",
      by: { ...VIRA, name: "Sid", crewOf: "Ada" },
      mine: true,
    });
    expect(reviewItemByline(review)).toBe("Sid, in Ada's crew");
  });
});

describe("the Review tag's words", () => {
  it("names the one change it opens, or how many wait in the project", () => {
    const one = item("4", { title: "Add a due date" });
    expect(reviewTagLabel([one], "Orbit")).toBe("Review Add a due date");
    expect(reviewTagLabel([item("4"), item("5"), item("6")], "Orbit")).toBe("3 to review in Orbit");
  });

  it("the popover counts changes, or what is to review when crew tasks are among them", () => {
    expect(reviewPopoverTitle([item("4"), item("5")], "Orbit")).toBe("2 changes in Orbit");
    const task = crewTaskReviewItem({
      environmentId: ENVIRONMENT,
      taskId: "task-7",
      title: "Write the scoring rules",
      by: { ...VIRA, name: "Sid", crewOf: "Vira" },
      mine: true,
    });
    expect(reviewPopoverTitle([item("4"), task], "Orbit")).toBe("2 to review in Orbit");
  });
});

// Eli, 2026-10-14: "why is MR not showing up anywhere" — the menu dropped the change for the
// fifteen minutes its Mate's background checks ran.
describe("the menu's mark of a project's changes", () => {
  const working = (key: string, title?: string) => ({
    ...item(key, title === undefined ? {} : { title }),
    inProgress: true as const,
  });
  it.each([
    {
      name: "asks for review while a change waits on it",
      items: [item("4", { title: "Add a due date" })],
      mark: { asks: true, count: 1, label: "Review Add a due date" },
    },
    {
      name: "stays, asking for no review, while its Mate still works on its one change",
      items: [working("4", "Add a due date")],
      mark: { asks: false, count: 1, label: "In progress: Add a due date" },
    },
    {
      name: "stays, asking for no review, while its Mate still works on several",
      items: [working("4"), working("5")],
      mark: { asks: false, count: 2, label: "2 changes in progress in Orbit" },
    },
    {
      name: "counts only what asks for review while some others are in progress",
      items: [item("4", { title: "Add a due date" }), working("5")],
      mark: { asks: true, count: 1, label: "Review Add a due date" },
    },
  ])("$name", ({ items, mark }) => {
    expect(reviewMarkOf(items, "Orbit")).toEqual(mark);
  });
});

// A run 2 follow-up: the header's Review work came while the Mate still worked, went, and came
// back twelve seconds before its answer.
describe("what the conversation's header asks to review", () => {
  it.each([
    { name: "its Mate's change that asks", items: [item("1")], shown: ["appdev#1"] },
    {
      name: "nothing while its Mate still works on it",
      items: [item("1", { inProgress: true })],
      shown: [],
    },
    {
      name: "nothing of another Mate's",
      items: [item("1", { mateProjectId: "mate-nova" })],
      shown: [],
    },
  ])("$name", ({ items, shown }) => {
    expect(headerReviewItems(items, "mate-vira").map((one) => one.key)).toEqual(shown);
  });

  // The menu's word of the Mate (HQ's) said it rested while the conversation said it worked: the
  // header goes by the conversation, as the composer's strip does.
  it("asks for nothing while the conversation's Mate works, whatever the menu's word says", () => {
    expect(headerReviewItems([item("1")], "mate-vira", { mateWorks: true })).toEqual([]);
    expect(
      headerReviewItems([item("1")], "mate-vira", { mateWorks: false }).map((one) => one.key),
    ).toEqual(["appdev#1"]);
  });
});

// The owner, 2026-10-19: "why is this different from the normal mate?" An automated Mate's task
// conversation holds the same app-bar Review as a normal Mate's, led by the task it shows.
describe("an automated Mate's task conversation's app-bar Review", () => {
  it.each([
    {
      name: "the door opens the change of the task the conversation shows, and says how many more wait",
      items: [item("1"), item("2"), item("3")],
      change: { repo: "appdev", number: 2 },
      shown: ["appdev#2", "appdev#1", "appdev#3"],
    },
    {
      name: "a task whose change does not wait leaves the Mate's others in the flow's order",
      items: [item("1"), item("3")],
      change: { repo: "appdev", number: 2 },
      shown: ["appdev#1", "appdev#3"],
    },
    {
      name: "a task with no change yet leaves the Mate's others in the flow's order",
      items: [item("1"), item("3")],
      change: null,
      shown: ["appdev#1", "appdev#3"],
    },
    {
      name: "the same number in another repository is another change",
      items: [item("1"), item("2")],
      change: { repo: "apidev", number: 2 },
      shown: ["appdev#1", "appdev#2"],
    },
  ])("$name", ({ items, change, shown }) => {
    expect(taskReviewItems(items, change).map((one) => one.key)).toEqual(shown);
  });
});

describe("the Release tag's tooltip", () => {
  it.each([
    { waiting: 0, atLeast: false, says: "Ready for production" },
    { waiting: 1, atLeast: false, says: "1 change waits for production" },
    { waiting: 3, atLeast: false, says: "3 changes wait for production" },
    { waiting: 1, atLeast: true, says: "At least 1 change waits for production" },
    { waiting: 20, atLeast: true, says: "At least 20 changes wait for production" },
  ])("says what waits for production: $says", ({ waiting, atLeast, says }) => {
    expect(releaseTagTip({ waiting, atLeast })).toBe(says);
  });
});

describe("the Release tag's count", () => {
  it.each([
    { waiting: 700, atLeast: false, changeCount: 1, count: 1, plus: false },
    { waiting: 40, atLeast: true, changeCount: 3, count: 3, plus: false },
    { waiting: 5, atLeast: false, changeCount: undefined, count: 5, plus: false },
    { waiting: 20, atLeast: true, changeCount: undefined, count: 20, plus: true },
    { waiting: 2, atLeast: false, changeCount: 0, count: 2, plus: false },
  ])(
    "counts the changes HQ counted, never every commit a history brought: $waiting commits, $changeCount changes",
    ({ waiting, atLeast, changeCount, count, plus }) => {
      expect(releaseCount({ waiting, atLeast, changeCount })).toEqual({ count, atLeast: plus });
    },
  );

  it("its tooltip names the changes, not the commits", () => {
    expect(releaseTagTip({ waiting: 700, atLeast: false, changeCount: 1 })).toBe(
      "1 change waits for production",
    );
  });
});

describe("the popover's list while it is open", () => {
  const keys = (shown: ReturnType<typeof reviewListWithLeaving>) =>
    shown.map((entry) => `${entry.item.key}${entry.leaving ? " (leaving)" : ""}`);
  const start = (items: ReadonlyArray<ProjectReviewItem>) => reviewListWithLeaving([], items);

  it("lists the project's items oldest first, as the flow gives them", () => {
    expect(keys(start([item("4"), item("5"), item("6")]))).toEqual([
      "appdev#4",
      "appdev#5",
      "appdev#6",
    ]);
  });

  it("an item that leaves stays where it was, leaving, until it has faded", () => {
    const shown = start([item("4"), item("5"), item("6")]);
    expect(keys(reviewListWithLeaving(shown, [item("4"), item("6")]))).toEqual([
      "appdev#4",
      "appdev#5 (leaving)",
      "appdev#6",
    ]);
  });

  it("an item that arrives takes its place in the flow's order", () => {
    const shown = start([item("4"), item("6")]);
    expect(keys(reviewListWithLeaving(shown, [item("4"), item("5"), item("6")]))).toEqual([
      "appdev#4",
      "appdev#5",
      "appdev#6",
    ]);
    expect(keys(reviewListWithLeaving(shown, [item("3"), item("4"), item("6")]))).toEqual([
      "appdev#3",
      "appdev#4",
      "appdev#6",
    ]);
  });

  it("an item that comes back while it fades is simply there again", () => {
    const leaving = reviewListWithLeaving(start([item("4"), item("5")]), [item("4")]);
    expect(keys(reviewListWithLeaving(leaving, [item("4"), item("5")]))).toEqual([
      "appdev#4",
      "appdev#5",
    ]);
  });

  it("an item's newer words replace its old ones", () => {
    const shown = start([item("4", { title: "Old" })]);
    const next = reviewListWithLeaving(shown, [item("4", { title: "New" })]);
    expect(next.map((entry) => entry.item.title)).toEqual(["New"]);
  });
});
