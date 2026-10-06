import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { closeAccountLifetime, openAccountLifetime } from "../../zerops/accountLifetime";
import {
  rememberComposerTop,
  withComposerTop,
  type ComposerTopMemory,
  type RememberedComposerTop,
} from "../../zerops/composerTopMemory";
import { InventoryContext, type Inventory } from "../../zerops/inventoryContext";
import type { ZeropsMateNextStep } from "../../zerops/useZeropsMateNextStep";
import hookSource from "../../zerops/useZeropsMateNextStep.ts?raw";
import stripSource from "./ZeropsNextStepBanner.tsx?raw";
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

/** What the composer's top showed of #2 — and what a reload paints of it. */
const REMEMBERED: RememberedComposerTop = {
  groupId: "g-1",
  repository: "app",
  number: 2,
  title: "Add a status page",
  words: "Nova is waiting for your review of #2",
  tint: "slate",
  shape: "squircle",
};

const DISMISSED: RememberedComposerTop = { ...REMEMBERED, dismissed: true };

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

const REMEMBERED_TWO: RememberedComposerTop = {
  ...REMEMBERED,
  repository: "api",
  title: "Rebuild the API",
  words: "Nova is waiting for your review of 2 changes",
  lines: [
    { repository: "api", number: 2, label: "api #2 Rebuild the API" },
    { repository: "app", number: 2, label: "app #2 Add a status page" },
  ],
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
    expect(zeropsComposerTop({ nextStep, remembered: undefined, pending }).strip).toEqual(shown);
  });

  // A reload paints the strip the conversation showed last, and HQ's answer
  // — seconds later — confirms it, changes its words, or takes it away: the
  // composer grows 61 px only where nothing was remembered.
  it.each<{
    readonly case: string;
    readonly memory: ComposerTopMemory;
    readonly threadKey: string;
    readonly answers: ReadonlyArray<ZeropsMateNextStep>;
    readonly shown: ReadonlyArray<ZeropsNextStepStripModel | null>;
    readonly remembered: RememberedComposerTop | undefined;
  }>([
    {
      case: "remembered, then confirmed",
      memory: { "env-nova:thread-1": REMEMBERED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING],
      shown: [SHOWN, SHOWN],
      remembered: REMEMBERED,
    },
    {
      case: "remembered, then gone: merged or closed elsewhere meanwhile",
      memory: { "env-nova:thread-1": REMEMBERED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, NOTHING],
      shown: [SHOWN, null],
      remembered: undefined,
    },
    {
      case: "nothing remembered, then live",
      memory: {},
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING],
      shown: [null, SHOWN],
      remembered: REMEMBERED,
    },
    {
      case: "two waiting: remembered with their lines, so a reload paints the strip it keeps",
      memory: { "env-nova:thread-1": REMEMBERED_TWO },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING_TWO],
      shown: [SHOWN_TWO, SHOWN_TWO],
      remembered: REMEMBERED_TWO,
    },
    {
      case: "another conversation's memory, never used",
      memory: { "env-nova:thread-2": REMEMBERED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED],
      shown: [null],
      remembered: undefined,
    },
    {
      case: "dismissed, and the same change still waits: it stays away",
      memory: { "env-nova:thread-1": DISMISSED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING],
      shown: [null, null],
      remembered: DISMISSED,
    },
    {
      case: "dismissed, then another change waits: that one shows",
      memory: { "env-nova:thread-1": DISMISSED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING_3],
      shown: [
        null,
        {
          ...SHOWN,
          title: "Nova is waiting for your review of #3",
          detail: "Fix the footer",
          target: { ...SHOWN.target, number: 3 },
        },
      ],
      remembered: {
        ...REMEMBERED,
        number: 3,
        title: "Fix the footer",
        words: "Nova is waiting for your review of #3",
      },
    },
    {
      case: "two waiting, dismissed: the strip stays away while they wait",
      memory: { "env-nova:thread-1": { ...REMEMBERED_TWO, dismissed: true } },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING_TWO],
      shown: [null, null],
      remembered: { ...REMEMBERED_TWO, dismissed: true },
    },
    {
      case: "dismissed, then nothing waits: forgotten",
      memory: { "env-nova:thread-1": DISMISSED },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, NOTHING],
      shown: [null, null],
      remembered: undefined,
    },
    {
      case: "remembered, and the change's title changed since",
      memory: { "env-nova:thread-1": { ...REMEMBERED, title: "Add a /status page" } },
      threadKey: "env-nova:thread-1",
      answers: [UNANSWERED, WAITING],
      shown: [{ ...SHOWN, detail: "Add a /status page" }, SHOWN],
      remembered: REMEMBERED,
    },
  ])("$case", ({ memory, threadKey, answers, shown, remembered }) => {
    let held = memory;
    const drawn = answers.map((nextStep) => {
      const top = zeropsComposerTop({
        nextStep,
        remembered: held[threadKey],
        pending: NOTHING_PENDING,
      });
      if (top.remember !== undefined) held = withComposerTop(held, threadKey, top.remember);
      return top.strip;
    });
    expect(drawn).toEqual(shown);
    expect(held[threadKey]).toEqual(remembered);
  });

  it("keeps the remembered face's tint until the Mate is known", () => {
    const top = zeropsComposerTop({
      nextStep: { ...WAITING, tint: undefined } as ZeropsMateNextStep,
      remembered: { ...REMEMBERED, tint: "sky" },
      pending: NOTHING_PENDING,
    });
    expect(top.strip?.tint).toBe("sky");
    expect(top.remember).toEqual({ ...REMEMBERED, tint: "sky" });
  });

  /** A reload paints the face it will keep: the shape is remembered with the tint. */
  it.each<{
    readonly name: string;
    readonly nextStep: ZeropsMateNextStep;
    readonly remembered: RememberedComposerTop | undefined;
    readonly shape: string | undefined;
  }>([
    {
      name: "remembers the shape a Mate's person picked",
      nextStep: { ...WAITING, tint: "rose", shape: "seal" } as ZeropsMateNextStep,
      remembered: undefined,
      shape: "seal",
    },
    {
      name: "keeps the remembered shape until the Mate is known",
      nextStep: { ...WAITING, tint: undefined, shape: undefined } as ZeropsMateNextStep,
      remembered: { ...REMEMBERED, tint: "rose", shape: "seal" },
      shape: "seal",
    },
    {
      name: "paints a remembered shape until HQ answers",
      nextStep: UNANSWERED,
      remembered: { ...REMEMBERED, tint: "rose", shape: "seal" },
      shape: "seal",
    },
    {
      name: "takes the known Mate's shape over what was remembered",
      nextStep: { ...WAITING, tint: "rose", shape: "gem" } as ZeropsMateNextStep,
      remembered: { ...REMEMBERED, tint: "rose", shape: "seal" },
      shape: "gem",
    },
  ])("$name", ({ nextStep, remembered, shape }) => {
    const top = zeropsComposerTop({ nextStep, remembered, pending: NOTHING_PENDING });
    expect(top.strip?.shape).toBe(shape);
    if (top.remember !== undefined) expect(top.remember?.shape).toBe(shape);
  });

  it("holds the memory while a question waits, and leaves it as it was", () => {
    const top = zeropsComposerTop({
      nextStep: UNANSWERED,
      remembered: REMEMBERED,
      pending: { question: true, approval: false, working: false },
    });
    expect(top).toEqual({ strip: null, remember: undefined });
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

  // Nothing merges from the composer any more (R1): the strip and the hook
  // behind it read the project's flow and open the review, whose own button
  // merges after the change can be read.
  it.each([
    { file: "ZeropsNextStepBanner.tsx", source: stripSource, reads: "openReview(target" },
    { file: "useZeropsMateNextStep.ts", source: hookSource, reads: "mateNextStep({" },
  ])("$file has no path that merges", ({ source, reads }) => {
    expect(source).toContain(reads);
    expect(source).not.toMatch(/flowVerbKey|\.merge\b|merge:/);
  });
});

