import { describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";

import { chooseJumpItem, type JumpBoxModel, type JumpPages } from "./JumpBox";
import { EMPTY_JUMP_INDEX, jumpGroups, type JumpMate } from "./JumpBox.logic";

const JAGO: JumpMate = {
  projectId: "apps-jago",
  name: "Jago",
  tint: "slate",
  shape: "squircle",
  face: "idle",
  projectName: "Acme Apps",
  subject: undefined,
  snippet: undefined,
  environmentId: "env-apps-jago",
  connected: true,
  conversation: { threadId: "thread-apps-jago", kind: "idle" },
  owner: undefined,
  pausedUntil: undefined,
  mine: true,
};

/** What choosing the first row for `typed` does: the Mate it opens, the Mate it picks to write to. */
function choose(typed: string) {
  const [item] = jumpGroups({ ...EMPTY_JUMP_INDEX, mates: [JAGO] }, typed, []).flatMap(
    (group) => group.items,
  );
  const opened: string[] = [];
  const picked: string[] = [];
  const model = {
    pick: (mate: JumpMate) => picked.push(mate.name),
  } as unknown as JumpBoxModel;
  const pages: JumpPages = {
    openMate: (mate) => opened.push(mate.name),
    openProject: vi.fn(),
    openStop: vi.fn(),
    openChange: vi.fn(),
    newProject: vi.fn(),
  };
  chooseJumpItem(item!, { model, close: () => {}, showable: true, pages });
  return { opened, picked };
}

describe("choosing in the jump box", () => {
  it.each(["Jago", "jag", "ja"])(
    "jumping to a Mate by its name, typed as %j, opens it and leaves no draft",
    (typed) => {
      const drafts = useComposerDraftStore.getState().draftsByThreadKey;
      expect(choose(typed)).toEqual({ opened: ["Jago"], picked: [] });
      expect(useComposerDraftStore.getState().draftsByThreadKey).toBe(drafts);
    },
  );

  it("writing to a Mate after @ picks it to write to, and opens nothing", () => {
    const drafts = useComposerDraftStore.getState().draftsByThreadKey;
    expect(choose("@jago")).toEqual({ opened: [], picked: ["Jago"] });
    expect(useComposerDraftStore.getState().draftsByThreadKey).toBe(drafts);
  });
});
