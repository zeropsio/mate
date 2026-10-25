// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ReviewContext } from "~/zerops/review";

import type { WaitingItem, WaitingMate } from "./SidebarWaiting.logic";
import { waitingItemsOf } from "./SidebarWaiting.logic";

// A Mate's conversation, as the list reads it to answer in place: a question with its options.
const write = vi.hoisted(() => ({
  answer: vi.fn(() => Promise.resolve({ _tag: "Success" as const })),
  send: vi.fn(() => Promise.resolve({ _tag: "Success" as const })),
}));
vi.mock("~/zerops/useMateWrite", () => ({
  useMateWrite: () => ({
    shell: undefined,
    detail: { proposedPlans: [], latestTurn: null },
    requests: {
      approvals: [],
      userInputs: [
        {
          requestId: "ask-1",
          questions: [
            {
              id: "q",
              question: "Stripe or Adyen?",
              options: [{ label: "Stripe" }, { label: "Adyen" }],
            },
          ],
        },
      ],
    },
    send: write.send,
    answer: write.answer,
    decide: vi.fn(),
  }),
}));

import { SidebarChiefRow } from "./chief/SidebarChiefRow";
import { WaitingList } from "./SidebarWaiting";

const mate = (name: string, kind: WaitingMate["kind"], extra: Partial<WaitingMate> = {}) =>
  ({
    projectId: name.toLowerCase(),
    name,
    tint: "slate",
    shape: "squircle",
    face: "needs",
    kind,
    environmentId: "env",
    threadId: "thread",
    ...extra,
  }) satisfies WaitingMate;

const ITEMS: ReadonlyArray<WaitingItem> = waitingItemsOf({
  mates: [
    mate("Fen", "failed", { text: "The stage build failed: EXPO_TOKEN is missing." }),
    mate("Rhea", "question", { text: "Stripe or Adyen?" }),
    mate("Noibit", "change", {
      change: { groupId: "ledger", repository: "app", number: 31, title: "Nightly export" },
    }),
  ],
  releases: [{ groupId: "tea", name: "Tea Shop", ahead: 3 }],
});

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
  vi.clearAllMocks();
});

async function mount(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  unmounts.push(() => {
    root.unmount();
    container.remove();
  });
  return container;
}

const verbs = () => ({ onOpenMate: vi.fn(), onAskToFix: vi.fn() });
const press = async (element: Element | null | undefined) => {
  await act(async () => {
    (element as HTMLElement | null)?.click();
  });
};
const button = (container: HTMLElement, words: string) =>
  [...container.querySelectorAll("button")].find((entry) => entry.textContent === words);

// The owner, 2026-10-12, of a row of its own: "waiting on you is use less, it should be included
// in the overview somehow"; then of the Chief at the menu's top: its count stays, beside the squares.
describe("SidebarChiefRow — what waits on you, at the menu's top", () => {
  const top = (items: ReadonlyArray<WaitingItem>) => (
    <SidebarChiefRow current={false} onOpen={() => {}} waiting={{ items, verbs: verbs() }} />
  );

  it("says how many wait, the first two in plain words, then how many more", async () => {
    const container = await mount(top(ITEMS));
    expect(
      container.querySelector('[data-zerops-surface="sidebar-waiting-count"]')?.textContent,
    ).toBe("4");
    expect(
      container
        .querySelector('[data-zerops-surface="sidebar-waiting"]')
        ?.getAttribute("aria-label"),
    ).toBe("4 waiting on you: Help Fen · Answer Rhea, 2 more");
  });

  it("is not drawn while nothing waits", async () => {
    const container = await mount(top([]));
    expect(container.querySelector('[data-zerops-surface="sidebar-waiting"]')).toBeNull();
    expect(container.querySelector('[data-zerops-surface="sidebar-waiting-count"]')).toBeNull();
    expect(container.querySelector(".menu-chief-name")?.textContent).toBe("Chief");
  });
});

describe("WaitingList — what waits on you, each with its buttons", () => {
  it("names each thing and says it in its own words", async () => {
    const container = await mount(<WaitingList items={ITEMS} onClose={() => {}} verbs={verbs()} />);
    expect(
      [...container.querySelectorAll("[data-waiting-title]")].map((title) => title.textContent),
    ).toEqual(["Fen", "Rhea", "Noibit", "Tea Shop is ready to release"]);
    expect(container.textContent).toContain("3 changes are on stage, not yet in production.");
  });

  it("answers a question by its option, in place", async () => {
    const container = await mount(<WaitingList items={ITEMS} onClose={() => {}} verbs={verbs()} />);
    await press(button(container, "Adyen"));
    expect(write.answer).toHaveBeenCalledWith("ask-1", "q", "Adyen");
  });

  it("answers a question in words: Answer… opens a reply, Enter sends it", async () => {
    const container = await mount(<WaitingList items={ITEMS} onClose={() => {}} verbs={verbs()} />);
    await press(button(container, "Answer…"));
    const field = container.querySelector<HTMLInputElement>('input[aria-label="Your answer"]');
    expect(field).not.toBeNull();
    await act(async () => {
      if (field === null) return;
      field.value = "Stripe, for now";
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(write.answer).toHaveBeenCalledWith("ask-1", "q", "Stripe, for now");
  });

  it("asks a Mate of yours that stopped to fix it, with its error", async () => {
    const spy = verbs();
    const container = await mount(<WaitingList items={ITEMS} onClose={() => {}} verbs={spy} />);
    await press(button(container, "Ask Fen to fix it"));
    expect(spy.onAskToFix).toHaveBeenCalledWith(
      "fen",
      expect.objectContaining({ error: "The stage build failed: EXPO_TOKEN is missing." }),
    );
  });

  it.each([
    {
      words: "Review",
      target: { kind: "change", groupId: "ledger", repository: "app", number: 31 },
    },
    { words: "Review release", target: { kind: "release", groupId: "tea" } },
  ])("$words opens its review, the list closing first", async ({ words, target }) => {
    const openReview = vi.fn();
    const onClose = vi.fn();
    const container = await mount(
      <ReviewContext.Provider value={openReview}>
        <WaitingList items={ITEMS} onClose={onClose} verbs={verbs()} />
      </ReviewContext.Provider>,
    );
    await press(button(container, words));
    expect(onClose).toHaveBeenCalled();
    expect(openReview).toHaveBeenCalledWith(target);
  });
});