/** A reload's first render: the inventory, the registry and HQ all still unread. */
const UNREAD: Inventory = {
  projects: [],
  isLoading: true,
  error: null,
  projectRefs: new Map(),
  authority: new Map(),
  account: { kind: "authorized" },
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

  // The strip is painted before HQ answers, from what the conversation
  // showed last, so the composer never grows 61 px under a settled page.
  it.each<{
    readonly case: string;
    readonly remembered: Readonly<Record<string, RememberedComposerTop>>;
    readonly painted: boolean;
  }>([
    {
      case: "remembered for this conversation",
      remembered: { "env-nova:thread-1": REMEMBERED },
      painted: true,
    },
    {
      case: "remembered for another conversation only",
      remembered: { "env-nova:thread-2": REMEMBERED },
      painted: false,
    },
    { case: "nothing remembered", remembered: {}, painted: false },
  ])("$case: painted $painted", ({ remembered, painted }) => {
    for (const [threadKey, top] of Object.entries(remembered)) {
      rememberComposerTop(threadKey, top);
    }
    const markup = renderToStaticMarkup(
      <InventoryContext value={UNREAD}>
        <ComposerTop />
      </InventoryContext>,
    );

    expect(markup.includes('data-composer-top="review"')).toBe(painted);
    expect(markup.includes("Nova is waiting for your review of #2")).toBe(painted);
    expect(markup.includes("Add a status page")).toBe(painted);
  });
});
