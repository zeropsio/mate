import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";

import { INLINE_PICTURE_PLACEHOLDER as P } from "./lib/composerPictures";
import {
  MAX_STASH_ENTRIES,
  PROMPT_STASH_STORAGE_KEY,
  MAX_STASH_ENTRY_ATTACHMENT_CHARS,
  partitionStashAttachments,
  restoreStashedPictures,
  usePromptStashStore,
  writePromptStashStorageForTest,
  type PromptStashEntry,
} from "./promptStashStore";

function makeEntry(input: {
  id: string;
  prompt?: string;
  attachmentChars?: number;
}): PromptStashEntry {
  return {
    id: input.id,
    createdAt: "2026-07-24T12:00:00.000Z",
    prompt: input.prompt ?? `prompt ${input.id}`,
    attachments:
      input.attachmentChars !== undefined
        ? [
            {
              id: `${input.id}-img`,
              name: "shot.png",
              mimeType: "image/png",
              sizeBytes: input.attachmentChars,
              dataUrl: "x".repeat(input.attachmentChars),
            },
          ]
        : [],
    droppedImageNames: [],
  };
}

function resetPromptStashStore() {
  usePromptStashStore.setState({ entries: [] });
  writePromptStashStorageForTest("");
  removeLocalStorageItem(PROMPT_STASH_STORAGE_KEY);
}

describe("restoreStashedPictures", () => {
  const saved = (id: string, name = `${id}.png`) => ({
    id,
    name,
    mimeType: "image/png",
    sizeBytes: 3,
    dataUrl: "data:image/png;base64,AQID",
  });
  const entry = (
    attachments: ReadonlyArray<ReturnType<typeof saved>>,
    pictureIds?: ReadonlyArray<string>,
  ): PromptStashEntry => ({
    id: "entry",
    createdAt: "2026-09-29T12:00:00.000Z",
    prompt: `a${P}b${P}c${P}`,
    attachments,
    droppedImageNames: [],
    ...(pictureIds ? { pictureIds } : {}),
  });
  const restore = (
    stashed: PromptStashEntry,
    options: { heldIds?: ReadonlyArray<string>; room?: number; unreadable?: string } = {},
  ) => {
    const restored = restoreStashedPictures(stashed, {
      heldIds: new Set(options.heldIds ?? []),
      room: options.room ?? 10,
      hydrate: (attachments) =>
        attachments.filter((attachment) => attachment.id !== options.unreadable),
    });
    return { ...restored, images: restored.images.map((image) => image.id) };
  };

  it.each([
    [
      "every picture back in its place",
      entry([saved("one"), saved("two"), saved("three")], ["one", "two", "three"]),
      {},
      { prompt: `a${P}b${P}c${P}`, images: ["one", "two", "three"], unrestoredNames: [] },
    ],
    [
      "a picture dropped when it was stashed leaves its own place",
      entry([saved("one"), saved("three")], ["one", "two", "three"]),
      {},
      { prompt: `a${P}bc${P}`, images: ["one", "three"], unrestoredNames: [] },
    ],
    [
      "pictures past the composer's room stay out, named, and so do their places",
      entry([saved("one"), saved("two"), saved("three")], ["one", "two", "three"]),
      { room: 1 },
      { prompt: `a${P}bc`, images: ["one"], unrestoredNames: ["two.png", "three.png"] },
    ],
    [
      "two alike pictures both come back",
      entry(
        [saved("one", "image.png"), saved("two", "image.png"), saved("three")],
        ["one", "two", "three"],
      ),
      {},
      { prompt: `a${P}b${P}c${P}`, images: ["one", "two", "three"], unrestoredNames: [] },
    ],
    [
      "a picture the composer holds already does not come twice",
      entry([saved("one"), saved("two"), saved("three")], ["one", "two", "three"]),
      { heldIds: ["two"] },
      { prompt: `a${P}bc${P}`, images: ["one", "three"], unrestoredNames: [] },
    ],
    [
      "a picture that cannot be read back leaves its place",
      entry([saved("one"), saved("two"), saved("three")], ["one", "two", "three"]),
      { unreadable: "one" },
      { prompt: `ab${P}c${P}`, images: ["two", "three"], unrestoredNames: [] },
    ],
    [
      "a prompt stashed before pictures were named loses places from its end",
      entry([saved("one"), saved("three")]),
      {},
      { prompt: `a${P}b${P}c`, images: ["one", "three"], unrestoredNames: [] },
    ],
  ])("%s", (_label, stashed, options, expected) => {
    expect(restore(stashed, options)).toEqual(expected);
  });
});

