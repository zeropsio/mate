import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { closeAccountLifetime, openAccountLifetime } from "../../zerops/accountLifetime";
import { InventoryContext, type Inventory } from "../../zerops/inventoryContext";
import { nextStepBeforeChanges, type ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import {
  ZeropsNextStepStrip,
  useZeropsNextStepStrip,
  zeropsComposerTop,
  type ZeropsNextStepPending,
  type ZeropsNextStepStripModel,
} from "./ZeropsNextStepBanner";

const PULL: FlowPullRequest = {
  repository: "app",
  number: 2,
  title: "Add a status page",
  kind: "code",
  mateProjectId: "p-nova",
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: "app #2",
  updatedAt: undefined,
};

const WAITING: ZeropsMateNextStep = {
  kind: "review",
  step: {
    kind: "review",
    pull: PULL,
    title: "Nova is waiting for your review of #2",
    detail: "Add a status page",
    lines: [],
    more: 0,
  },
  tint: "slate",
  shape: "squircle",
  target: { kind: "change", groupId: "g-1", repository: "app", number: 2 },
};

const NOTHING_PENDING: ZeropsNextStepPending = { question: false, approval: false, working: false };

const UNANSWERED: ZeropsMateNextStep = { kind: "unknown" };
const NOTHING: ZeropsMateNextStep = { kind: "none" };

/** Another change of the same Mate, waiting after #2 was dismissed. */
const WAITING_3 = {
  ...WAITING,
  step: {
    ...WAITING.step,
    title: "Nova is waiting for your review of #3",
    detail: "Fix the footer",
  },
  target: { kind: "change", groupId: "g-1", repository: "app", number: 3 },
} as ZeropsMateNextStep;

const SHOWN: ZeropsNextStepStripModel = {
  title: "Nova is waiting for your review of #2",
  detail: "Add a status page",
  tint: "slate",
  shape: "squircle",
  target: { kind: "change", groupId: "g-1", repository: "app", number: 2 },
};

const API_PULL: FlowPullRequest = {
  ...PULL,
  repository: "api",
  number: 2,
  title: "Rebuild the API",
};

/** Two of Nova's changes waiting: a count, and a line for each. */
const WAITING_TWO: ZeropsMateNextStep = {
  ...WAITING,
  step: {
    kind: "review",
    pull: API_PULL,
    title: "Nova is waiting for your review of 2 changes",
    detail: "Rebuild the API",
    lines: [
      { pull: API_PULL, label: "api #2 Rebuild the API" },
      { pull: PULL, label: "app #2 Add a status page" },
    ],
    more: 0,
  },
  target: { kind: "change", groupId: "g-1", repository: "api", number: 2 },
};

const SHOWN_TWO: ZeropsNextStepStripModel = {
  ...SHOWN,
  title: "Nova is waiting for your review of 2 changes",
  detail: "Rebuild the API",
  target: { kind: "change", groupId: "g-1", repository: "api", number: 2 },
  lines: [
    {
      label: "api #2 Rebuild the API",
      target: { kind: "change", groupId: "g-1", repository: "api", number: 2 },
    },
    {
      label: "app #2 Add a status page",
      target: { kind: "change", groupId: "g-1", repository: "app", number: 2 },
    },
  ],
};

describe("zeropsComposerTop", () => {
  it.each<{
    readonly case: string;
    readonly nextStep: ZeropsMateNextStep;
    readonly pending: ZeropsNextStepPending;
    readonly shown: ZeropsNextStepStripModel | null;
  }>([
    {
      case: "a change of this Mate's waits for review",
      nextStep: WAITING,
      pending: NOTHING_PENDING,
      shown: SHOWN,
    },
    { case: "nothing waits", nextStep: NOTHING, pending: NOTHING_PENDING, shown: null },
    // The Mate cannot go on until the person answers what the composer asks,
    // so the review is not a second ask stacked on it; it comes back after.
    {
      case: "a question waits on the person first",
      nextStep: WAITING,
      pending: { question: true, approval: false, working: false },
      shown: null,
    },
    {
      case: "an approval waits on the person first",
      nextStep: WAITING,
      pending: { question: false, approval: true, working: false },
      shown: null,
    },
    {
      case: "a question and an approval wait on the person first",
      nextStep: WAITING,
      pending: { question: true, approval: true, working: false },
      shown: null,
    },
    // While the Mate works — a turn, or helpers it started — its change is still moving: the
    // review it asks for would trail what the change does. It asks once the Mate rests.
    {
      case: "the Mate works",
      nextStep: WAITING,
      pending: { question: false, approval: false, working: true },
      shown: null,
    },
  ])("$case", ({ nextStep, pending, shown }) => {
    expect(zeropsComposerTop({ nextStep, dismissed: undefined, pending }).strip).toEqual(shown);
  });

  // Milo's run 4 (D1) and the paused witness: an idle conversation's composer stood 61 px taller
  // than a working one's, an empty band at its top, for a Mate whose review could never come.
  it.each([
    { placed: "a project not read yet", project: undefined, changesRead: false, reserved: true },
    { placed: "a project HQ has not placed yet", project: {}, changesRead: false, reserved: true },
    {
      placed: "a Mate HQ holds in no application",
      project: { hq: { appId: null, appName: null, kind: "mate", mate: { face: null } } },
      changesRead: false,
      reserved: false,
    },
    {
      placed: "a Mate in an application whose changes are unread",
      project: { hq: { appId: "app-1", appName: "Shop", kind: "mate", mate: null } },
      changesRead: false,
      reserved: true,
    },
  ] as const)(
    "the composer's top holds room for a review only while one may be on its way: $placed",
    ({ project, changesRead, reserved }) => {
      const nextStep = nextStepBeforeChanges(project as never, changesRead);
      expect(
        zeropsComposerTop({ nextStep: nextStep ?? { kind: "none" }, pending: NOTHING_PENDING })
          .reserved,
      ).toBe(reserved);
    },
  );

  it("reserves an unread review without painting source text", () => {
    expect(zeropsComposerTop({ nextStep: UNANSWERED, pending: NOTHING_PENDING })).toEqual({
      strip: null,
      reserved: true,
    });
  });
  it("a dismissed change stays away; another change shows", () => {
    const dismissed = JSON.stringify(["g-1", "app", 2]);
    expect(
      zeropsComposerTop({ nextStep: WAITING, dismissed, pending: NOTHING_PENDING }).strip,
    ).toBeNull();
    expect(
      zeropsComposerTop({ nextStep: WAITING_3, dismissed, pending: NOTHING_PENDING }).strip?.target
        .number,
    ).toBe(3);
  });
  it("shows current source lines for several waiting changes", () => {
    expect(zeropsComposerTop({ nextStep: WAITING_TWO, pending: NOTHING_PENDING }).strip).toEqual(
      SHOWN_TWO,
    );
  });
});

describe("ZeropsNextStepStrip", () => {
  const STRIP = SHOWN;

  it("reads as the composer's top: the Mate's face asking, the words, Review", () => {
    const markup = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={STRIP} />);

    expect(markup).toContain('data-mate-face-shape="squircle"');
    expect(
      renderToStaticMarkup(
        <ZeropsNextStepStrip onReview={() => {}} strip={{ ...STRIP, shape: "flower" }} />,
      ),
    ).toContain('data-mate-face-shape="flower"');

    expect(markup).toContain('data-composer-top="review"');
    expect(markup).toContain("Nova is waiting for your review of #2");
    expect(markup).toContain("Add a status page");
    expect(markup).toContain(">Review<");
    expect(markup).not.toContain("Merge");
  });

  it("opens the change's review from the button that was pressed", () => {
    const onReview = vi.fn();
    const tree = ZeropsNextStepStrip({ onReview, strip: STRIP }) as ReactElement;
    const button = visitElements(tree, (element) => element.type === "button");
    if (button === null) throw new Error("the strip has no Review button");
    const pressed = { tagName: "BUTTON" } as unknown as HTMLElement;
    (button.props.onClick as (event: { currentTarget: HTMLElement }) => void)({
      currentTarget: pressed,
    });

    expect(onReview).toHaveBeenCalledWith(
      { kind: "change", groupId: "g-1", repository: "app", number: 2 },
      pressed,
    );
  });

  it("lists every change waiting, each with its own Review, under a count", () => {
    const strip: ZeropsNextStepStripModel = {
      ...STRIP,
      title: "Nova is waiting for your review of 2 changes",
      detail: "Rebuild the API",
      lines: [
        {
          label: "apidev #1 Rebuild the API",
          target: { kind: "change", groupId: "g-1", repository: "apidev", number: 1 },
        },
        {
          label: "appdev #1 Build the site",
          target: { kind: "change", groupId: "g-1", repository: "appdev", number: 1 },
        },
      ],
    };
    const text = renderToStaticMarkup(<ZeropsNextStepStrip onReview={() => {}} strip={strip} />)
      .replace(/<[^>]*>/gu, " ")
      .replace(/\s+/gu, " ");
    expect(text).toContain("Nova is waiting for your review of 2 changes");
    expect(text).toContain("apidev #1 Rebuild the API Review");
    expect(text).toContain("appdev #1 Build the site Review");

    const onReview = vi.fn();
    const buttons: Array<ReactElement<Record<string, unknown>>> = [];
    visitElements(ZeropsNextStepStrip({ onReview, strip }) as ReactElement, (element) => {
      if (element.type === "button") buttons.push(element);
      return false;
    });
    expect(buttons).toHaveLength(3);
    const reviews = buttons.filter((button) => button.props["aria-label"] !== "Dismiss");
    expect(reviews).toHaveLength(2);
    const second = reviews[1];
    if (second === undefined) throw new Error("the second change has no Review");
    const pressed = { tagName: "BUTTON" } as unknown as HTMLElement;
    (second.props.onClick as (event: { currentTarget: HTMLElement }) => void)({
      currentTarget: pressed,
    });
    expect(onReview).toHaveBeenCalledWith(
      { kind: "change", groupId: "g-1", repository: "appdev", number: 1 },
      pressed,
    );
  });

  it("puts the strip away from its dismiss button, until another change waits", () => {
    const onDismiss = vi.fn();
    const tree = ZeropsNextStepStrip({
      onReview: () => {},
      onDismiss,
      strip: STRIP,
    }) as ReactElement;
    const button = visitElements(
      tree,
      (element) => element.type === "button" && element.props["aria-label"] === "Dismiss",
    );
    if (button === null) throw new Error("the strip has no dismiss button");
    const pressed = { tagName: "BUTTON" } as unknown as HTMLElement;
    (button.props.onClick as (event: { currentTarget: HTMLElement }) => void)({
      currentTarget: pressed,
    });

    expect(onDismiss).toHaveBeenCalledWith(
      { kind: "change", groupId: "g-1", repository: "app", number: 2 },
      pressed,
    );
  });

  it("puts a strip of several changes away from its dismiss button too", () => {
    const onDismiss = vi.fn();
    const tree = ZeropsNextStepStrip({
      onReview: () => {},
      onDismiss,
      strip: SHOWN_TWO,
    }) as ReactElement;
    const button = visitElements(
      tree,
      (element) => element.type === "button" && element.props["aria-label"] === "Dismiss",
    );
    if (button === null) throw new Error("the strip of several changes has no dismiss button");
    const pressed = { tagName: "BUTTON" } as unknown as HTMLElement;
    (button.props.onClick as (event: { currentTarget: HTMLElement }) => void)({
      currentTarget: pressed,
    });

    expect(onDismiss).toHaveBeenCalledWith(SHOWN_TWO.target, pressed);
  });
});

/** A reload's first render: the inventory, the registry and HQ all still unread. */
const UNREAD: Inventory = {
  projects: [],
  isLoading: true,
  error: null,
  projectRefs: new Map(),
  authority: new Map(),
  lost: new Set(),
};

const THREAD = scopeThreadRef(EnvironmentId.make("env-nova"), ThreadId.make("thread-1"));

function ComposerTop() {
  return (
    <>{useZeropsNextStepStrip(THREAD, { question: false, approval: false, working: false })}</>
  );
}

describe("the composer's top on a reload's first render", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
    openAccountLifetime("user-ales");
  });

  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("reserves the cold slot and ignores a saved source strip", () => {
    stored.set(
      "mate:account:user-ales:mate:zerops:composer-top-memory",
      JSON.stringify({
        "env-nova:thread-1": { title: "Old title", words: "Old review", number: 2 },
      }),
    );
    const markup = renderToStaticMarkup(
      <InventoryContext value={UNREAD}>
        <ComposerTop />
      </InventoryContext>,
    );
    expect(markup).toContain('data-composer-top="unread"');
    expect(markup).not.toContain("Old review");
    expect(markup).not.toContain('data-composer-top="review"');
  });
});
