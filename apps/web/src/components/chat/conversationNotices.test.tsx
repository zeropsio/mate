// @vitest-environment happy-dom
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import { deriveCrewView } from "@t3tools/client-runtime/zerops/projections/crew";
import { EnvironmentId, ThreadId, type CrewPromptVersion } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { crewChatNotices } from "../zerops/crew/crewChatNotices";
import { NoticeLine, type ConversationNotice } from "./ConversationRows";
import {
  branchChangedNotice,
  crewNextConversationNotice,
  noticesHome,
  personNoticeArrived,
  resumeCompactionNotice,
} from "./conversationNotices";
import { usageLimitsNotice } from "./UsageLimitsNotice";
import type { TimelineEntry } from "../../session-logic";

let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const show = async (notice: ConversationNotice) => {
  await act(() => root!.render(<NoticeLine notice={notice} />));
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  return {
    text: document.body.textContent,
    button: (name: string) =>
      buttons.find(
        (button) => button.textContent === name || button.getAttribute("aria-label") === name,
      ),
  };
};

describe("resuming an older session", () => {
  it.each([
    { unavailable: null, compacts: 1 },
    { unavailable: "Compacting is unavailable right now", compacts: 0 },
  ])(
    "keeps unavailable compaction disabled and offers the named dismissal",
    async ({ unavailable, compacts }) => {
      const compact = vi.fn();
      const keep = vi.fn();
      const row = await show(
        resumeCompactionNotice({
          key: "thread-1:2026-10-01T10:00:00.000Z",
          usedTokens: 250_000,
          unavailable,
          onCompact: compact,
          onKeepFullHistory: keep,
        }),
      );
      expect(row.text).toContain("Resume with less context");
      expect(row.text).toContain("250k tokens from an older session");
      await act(() => row.button("Compact")!.click());
      expect(row.button("Compact")!.disabled).toBe(compacts === 0);
      expect(compact).toHaveBeenCalledTimes(compacts);
      await act(() => row.button("Keep full history")!.click());
      expect(keep).toHaveBeenCalledOnce();
    },
  );
});

describe("a checkout on another branch", () => {
  it.each([
    { restoring: false, label: "Restore branch", restores: 1 },
    { restoring: true, label: "Restoring...", restores: 0 },
  ])(
    "names the branch the conversation ran on and the one it sends on, and restores it ($label)",
    async ({ restoring, label, restores }) => {
      const restore = vi.fn();
      const dismiss = vi.fn();
      const row = await show(
        branchChangedNotice({
          key: "thread-1:feat/checkout:main",
          mismatch: { threadBranch: "feat/checkout", currentBranch: "main" },
          restoring,
          onRestore: restore,
          onDismiss: dismiss,
        }),
      );
      expect(row.text).toContain("Branch changed — was feat/checkout");
      expect(row.text).toContain("sending continues on main");
      await act(() => row.button(label)!.click());
      expect(restore).toHaveBeenCalledTimes(restores);
      await act(() => row.button("Dismiss branch change notice")!.click());
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );
});

/** The crew's backend crewmate, running on `running` while `current` is its job and goal. */
function backend(running: CrewPromptVersion, current: CrewPromptVersion) {
  const snapshot = crewSnapshotFixture();
  const view = deriveCrewView(
    {
      ...snapshot,
      crewmates: snapshot.crewmates.map((crewmate) =>
        crewmate.handle === "backend"
          ? { ...crewmate, promptVersions: { running, current }, jobVersion: current.job }
          : crewmate,
      ),
    },
    [],
    () => {
      throw new Error("no shells here");
    },
  );
  return view.crewmates.find(({ crewmate }) => crewmate.handle === "backend")!;
}

describe("a crewmate whose job changed", () => {
  it.each([
    {
      current: { brief: 4, job: 5 },
      thread: "thread-crew-backend-2",
      says: "Its job changed. Its next message starts a fresh conversation.",
    },
    {
      current: { brief: 5, job: 4 },
      thread: "thread-crew-backend-2",
      says: "The crew's goal changed. Its next message starts a fresh conversation.",
    },
    { current: { brief: 4, job: 4 }, thread: "thread-crew-backend-2", says: null },
    // An earlier conversation goes on in the current one: what the next message brings is not its.
    { current: { brief: 4, job: 5 }, thread: "thread-crew-backend-1", says: null },
  ])(
    "says, in its current conversation, what its next message brings in: $says",
    async ({ current, thread, says }) => {
      const notice = crewNextConversationNotice(
        crewChatNotices(backend({ brief: 4, job: 4 }, current), ThreadId.make(thread)),
      );
      if (says === null) {
        expect(notice).toBeNull();
        return;
      }
      const row = await show(notice!);
      expect(row.text).toBe(says);
      expect(document.querySelector("button")).toBeNull();
    },
  );
});

describe("where a notice stands and whether it brings the end", () => {
  const message = { kind: "message", id: "m1", createdAt: "", message: {} } as TimelineEntry;
  const crewSeam = {
    kind: "work",
    id: "seam",
    createdAt: "",
    entry: { crewSeam: { seam: "stint" } },
  } as unknown as TimelineEntry;
  it.each([
    {
      name: "a fresh draft's hero",
      heroDraft: true,
      entries: [],
      working: false,
      home: "composer",
    },
    {
      name: "an empty conversation",
      heroDraft: false,
      entries: [],
      working: false,
      home: "composer",
    },
    {
      name: "a crewmate's conversation with only its seams",
      heroDraft: false,
      entries: [crewSeam],
      working: false,
      home: "composer",
    },
    {
      name: "a conversation at work",
      heroDraft: false,
      entries: [],
      working: true,
      home: "conversation",
    },
    {
      name: "a conversation with a message",
      heroDraft: false,
      entries: [message],
      working: false,
      home: "conversation",
    },
  ])("$name holds its notices in the $home", ({ heroDraft, entries, working, home }) => {
    expect(noticesHome({ heroDraft, entries, isWorking: working, queued: 0 })).toBe(home);
  });

  const notice = (id: string, byPerson = false) =>
    ({ id, icon: null, words: id, ...(byPerson ? { byPerson } : {}) }) as ConversationNotice;
  it.each([
    {
      name: "the person's /usage-limits answer arriving",
      before: [],
      now: [notice("usage-limits:1", true)],
      brings: true,
    },
    {
      name: "the same answer still standing",
      before: ["usage-limits:1"],
      now: [notice("usage-limits:1", true)],
      brings: false,
    },
    {
      name: "a feedback result arriving on its own",
      before: [],
      now: [notice("feedback:1")],
      brings: false,
    },
    {
      name: "the branch advice the person's keystroke revealed",
      before: ["feedback:1"],
      now: [notice("feedback:1"), notice("branch-changed:t", true)],
      brings: true,
    },
  ])("$name brings the conversation to its end: $brings", ({ before, now, brings }) => {
    expect(personNoticeArrived(new Set(before), now)).toBe(brings);
  });

  it.each([
    {
      name: "usage limits",
      notice: usageLimitsNotice(
        "usage-limits:1",
        { createdAt: "2026-10-12T10:00:00.000Z", accounts: [], notices: [] },
        EnvironmentId.make("env"),
        () => {},
      ),
    },
    {
      name: "a changed branch",
      notice: branchChangedNotice({
        key: "k",
        mismatch: { threadBranch: "a", currentBranch: "b" },
        restoring: false,
        onRestore() {},
        onDismiss() {},
      }),
    },
  ])("$name is the person's own doing", ({ notice }) => {
    expect(notice.byPerson).toBe(true);
  });
});