describe("partitionStashAttachments", () => {
  it("keeps attachments within the budget and reports dropped names in order", () => {
    const small = {
      id: "a",
      name: "small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const huge = {
      id: "b",
      name: "huge.png",
      mimeType: "image/png",
      sizeBytes: MAX_STASH_ENTRY_ATTACHMENT_CHARS,
      dataUrl: "x".repeat(MAX_STASH_ENTRY_ATTACHMENT_CHARS),
    };
    const alsoSmall = {
      id: "c",
      name: "also-small.png",
      mimeType: "image/png",
      sizeBytes: 10,
      dataUrl: "x".repeat(10),
    };
    const { kept, droppedNames } = partitionStashAttachments([small, huge, alsoSmall]);
    expect(kept.map((attachment) => attachment.id)).toEqual(["a", "c"]);
    expect(droppedNames).toEqual(["huge.png"]);
  });

  it("admits a single attachment that exactly fits the budget", () => {
    const exact = {
      id: "a",
      name: "exact.png",
      mimeType: "image/png",
      sizeBytes: MAX_STASH_ENTRY_ATTACHMENT_CHARS,
      dataUrl: "x".repeat(MAX_STASH_ENTRY_ATTACHMENT_CHARS),
    };
    const { kept, droppedNames } = partitionStashAttachments([exact]);
    expect(kept).toHaveLength(1);
    expect(droppedNames).toEqual([]);
  });
});

describe("promptStashStore", () => {
  beforeEach(() => {
    resetPromptStashStore();
  });

  afterEach(() => {
    resetPromptStashStore();
  });

  it("prepends entries so the newest stash is first", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(makeEntry({ id: "first" }));
    store.stashEntry(makeEntry({ id: "second" }));
    const entries = usePromptStashStore.getState().entries;
    expect(entries.map((entry) => entry.id)).toEqual(["second", "first"]);
  });

  it("evicts the oldest entry past the cap and returns it", () => {
    const store = usePromptStashStore.getState();
    for (let index = 0; index < MAX_STASH_ENTRIES; index += 1) {
      expect(store.stashEntry(makeEntry({ id: `entry-${index}` })).evicted).toBeNull();
    }
    const { evicted } = store.stashEntry(makeEntry({ id: "overflow" }));
    expect(evicted?.id).toBe("entry-0");
    const entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(MAX_STASH_ENTRIES);
    expect(entries[0]?.id).toBe("overflow");
  });

  // This test environment has no `localStorage`, so the store runs on its
  // in-memory fallback — the exact "kept for this session, gone on reload"
  // case the composer must distinguish from an outright write failure.
  it("distinguishes a memory-only write (written, not durable) from a failed one", () => {
    const store = usePromptStashStore.getState();
    const result = store.stashEntry(makeEntry({ id: "memory-only" }));
    expect(result.written).toBe(true);
    expect(result.durable).toBe(false);
    expect(usePromptStashStore.getState().entries.map((entry) => entry.id)).toEqual([
      "memory-only",
    ]);
  });

  it("takeEntry removes and returns the entry; second take returns null", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry(makeEntry({ id: "keep" }));
    store.stashEntry(makeEntry({ id: "take" }));
    expect(store.takeEntry("take").entry?.id).toBe("take");
    expect(store.takeEntry("take").entry).toBeNull();
    const entries = usePromptStashStore.getState().entries;
    expect(entries.map((entry) => entry.id)).toEqual(["keep"]);
  });

  it("finalizeEntryImages attaches images and clears the pending count", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "pending" }), pendingImageCount: 2 });

    const { attached } = store.finalizeEntryImages("pending", {
      attachments: [
        {
          id: "img-1",
          name: "a.webp",
          mimeType: "image/webp",
          sizeBytes: 10,
          dataUrl: "data:image/webp;base64,AAAA",
        },
      ],
      droppedImageNames: ["big.png"],
      unreadableImageNames: [],
    });

    expect(attached).toBe(true);
    const entry = usePromptStashStore.getState().entries[0];
    expect(entry?.attachments).toHaveLength(1);
    expect(entry?.droppedImageNames).toEqual(["big.png"]);
    expect(entry?.pendingImageCount).toBe(0);
  });

  it("finalizeEntryImages reports false when the entry was already taken", () => {
    const store = usePromptStashStore.getState();
    store.stashEntry({ ...makeEntry({ id: "racing" }), pendingImageCount: 1 });
    // Restored (or deleted) while its images were still encoding.
    store.takeEntry("racing");

    const { attached } = store.finalizeEntryImages("racing", {
      attachments: [],
      droppedImageNames: [],
      unreadableImageNames: [],
    });

    expect(attached).toBe(false);
  });

  it("settles a pending count left behind by a crashed or closed session", () => {
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 2,
        state: {
          entries: [{ ...makeEntry({ id: "orphan" }), pendingImageCount: 2 }],
        },
      }),
    );

    // Hydration must settle the stale count, or the entry would stay stuck
    // showing "saving…" with images that no longer exist anywhere.
    const entry = usePromptStashStore.getState().entries[0];
    expect(entry?.pendingImageCount).toBe(0);
    expect(entry?.unreadableImageNames).toHaveLength(2);
  });

  it("ignores an unreadable v1 payload seeded under the current key", () => {
    // The v1 shape (per-provider queues) does not decode as v2; hydration
    // must fall back to an empty stash rather than throw.
    writePromptStashStorageForTest(
      JSON.stringify({
        version: 1,
        state: { queuesByScopeKey: { "provider:claudeAgent": [] } },
      }),
    );
    expect(usePromptStashStore.getState().entries).toEqual([]);
  });
});
