// @vitest-environment happy-dom
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The shared minute clock runs a window timer: a card reads a fixed now here.
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => 0 }));

import { CardChanges } from "./ProjectCards";
import type { CardChange } from "./projectCard.logic";

function pull(over: Partial<FlowPullRequest> = {}): FlowPullRequest {
  return {
    repository: "app",
    number: 1,
    title: "Promo microsite: rules and the receipt upload",
    kind: "code",
    mateProjectId: "p-rossy",
    url: undefined,
    mergeability: "mergeable",
    behind: false,
    merged: false,
    mergedAt: undefined,
    headSha: "abc",
    baseBranch: "main",
    line: "app #1",
    updatedAt: undefined,
    ...over,
  };
}

const OPEN: CardChange = {
  pull: pull(),
  open: true,
  words: "Ready to merge",
  tone: "off",
  at: undefined,
};
const MERGED: CardChange = {
  pull: pull({ number: 2, title: "The group's import files", merged: true }),
  open: false,
  words: "Merged",
  tone: "off",
  at: undefined,
};

const unmounts: Array<() => void> = [];
afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

async function mount(onOpen: (change: CardChange) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <CardChanges
        changes={[OPEN, MERGED]}
        mateName={() => "Rossy"}
        onOpen={(change) => {
          onOpen(change);
        }}
      />,
    );
  });
  unmounts.push(() => {
    root.unmount();
    container.remove();
  });
  return container;
}

// The owner, 2026-10-12, of a change on the overview's card: "the fact that you can't open
// review from this place, that it's more limited in functionality than the left menu, is
// ridiculous".
describe("a card's changes", () => {
  it("offers Review on a change still open, as the menu does, and Review opens it", async () => {
    const opened = vi.fn();
    const container = await mount(opened);
    const reviews = [
      ...container.querySelectorAll<HTMLElement>('[data-zerops-surface="card-change-review"]'),
    ];
    expect(reviews.map((review) => review.closest("li")?.textContent)).toEqual([
      expect.stringContaining(OPEN.pull.title),
    ]);
    await act(async () => {
      reviews[0]!.click();
    });
    expect(opened).toHaveBeenCalledWith(OPEN);
  });
});

describe("a card with no change to list", () => {
  it.each([
    {
      case: "HQ told it none",
      known: true,
      failure: undefined,
      says: "No changes yet",
    },
    {
      case: "HQ refuses its changes to this person",
      known: true,
      failure:
        "You need at least Basic user access to one of this project's Zerops projects to see its changes.",
      says: "You need at least Basic user access",
    },
    { case: "HQ has not told them yet", known: false, failure: undefined, says: null },
  ])("says only what is true when $case", async ({ known, failure, says }) => {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <CardChanges
          changes={[]}
          changesFailure={failure}
          changesKnown={known}
          mateName={() => undefined}
          onOpen={() => {}}
        />,
      );
    });
    unmounts.push(() => root.unmount());
    const text = container.textContent ?? "";
    if (says === null) expect(text).toBe("Changes");
    else expect(text).toContain(says);
    if (failure !== undefined) expect(text).not.toContain("No changes yet");
  });
});
