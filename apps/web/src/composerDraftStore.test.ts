import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import {
  CommandId,
  defaultInstanceIdForDriver,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

// The composer draft's `modelSelectionByProvider` and
// `stickyModelSelectionByProvider` maps are keyed by `ProviderInstanceId`
// in production; these aliases keep the legacy-key migration tests concise.
const CODEX_INSTANCE = ProviderInstanceId.make("codex");
const CODEX_SECONDARY_INSTANCE = ProviderInstanceId.make("codex_secondary");
const CLAUDE_AGENT_INSTANCE = ProviderInstanceId.make("claudeAgent");
const CURSOR_INSTANCE = ProviderInstanceId.make("cursor");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_AGENT_DRIVER = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

type ProviderOptionSelectionBag = ReadonlyArray<ProviderOptionSelection>;
type ProviderOptionSelectionsByProvider = Partial<Record<string, ProviderOptionSelectionBag>>;

function toSelections(
  options: Record<string, string | boolean | undefined> | undefined,
): ReadonlyArray<ProviderOptionSelection> {
  const result: Array<ProviderOptionSelection> = [];
  if (!options) return result;
  for (const [id, value] of Object.entries(options)) {
    if (typeof value === "string" || typeof value === "boolean") {
      result.push({ id, value });
    }
  }
  return result;
}

function selectionsByProvider(
  options: Partial<Record<ProviderDriverKind, Record<string, string | boolean | undefined>>>,
): ProviderOptionSelectionsByProvider {
  const result: ProviderOptionSelectionsByProvider = {};
  for (const [provider, bag] of Object.entries(options) as Array<
    [ProviderDriverKind, Record<string, string | boolean | undefined>]
  >) {
    result[provider] = toSelections(bag);
  }
  return result;
}
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearComposerDraftsEnvironment,
  composerDraftHasUserContent,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  type ComposerImageAttachment,
  hydrateImagesFromPersisted,
  partializeComposerDraftStoreState,
  persistableImageAttachments,
  useComposerDraftStore,
  DraftId,
} from "./composerDraftStore";
import { removeLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  insertInlineTerminalContextPlaceholder,
  replaceMentionWithInlineContextPlaceholder,
  type TerminalContextDraft,
} from "./lib/terminalContext";
import { INLINE_PICTURE_PLACEHOLDER } from "./lib/composerPictures";
import { INLINE_FILE_PLACEHOLDER, type ComposerFileAttachment } from "./lib/composerFiles";
import { createDeferredStorage } from "./lib/storage";
import { closeAccountLifetime, openAccountLifetime } from "./zerops/accountLifetime";

function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  };
}

function makeTerminalContext(input: {
  id: string;
  text?: string;
  terminalId?: string;
  terminalLabel?: string;
  lineStart?: number;
  lineEnd?: number;
}): TerminalContextDraft {
  return {
    id: input.id,
    threadId: ThreadId.make("thread-dedupe"),
    terminalId: input.terminalId ?? "default",
    terminalLabel: input.terminalLabel ?? "Terminal 1",
    lineStart: input.lineStart ?? 4,
    lineEnd: input.lineEnd ?? 5,
    text: input.text ?? "git status\nOn branch main",
    createdAt: "2026-03-13T12:00:00.000Z",
  };
}

function resetComposerDraftStore() {
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    // A send armed by one test and never taken would fire in the next one.
    sendRequestsByThreadKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
}

function modelSelection(
  provider: ProviderDriverKind,
  model: string,
  options?: Record<string, string | boolean | undefined>,
): ModelSelection {
  return createModelSelection(defaultInstanceIdForDriver(provider), model, toSelections(options));
}

function providerModelOptions(
  options: Partial<Record<string, Record<string, string | boolean | undefined>>>,
): ProviderOptionSelectionsByProvider {
  return selectionsByProvider(options);
}

const TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const OTHER_TEST_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");
const LEGACY_TEST_ENVIRONMENT_ID = EnvironmentId.make("__legacy__");

function threadKeyFor(
  threadId: ThreadId,
  environmentId: EnvironmentId = LEGACY_TEST_ENVIRONMENT_ID,
): string {
  if (environmentId === LEGACY_TEST_ENVIRONMENT_ID) {
    return threadId;
  }
  return scopedThreadKey(scopeThreadRef(environmentId, threadId));
}

function draftFor(threadId: ThreadId, environmentId: EnvironmentId = LEGACY_TEST_ENVIRONMENT_ID) {
  const store = useComposerDraftStore.getState().draftsByThreadKey;
  return store[threadKeyFor(threadId, environmentId)] ?? store[threadId] ?? undefined;
}

function draftByKey(key: string) {
  return useComposerDraftStore.getState().draftsByThreadKey[key] ?? undefined;
}

describe("composerDraftStore addImages", () => {
  const threadId = ThreadId.make("thread-dedupe");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("keeps two alike images of one batch: each is a picture with a place of its own", () => {
    const first = makeImage({
      id: "img-1",
      previewUrl: "blob:first",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });
    const duplicate = makeImage({
      id: "img-2",
      previewUrl: "blob:duplicate",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });

    useComposerDraftStore.getState().addImages(threadRef, [first, duplicate]);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1", "img-2"]);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("keeps an image alike to one the draft already has", () => {
    const first = makeImage({
      id: "img-a",
      previewUrl: "blob:a",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 777,
    });
    const duplicateLater = makeImage({
      id: "img-b",
      previewUrl: "blob:b",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 999,
    });

    useComposerDraftStore.getState().addImage(threadRef, first);
    useComposerDraftStore.getState().addImage(threadRef, duplicateLater);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.images.map((image) => image.id)).toEqual(["img-a", "img-b"]);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImages(threadRef, [first, duplicateSameUrl]);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });
});

describe("composerDraftStore pictures in the text", () => {
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("thread-pictures"));
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;
  const P = INLINE_PICTURE_PLACEHOLDER;
  const ids = () => draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.images.map((i) => i.id);

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
    const store = useComposerDraftStore.getState();
    store.insertImage(threadRef, `a${P}`, makeImage({ id: "one", previewUrl: "blob:one" }), 0);
    store.insertImage(threadRef, `a${P}b${P}`, makeImage({ id: "two", previewUrl: "blob:two" }), 1);
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it.each([
    ["before the first", 0, ["new", "one", "two"]],
    ["between the two", 1, ["one", "new", "two"]],
    ["after the last", 2, ["one", "two", "new"]],
    ["past the end, at the end", 9, ["one", "two", "new"]],
  ])("a pasted picture takes its index among the pictures: %s", (_label, index, expected) => {
    useComposerDraftStore
      .getState()
      .insertImage(
        threadRef,
        "the new prompt",
        makeImage({ id: "new", previewUrl: "blob:new" }),
        index,
      );
    expect(ids()).toEqual(expected);
    expect(draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("the new prompt");
  });

  it("a picture pasted twice stays twice: places, not files, are what count", () => {
    useComposerDraftStore
      .getState()
      .insertImage(threadRef, "p", makeImage({ id: "three", previewUrl: "blob:three" }), 2);
    expect(ids()).toEqual(["one", "two", "three"]);
  });

  it.each([
    ["the text's order wins", ["two", "one"], ["two", "one"], []],
    ["a picture no longer in the text goes", ["two"], ["two"], ["blob:one"]],
    ["an id the draft never had is ignored", ["one", "ghost", "two"], ["one", "two"], []],
  ])("syncs to the text: %s", (_label, next, expected, revoked) => {
    useComposerDraftStore.getState().syncImages(threadRef, next);
    expect(ids()).toEqual(expected);
    expect(revokeSpy.mock.calls.map(([url]) => url)).toEqual(revoked);
  });

  it("a picture back in the text (an undo, a paste) returns to the draft in its place", () => {
    const back = makeImage({ id: "back", previewUrl: "blob:back" });
    useComposerDraftStore.getState().syncImages(threadRef, ["one", "back", "two"], [back]);
    expect(ids()).toEqual(["one", "back", "two"]);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("a picture back in the text that the draft still has stays the draft's", () => {
    const stale = makeImage({ id: "one", previewUrl: "blob:one-stale" });
    useComposerDraftStore.getState().syncImages(threadRef, ["two", "one"], [stale]);
    const images = draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.images ?? [];
    expect(images.map((image) => [image.id, image.previewUrl])).toEqual([
      ["two", "blob:two"],
      ["one", "blob:one"],
    ]);
  });

  it("a picture back in the text of a draft that had gone brings the draft back", () => {
    const other = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("thread-emptied"));
    const back = makeImage({ id: "back", previewUrl: "blob:back" });
    useComposerDraftStore.getState().syncImages(other, ["back"], [back]);
    expect(draftFor(other.threadId, TEST_ENVIRONMENT_ID)?.images.map((image) => image.id)).toEqual([
      "back",
    ]);
  });

  it("a picture made again keeps its place and lets its old copy go", () => {
    const again = makeImage({ id: "one", previewUrl: "blob:one-again", sizeBytes: 9 });
    useComposerDraftStore.getState().updateImage(threadRef, again);
    const images = draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.images ?? [];
    expect(images.map((image) => [image.id, image.previewUrl])).toEqual([
      ["one", "blob:one-again"],
      ["two", "blob:two"],
    ]);
    expect(revokeSpy).toHaveBeenCalledExactlyOnceWith("blob:one");
  });

  it("a copy for a picture already gone is let go", () => {
    useComposerDraftStore
      .getState()
      .updateImage(threadRef, makeImage({ id: "gone", previewUrl: "blob:gone" }));
    expect(ids()).toEqual(["one", "two"]);
    expect(revokeSpy).toHaveBeenCalledExactlyOnceWith("blob:gone");
  });
});

describe("pictures across a reload", () => {
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("thread-reload"));
  const threadKey = threadKeyFor(threadRef.threadId, TEST_ENVIRONMENT_ID);
  const P = INLINE_PICTURE_PLACEHOLDER;
  const saved = (id: string) => ({
    id,
    name: `${id}.png`,
    mimeType: "image/png",
    sizeBytes: 3,
    dataUrl: "data:image/png;base64,AQID",
  });
  const merge = (draft: Record<string, unknown>) =>
    (
      useComposerDraftStore.persist as unknown as {
        getOptions: () => {
          merge: (
            persistedState: unknown,
            currentState: ReturnType<typeof useComposerDraftStore.getState>,
          ) => ReturnType<typeof useComposerDraftStore.getState>;
        };
      }
    )
      .getOptions()
      .merge(
        {
          draftsByThreadKey: { [threadKey]: draft },
          draftThreadsByThreadKey: {},
          logicalProjectDraftThreadKeyByLogicalProjectKey: {},
        },
        useComposerDraftStore.getInitialState(),
      ).draftsByThreadKey[threadKey];

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("saves the draft's pictures in the order they sit", () => {
    const store = useComposerDraftStore.getState();
    store.insertImage(threadRef, `a${P}`, makeImage({ id: "one", previewUrl: "blob:one" }), 0);
    store.insertImage(threadRef, `${P}a${P}`, makeImage({ id: "two", previewUrl: "blob:two" }), 0);

    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState());

    expect(persisted.draftsByThreadKey[threadKey]?.pictureIds).toEqual(["two", "one"]);
  });

  it("brings each picture back to its own place, whatever order they were saved in", () => {
    const draft = merge({
      prompt: `a${P}b${P}`,
      attachments: [saved("two"), saved("one")],
      pictureIds: ["one", "two"],
    });
    expect(draft?.prompt).toBe(`a${P}b${P}`);
    expect(draft?.images.map((image) => image.id)).toEqual(["one", "two"]);
  });

  it("a picture that could not be kept leaves its place, and the others keep theirs", () => {
    const draft = merge({
      prompt: `a${P}b${P}c${P}`,
      attachments: [saved("one"), saved("three")],
      pictureIds: ["one", "two", "three"],
    });
    expect(draft?.prompt).toBe(`a${P}bc${P}`);
    expect(draft?.images.map((image) => image.id)).toEqual(["one", "three"]);
  });
});

describe("files in a draft", () => {
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("thread-files"));
  const threadKey = threadKeyFor(threadRef.threadId, TEST_ENVIRONMENT_ID);
  const F = INLINE_FILE_PLACEHOLDER;
  const uploaded = { environmentId: TEST_ENVIRONMENT_ID, attachmentId: "att", uploadedAt: 1_000 };
  const makeFile = (id: string, extra: Partial<ComposerFileAttachment> = {}) =>
    ({
      type: "file",
      id,
      name: `${id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 5,
      file: new File([new Uint8Array(5)], `${id}.pdf`),
      uploaded: null,
      ...extra,
    }) satisfies ComposerFileAttachment;
  const files = () => draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.files.map((f) => f.id);
  const merge = (draft: Record<string, unknown>) =>
    (
      useComposerDraftStore.persist as unknown as {
        getOptions: () => {
          merge: (
            persistedState: unknown,
            currentState: ReturnType<typeof useComposerDraftStore.getState>,
          ) => ReturnType<typeof useComposerDraftStore.getState>;
        };
      }
    )
      .getOptions()
      .merge(
        {
          draftsByThreadKey: { [threadKey]: draft },
          draftThreadsByThreadKey: {},
          logicalProjectDraftThreadKeyByLogicalProjectKey: {},
        },
        useComposerDraftStore.getInitialState(),
      ).draftsByThreadKey[threadKey];

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("a file lands at its index among the files, with its place", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, `a${F}`, makeFile("one"), 0);
    store.insertFile(threadRef, `${F}a${F}`, makeFile("two"), 0);
    expect(files()).toEqual(["two", "one"]);
    expect(draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe(`${F}a${F}`);
  });

  it("follows the text's order, and a file the text no longer holds goes", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, `${F}`, makeFile("one"), 0);
    store.insertFile(threadRef, `${F}${F}`, makeFile("two"), 1);
    store.syncFiles(threadRef, ["two", "one"]);
    expect(files()).toEqual(["two", "one"]);
    store.syncFiles(threadRef, ["one"]);
    expect(files()).toEqual(["one"]);
    store.syncFiles(threadRef, ["back", "one"], [makeFile("back")]);
    expect(files()).toEqual(["back", "one"]);
  });

  it("a finished upload is kept on the file", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, F, makeFile("one"), 0);
    store.updateFile(threadRef, makeFile("one", { uploaded }));
    expect(draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.files[0]?.uploaded).toEqual(uploaded);
  });

  it("a draft holding only a file has content, and clearing it takes the file", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, F, makeFile("one"), 0);
    expect(composerDraftHasUserContent(draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID))).toBe(
      true,
    );
    store.clearComposerContent(threadRef);
    expect(files() ?? []).toEqual([]);
  });

  it("clearing words and pictures for the stash keeps the files in their places", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, `words ${F}\n`, makeFile("one"), 0);
    store.clearComposerPromptAndImages(threadRef);
    expect(files()).toEqual(["one"]);
    expect(draftFor(threadRef.threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe(F);
  });

  it("saves every file's place and only the uploaded files, never their bytes", () => {
    const store = useComposerDraftStore.getState();
    store.insertFile(threadRef, F, makeFile("one", { uploaded }), 0);
    store.insertFile(threadRef, `${F}${F}`, makeFile("two"), 1);
    const persisted = partializeComposerDraftStoreState(useComposerDraftStore.getState())
      .draftsByThreadKey[threadKey];
    expect(persisted?.fileIds).toEqual(["one", "two"]);
    expect(persisted?.files).toEqual([
      {
        id: "one",
        name: "one.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
        environmentId: TEST_ENVIRONMENT_ID,
        attachmentId: "att",
        uploadedAt: 1_000,
      },
    ]);
  });

  it("a reload brings the uploaded files back, and a file that was still uploading leaves its place", () => {
    const draft = merge({
      prompt: `a${F}b${F}c`,
      attachments: [],
      fileIds: ["one", "two"],
      files: [
        {
          id: "two",
          name: "two.pdf",
          mimeType: "application/pdf",
          sizeBytes: 5,
          environmentId: TEST_ENVIRONMENT_ID,
          attachmentId: "att-two",
          uploadedAt: 2_000,
        },
      ],
    });
    expect(draft?.prompt).toBe(`ab${F}c`);
    expect(draft?.files).toEqual([
      {
        type: "file",
        id: "two",
        name: "two.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5,
        file: null,
        uploaded: {
          environmentId: TEST_ENVIRONMENT_ID,
          attachmentId: "att-two",
          uploadedAt: 2_000,
        },
      },
    ]);
  });
});

describe("persistableImageAttachments", () => {
  const image = (id: string) => makeImage({ id, previewUrl: `blob:${id}`, name: `${id}.png` });

  it("keeps the images' order, whichever file is read first", async () => {
    const reads = new Map<string, (dataUrl: string) => void>();
    const saving = persistableImageAttachments(
      [image("one"), image("two")],
      [],
      (file) =>
        new Promise((resolve) => {
          reads.set(file.name, resolve);
        }),
    );
    reads.get("two.png")!("data:image/png;base64,Ag==");
    reads.get("one.png")!("data:image/png;base64,AQ==");

    expect((await saving).map((attachment) => attachment.id)).toEqual(["one", "two"]);
  });

  it("an image whose file cannot be read keeps what was saved of it, or is left out", async () => {
    const earlier = {
      id: "one",
      name: "one.png",
      mimeType: "image/png",
      sizeBytes: 4,
      dataUrl: "data:image/png;base64,AQID",
    };
    const attachments = await persistableImageAttachments(
      [image("one"), image("two")],
      [earlier],
      () => Promise.reject(new Error("unreadable")),
    );
    expect(attachments).toEqual([earlier]);
  });
});

describe("hydrateImagesFromPersisted", () => {
  const picture = {
    sourceWidth: 3024,
    sourceHeight: 1964,
    crop: { x: 0, y: 0, w: 3024, h: 1964 },
    marks: [{ kind: "pin" as const, id: "m1", x: 252, y: 74, note: "Bigger logo" }],
    width: 2000,
    height: 1299,
    asPasted: false,
  };
  const persisted = {
    id: "pic",
    name: "home-page.png",
    mimeType: "image/png",
    sizeBytes: 3,
    dataUrl: "data:image/png;base64,AQID",
  };

  it.each([
    ["an image without a picture stays one", persisted, undefined],
    [
      "a picture keeps its edits and notes, without the pasted file",
      { ...persisted, picture },
      { ...picture, source: null, keepOriginal: false, preparing: false },
    ],
  ])("%s", (_label, attachment, expected) => {
    const [image] = hydrateImagesFromPersisted([attachment]);
    expect(image?.picture).toEqual(expected);
  });
});

describe("composerDraftStore clearComposerContent", () => {
  const threadId = ThreadId.make("thread-clear");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("does not revoke blob preview URLs when clearing composer content", () => {
    const first = makeImage({
      id: "img-optimistic",
      previewUrl: "blob:optimistic",
    });
    useComposerDraftStore.getState().addImage(threadRef, first);

    useComposerDraftStore.getState().clearComposerContent(threadRef);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft).toBeUndefined();
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:optimistic");
  });
});

describe("composerDraftStore moveComposerPromptAndImages", () => {
  const sourceDraftId = DraftId.make("draft-move-source");
  const destinationDraftId = DraftId.make("draft-move-destination");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    resetComposerDraftStore();
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("moves prompt and images to the destination without revoking preview URLs", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(sourceDraftId, "fix the login redirect");
    store.addImages(sourceDraftId, [makeImage({ id: "img-move", previewUrl: "blob:move" })]);

    store.moveComposerPromptAndImages(sourceDraftId, destinationDraftId);

    expect(draftByKey(sourceDraftId)).toBeUndefined();
    const destination = draftByKey(destinationDraftId);
    // The image had no place in the text: it gets one first, where images went.
    expect(destination?.prompt).toBe(`${INLINE_PICTURE_PLACEHOLDER}fix the login redirect`);
    expect(destination?.images.map((image) => image.id)).toEqual(["img-move"]);
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it("keeps session-bound contexts on the source and strips their placeholders from the moved prompt", () => {
    const sourceThreadId = ThreadId.make("thread-move-source");
    const sourceThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, sourceThreadId);
    const store = useComposerDraftStore.getState();
    store.addTerminalContext(sourceThreadRef, makeTerminalContext({ id: "ctx-stay" }));
    store.setPrompt(sourceThreadRef, `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} explain this error`);

    store.moveComposerPromptAndImages(sourceThreadRef, destinationDraftId);

    const source = draftFor(sourceThreadId, TEST_ENVIRONMENT_ID);
    expect(source?.terminalContexts.map((context) => context.id)).toEqual(["ctx-stay"]);
    expect(source?.prompt).toBe(INLINE_TERMINAL_CONTEXT_PLACEHOLDER);
    expect(draftByKey(destinationDraftId)?.prompt).toBe(" explain this error");
  });

  it("the moved pictures keep their places, after the destination's own", () => {
    const P = INLINE_PICTURE_PLACEHOLDER;
    const store = useComposerDraftStore.getState();
    store.insertImage(
      destinationDraftId,
      `${P}here`,
      makeImage({ id: "dest", previewUrl: "blob:d" }),
      0,
    );
    store.insertImage(sourceDraftId, `look${P}`, makeImage({ id: "src", previewUrl: "blob:s" }), 0);

    store.moveComposerPromptAndImages(sourceDraftId, destinationDraftId);

    const destination = draftByKey(destinationDraftId);
    expect(destination?.images.map((image) => image.id)).toEqual(["dest", "src"]);
    expect(destination?.prompt).toBe(`${P}look${P}`);
  });

  it("is a no-op when source and destination are the same target", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(sourceDraftId, "keep me");

    store.moveComposerPromptAndImages(sourceDraftId, sourceDraftId);

    expect(draftByKey(sourceDraftId)?.prompt).toBe("keep me");
  });
});

describe("composerDraftStore setPrompt", () => {
  const threadId = ThreadId.make("thread-set-prompt");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores a changed prompt", () => {
    useComposerDraftStore.getState().setPrompt(threadRef, "deploy the stage");

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("deploy the stage");
  });

  // The composer writes the prompt it is already holding on every keystroke
  // and on every render that syncs the editor. A write that changes nothing
  // must hand back the same state, or each one wakes the subscribers, which
  // write again: React counts the nested updates and throws "Maximum update
  // depth exceeded" (measured on every send, 2026-09-18).
  it("hands back the same state when the prompt has not changed", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "deploy the stage");
    const before = useComposerDraftStore.getState();
    const listener = vi.fn();
    const unsubscribe = useComposerDraftStore.subscribe(listener);

    store.setPrompt(threadRef, "deploy the stage");

    const after = useComposerDraftStore.getState();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(after.draftsByThreadKey).toBe(before.draftsByThreadKey);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBe(
      before.draftsByThreadKey[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)],
    );
  });

  // The composer clears itself after a send and then syncs the editor, which
  // writes the empty prompt again onto a draft that is already gone.
  it("hands back the same state when an absent draft is written empty", () => {
    const store = useComposerDraftStore.getState();
    const before = useComposerDraftStore.getState();
    const listener = vi.fn();
    const unsubscribe = useComposerDraftStore.subscribe(listener);

    store.setPrompt(threadRef, "");

    const after = useComposerDraftStore.getState();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
    expect(after.draftsByThreadKey).toBe(before.draftsByThreadKey);
  });

  it("still removes a draft the empty prompt leaves with nothing in it", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "deploy the stage");

    store.setPrompt(threadRef, "");

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });
});

describe("composerDraftStore requestSend", () => {
  // The seam every hand-over to a Mate runs through: *Ask*, the Git tab's
  // *Ask*, the left menu's. The surface asks the person, quotes the exact
  // words and presses *Send* for them; this arms the turn and `ChatView`
  // fires it once the thread is live, because only it knows the model, the
  // runtime mode and the attachments a turn needs.
  const threadId = ThreadId.make("thread-request-send");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  const otherThreadId = ThreadId.make("thread-request-send-other");
  const otherThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, otherThreadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("puts the words in the composer and arms the send", () => {
    const store = useComposerDraftStore.getState();

    store.requestSend(threadRef, "rebase this onto main, then push");

    // Both halves matter: the person must see what was sent in their own
    // composer, and the turn must actually start.
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe(
      "rebase this onto main, then push",
    );
    expect(useComposerDraftStore.getState().takeSendRequest(threadRef)).toEqual({
      prompt: "rebase this onto main, then push",
    });
  });

  it("hands the send over once, so a re-render never sends twice", () => {
    const store = useComposerDraftStore.getState();
    store.requestSend(threadRef, "rebase this onto main, then push");

    expect(store.takeSendRequest(threadRef)?.prompt).toBe("rebase this onto main, then push");
    // `ChatView` takes on every change of the live thread; the second take is
    // the same effect running again, and it must find nothing.
    expect(store.takeSendRequest(threadRef)).toBeNull();
  });

  it("belongs to the Mate it was asked of", () => {
    const store = useComposerDraftStore.getState();
    store.requestSend(threadRef, "rebase this onto main, then push");

    // Opening another conversation must not fire the request waiting on this
    // one — the words quoted in the confirm named one Mate.
    expect(store.takeSendRequest(otherThreadRef)).toBeNull();
    expect(store.takeSendRequest(threadRef)?.prompt).toBe("rebase this onto main, then push");
  });

  it("asks again with the newer words when a second request lands first", () => {
    const store = useComposerDraftStore.getState();
    store.requestSend(threadRef, "rebase this onto main, then push");

    store.requestSend(threadRef, "never mind the rebase, just fix the failing check");

    expect(store.takeSendRequest(threadRef)?.prompt).toBe(
      "never mind the rebase, just fix the failing check",
    );
    expect(store.takeSendRequest(threadRef)).toBeNull();
  });

  it("carries the ids of a send several clients may make at once", () => {
    // The stand-up is asked by every client its person has open; the same ids
    // make the same command, which the server takes once.
    const ids = {
      commandId: CommandId.make("mate-standup-thread-request-send-1"),
      messageId: MessageId.make("mate-standup-thread-request-send-1"),
    };
    const store = useComposerDraftStore.getState();
    store.requestSend(threadRef, "Stand up development of the project.", ids);

    expect(store.takeSendRequest(threadRef)).toEqual({
      prompt: "Stand up development of the project.",
      ids,
    });
  });
});

describe("composerDraftStore syncPersistedAttachments", () => {
  const threadId = ThreadId.make("thread-sync-persisted");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  afterEach(() => {
    removeLocalStorageItem(COMPOSER_DRAFT_STORAGE_KEY);
  });

  it("treats malformed persisted draft storage as empty", async () => {
    const image = makeImage({
      id: "img-persisted",
      previewUrl: "blob:persisted",
    });
    useComposerDraftStore.getState().addImage(threadRef, image);
    setLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      {
        version: 2,
        state: {
          draftsByThreadId: {
            [threadId]: {
              attachments: "not-an-array",
            },
          },
        },
      },
      Schema.Unknown,
    );

    useComposerDraftStore.getState().syncPersistedAttachments(threadRef, [
      {
        id: image.id,
        name: image.name,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        dataUrl: image.previewUrl,
      },
    ]);
    await Promise.resolve();

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.persistedAttachments).toEqual([]);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.nonPersistedImageIds).toEqual([image.id]);
  });
});

describe("composerDraftStore terminal contexts", () => {
  const threadId = ThreadId.make("thread-dedupe");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("deduplicates identical terminal contexts by selection signature", () => {
    const first = makeTerminalContext({ id: "ctx-1" });
    const duplicate = makeTerminalContext({ id: "ctx-2" });

    useComposerDraftStore.getState().addTerminalContexts(threadRef, [first, duplicate]);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-1"]);
  });

  it("deduplicates a data context by its identity, not its snapshot line count", () => {
    const first: TerminalContextDraft = {
      ...makeTerminalContext({ id: "ctx-data-1" }),
      kind: "data",
      token: "db.public.orders",
      terminalId: "data:db · public.orders",
      terminalLabel: "db · public.orders",
      lineStart: 1,
      lineEnd: 4,
      text: "## db · public.orders\n- id\n- email\n- name",
    };
    const reAdded: TerminalContextDraft = {
      ...first,
      id: "ctx-data-2",
      lineEnd: 3,
      text: "## db · public.orders\n- id\n- email",
    };

    useComposerDraftStore.getState().addTerminalContexts(threadRef, [first, reAdded]);

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.terminalContexts.map((context) => context.id),
    ).toEqual(["ctx-data-1"]);
  });

  it("persists a data context's kind and mention token", () => {
    useComposerDraftStore.getState().addTerminalContext(threadRef, {
      ...makeTerminalContext({ id: "ctx-data-persist" }),
      kind: "data",
      token: "db.public.orders",
      terminalId: "data:db · public.orders",
      terminalLabel: "db · public.orders",
    });

    const persistedState = partializeComposerDraftStoreState(
      useComposerDraftStore.getState(),
    ) as unknown as {
      draftsByThreadKey?: Record<string, { terminalContexts?: Array<Record<string, unknown>> }>;
    };

    expect(
      persistedState.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.terminalContexts?.[0],
    ).toMatchObject({ kind: "data", token: "db.public.orders" });
  });

  it("keeps exactly one chip and no mention text across a data context round trip", () => {
    const insertion = replaceMentionWithInlineContextPlaceholder("look at @db", 8, 11);
    const context: TerminalContextDraft = {
      ...makeTerminalContext({ id: "ctx-data-round" }),
      kind: "data",
      token: "db",
      terminalId: "data:db",
      terminalLabel: "db",
      lineStart: 1,
      lineEnd: 1,
      text: "## db (postgresql@16)",
    };

    expect(
      useComposerDraftStore
        .getState()
        .insertTerminalContext(threadRef, insertion.prompt, context, insertion.contextIndex),
    ).toBe(true);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.prompt).toBe(`look at ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} `);
    expect(draft?.prompt).not.toContain("@db");
    expect(draft?.terminalContexts).toHaveLength(1);

    // The same pick again must not add a second chip.
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadRef, { ...context, id: "ctx-data-round-2" });
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.terminalContexts).toHaveLength(1);
  });

  it("leaves the composer empty after a send clears its content", () => {
    useComposerDraftStore.getState().addTerminalContext(threadRef, {
      ...makeTerminalContext({ id: "ctx-data-clear" }),
      kind: "data",
      token: "db",
      terminalId: "data:db",
      terminalLabel: "db",
    });
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.terminalContexts).toHaveLength(1);

    useComposerDraftStore.getState().clearComposerContent(threadRef);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.terminalContexts ?? []).toEqual([]);
    expect(draft?.prompt ?? "").toBe("");
  });

  it("clears terminal contexts when clearing composer content", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadRef, makeTerminalContext({ id: "ctx-1" }));

    useComposerDraftStore.getState().clearComposerContent(threadRef);

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });

  it("inserts terminal contexts at the requested inline prompt position", () => {
    const firstInsertion = insertInlineTerminalContextPlaceholder("alpha beta", 6);
    const secondInsertion = insertInlineTerminalContextPlaceholder(firstInsertion.prompt, 0);

    expect(
      useComposerDraftStore
        .getState()
        .insertTerminalContext(
          threadRef,
          firstInsertion.prompt,
          makeTerminalContext({ id: "ctx-1" }),
          firstInsertion.contextIndex,
        ),
    ).toBe(true);
    expect(
      useComposerDraftStore.getState().insertTerminalContext(
        threadRef,
        secondInsertion.prompt,
        makeTerminalContext({
          id: "ctx-2",
          terminalLabel: "Terminal 2",
          lineStart: 9,
          lineEnd: 10,
        }),
        secondInsertion.contextIndex,
      ),
    ).toBe(true);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.prompt).toBe(
      `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} alpha ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER} beta`,
    );
    expect(draft?.terminalContexts.map((context) => context.id)).toEqual(["ctx-2", "ctx-1"]);
  });

  it("omits terminal context text from persisted drafts", () => {
    useComposerDraftStore
      .getState()
      .addTerminalContext(threadRef, makeTerminalContext({ id: "ctx-persist" }));

    const persistedState = partializeComposerDraftStoreState(
      useComposerDraftStore.getState(),
    ) as unknown as {
      draftsByThreadKey?: Record<string, { terminalContexts?: Array<Record<string, unknown>> }>;
    };

    expect(
      persistedState.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.terminalContexts?.[0],
      "Expected terminal context metadata to be persisted.",
    ).toMatchObject({
      id: "ctx-persist",
      terminalId: "default",
      terminalLabel: "Terminal 1",
      lineStart: 4,
      lineEnd: 5,
    });
    expect(
      persistedState.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.terminalContexts?.[0]?.text,
    ).toBeUndefined();
  });

  it("hydrates persisted terminal contexts without in-memory snapshot text", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
            attachments: [],
            terminalContexts: [
              {
                id: "ctx-rehydrated",
                threadId,
                createdAt: "2026-03-13T12:00:00.000Z",
                terminalId: "default",
                terminalLabel: "Terminal 1",
                lineStart: 4,
                lineEnd: 5,
              },
            ],
          },
        },
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectKey: {},
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadKey[threadKeyFor(threadId)]?.terminalContexts).toMatchObject([
      {
        id: "ctx-rehydrated",
        terminalId: "default",
        terminalLabel: "Terminal 1",
        lineStart: 4,
        lineEnd: 5,
        text: "",
      },
    ]);
  });

  it("sanitizes malformed persisted drafts during merge", () => {
    const persistApi = useComposerDraftStore.persist as unknown as {
      getOptions: () => {
        merge: (
          persistedState: unknown,
          currentState: ReturnType<typeof useComposerDraftStore.getState>,
        ) => ReturnType<typeof useComposerDraftStore.getState>;
      };
    };
    const mergedState = persistApi.getOptions().merge(
      {
        draftsByThreadId: {
          [threadId]: {
            prompt: "",
            attachments: "not-an-array",
            terminalContexts: "not-an-array",
            provider: "bogus-provider",
            modelOptions: "not-an-object",
          },
        },
        draftThreadsByThreadId: "not-an-object",
        projectDraftThreadIdByProjectKey: "not-an-object",
      },
      useComposerDraftStore.getInitialState(),
    );

    expect(mergedState.draftsByThreadKey[threadKeyFor(threadId)]).toBeUndefined();
    expect(mergedState.draftThreadsByThreadKey).toEqual({});
    expect(mergedState.logicalProjectDraftThreadKeyByLogicalProjectKey).toEqual({});
  });
});

describe("composerDraftStore persisted draft threads keep their project", () => {
  const persistApi = useComposerDraftStore.persist as unknown as {
    getOptions: () => {
      merge: (
        persistedState: unknown,
        currentState: ReturnType<typeof useComposerDraftStore.getState>,
      ) => ReturnType<typeof useComposerDraftStore.getState>;
    };
  };
  const environmentId = EnvironmentId.make("a5c9ebd6-8cf7-411b-bd8f-92ce44bc9c25");
  const projectId = ProjectId.make("bfb22596-bb3c-4d89-b523-3768cfbd907d");
  const draftId = "ddc56cd7-b2b8-44d9-bc3e-b7d474febb84";
  const threadId = ThreadId.make("c492f861-8444-46d8-a1a5-dcd21753b2cc");
  const logicalProjectKey = `${environmentId}:/var/www`;
  const draftThread = {
    threadId,
    environmentId,
    projectId,
    logicalProjectKey,
    createdAt: "2026-09-05T19:20:19.171Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
    promotedTo: null,
  };

  it("never rewrites a draft's project from its logical key, which is a workspace, not an id", () => {
    const merged = persistApi.getOptions().merge(
      {
        draftsByThreadKey: {},
        draftThreadsByThreadKey: { [draftId]: draftThread },
        logicalProjectDraftThreadKeyByLogicalProjectKey: { [logicalProjectKey]: draftId },
      },
      useComposerDraftStore.getInitialState(),
    );
    expect(merged.draftThreadsByThreadKey[draftId]).toMatchObject({
      environmentId,
      projectId,
      logicalProjectKey,
    });
    expect(merged.logicalProjectDraftThreadKeyByLogicalProjectKey).toEqual({
      [logicalProjectKey]: draftId,
    });
  });

  it("does not invent a draft thread for a logical key whose draft is gone", () => {
    const merged = persistApi.getOptions().merge(
      {
        draftsByThreadKey: {},
        draftThreadsByThreadKey: {},
        logicalProjectDraftThreadKeyByLogicalProjectKey: { [logicalProjectKey]: draftId },
      },
      useComposerDraftStore.getInitialState(),
    );
    expect(merged.draftThreadsByThreadKey).toEqual({});
  });

  it("still reads a legacy `environment:projectId` map as project refs", () => {
    const legacyThreadId = ThreadId.make("thread-legacy");
    const merged = persistApi.getOptions().merge(
      {
        draftsByThreadId: {},
        draftThreadsByThreadId: {},
        projectDraftThreadIdByProjectKey: {
          [`${environmentId}:${projectId}`]: `${environmentId}:${legacyThreadId}`,
        },
      },
      useComposerDraftStore.getInitialState(),
    );
    const [fabricated] = Object.values(merged.draftThreadsByThreadKey);
    expect(fabricated).toMatchObject({ environmentId, projectId, threadId: legacyThreadId });
  });
});

describe("composerDraftStore review comments", () => {
  const threadId = ThreadId.make("thread-review-comment");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
  const comment = {
    id: "comment-1",
    sectionId: "file:src/app.ts",
    sectionTitle: "File comment",
    filePath: "src/app.ts",
    startIndex: 1,
    endIndex: 2,
    rangeLabel: "L2 to L3",
    text: "Keep this configurable.",
    diff: "@@ -2,2 +2,2 @@\n two\n three",
  } as const;

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("upserts and removes review comments by id", () => {
    const store = useComposerDraftStore.getState();
    store.addReviewComment(threadRef, comment);
    store.addReviewComment(threadRef, { ...comment, text: "Updated comment." });

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.reviewComments).toEqual([
      { ...comment, text: "Updated comment." },
    ]);

    store.removeReviewComment(threadRef, comment.id);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });

  it("persists review comments and clears them with composer content", () => {
    const store = useComposerDraftStore.getState();
    store.addReviewComment(threadRef, comment);
    const persisted = partializeComposerDraftStoreState(
      useComposerDraftStore.getState(),
    ) as unknown as {
      draftsByThreadKey?: Record<string, { reviewComments?: Array<Record<string, unknown>> }>;
    };

    expect(
      persisted.draftsByThreadKey?.[threadKeyFor(threadId, TEST_ENVIRONMENT_ID)]
        ?.reviewComments?.[0],
    ).toMatchObject(comment);

    store.clearComposerContent(threadRef);
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });

  it("stores review comments against a new-thread draft id", () => {
    const draftId = DraftId.make("draft-review-comment");
    useComposerDraftStore.getState().addReviewComment(draftId, comment);

    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.reviewComments).toEqual([
      comment,
    ]);
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.make("project-a");
  const otherProjectId = ProjectId.make("project-b");
  const projectRef = scopeProjectRef(TEST_ENVIRONMENT_ID, projectId);
  const otherProjectRef = scopeProjectRef(TEST_ENVIRONMENT_ID, otherProjectId);
  const remoteProjectRef = scopeProjectRef(OTHER_TEST_ENVIRONMENT_ID, projectId);
  const threadId = ThreadId.make("thread-a");
  const otherThreadId = ThreadId.make("thread-b");
  const draftId = DraftId.make("draft-a");
  const otherDraftId = DraftId.make("draft-b");
  const sharedDraftId = DraftId.make("draft-shared");
  const localDraftId = DraftId.make("draft-local");
  const remoteDraftId = DraftId.make("draft-remote");

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("clears composer data for one environment without touching another", () => {
    const store = useComposerDraftStore.getState();
    const localThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    const remoteThreadRef = scopeThreadRef(OTHER_TEST_ENVIRONMENT_ID, otherThreadId);
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const revokeSpy = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revokeSpy;

    try {
      store.setProjectDraftThreadId(projectRef, localDraftId, { threadId });
      store.setProjectDraftThreadId(remoteProjectRef, remoteDraftId, {
        threadId: otherThreadId,
      });
      store.setPrompt(localDraftId, "local draft");
      store.setPrompt(remoteDraftId, "remote draft");
      store.addImage(localDraftId, makeImage({ id: "img-local", previewUrl: "blob:local-draft" }));
      store.setPrompt(localThreadRef, "local thread draft");
      store.setPrompt(remoteThreadRef, "remote thread draft");

      clearComposerDraftsEnvironment(TEST_ENVIRONMENT_ID);

      const next = useComposerDraftStore.getState();
      expect(next.getDraftThreadByProjectRef(projectRef)).toBeNull();
      expect(next.getDraftThreadByProjectRef(remoteProjectRef)).not.toBeNull();
      expect(next.getComposerDraft(localDraftId)).toBeNull();
      expect(next.getComposerDraft(remoteDraftId)?.prompt).toBe("remote thread draft");
      expect(next.getComposerDraft(localThreadRef)).toBeNull();
      expect(next.getComposerDraft(remoteThreadRef)?.prompt).toBe("remote thread draft");
      expect(revokeSpy).toHaveBeenCalledWith("blob:local-draft");
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("stores and reads project draft thread ids via actions", () => {
    const store = useComposerDraftStore.getState();
    expect(store.getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(store.getDraftThread(draftId)).toBeNull();

    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toMatchObject({
      threadId,
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      logicalProjectKey: scopedProjectKey(projectRef),
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      logicalProjectKey: scopedProjectKey(projectRef),
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rotates a failed bootstrap thread id without losing its draft", () => {
    const store = useComposerDraftStore.getState();
    const retryThreadId = ThreadId.make("thread-retry");
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/test",
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      envMode: "worktree",
      startFromOrigin: true,
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    store.setPrompt(draftId, "keep this prompt");
    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    store.setLogicalProjectDraftThreadId(scopedProjectKey(projectRef), projectRef, draftId, {
      threadId: retryThreadId,
      createdAt: "2026-01-01T00:01:00.000Z",
    });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      threadId: retryThreadId,
      branch: "feature/test",
      worktreePath: null,
      createdAt: "2026-01-01T00:01:00.000Z",
      envMode: "worktree",
      startFromOrigin: true,
      runtimeMode: "approval-required",
      interactionMode: "plan",
      promotedTo: null,
    });
    expect(useComposerDraftStore.getState().getComposerDraft(draftId)?.prompt).toBe(
      "keep this prompt",
    );
  });

  it("clears only matching project draft mapping entries", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "hello");

    store.clearProjectDraftThreadById(projectRef, otherDraftId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      threadId,
    );

    store.clearProjectDraftThreadById(projectRef, draftId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("clears project draft mapping by project id", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "hello");
    store.clearProjectDraftThreadId(projectRef);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("revokes draft image blob URLs when clearing a project's draft thread", () => {
    const store = useComposerDraftStore.getState();
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const revokeSpy = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revokeSpy;

    try {
      store.setProjectDraftThreadId(projectRef, draftId, { threadId });
      store.addImage(draftId, makeImage({ id: "img-project-clear", previewUrl: "blob:clear" }));

      store.clearProjectDraftThreadId(projectRef);

      expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
      expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
      expect(revokeSpy).toHaveBeenCalledWith("blob:clear");
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("revokes draft image blob URLs when clearing a matching project draft thread by id", () => {
    const store = useComposerDraftStore.getState();
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const revokeSpy = vi.fn<(url: string) => void>();
    URL.revokeObjectURL = revokeSpy;

    try {
      store.setProjectDraftThreadId(projectRef, draftId, { threadId });
      store.addImage(
        draftId,
        makeImage({ id: "img-project-clear-by-id", previewUrl: "blob:clear-by-id" }),
      );

      store.clearProjectDraftThreadById(projectRef, draftId);

      expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
      expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
      expect(revokeSpy).toHaveBeenCalledWith("blob:clear-by-id");
    } finally {
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it("clears empty composer drafts when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });

    store.setProjectDraftThreadId(projectRef, otherDraftId, { threadId: otherThreadId });

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      otherThreadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("keeps invested composer drafts alive unmapped when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "keep me around");

    store.setProjectDraftThreadId(projectRef, otherDraftId, { threadId: otherThreadId });

    // The mapping moved to the fresh draft...
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      otherThreadId,
    );
    // ...but the invested draft survives with its content for the sidebar
    // draft rows to surface.
    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.threadId).toBe(threadId);
    expect(draftByKey(draftId)?.prompt).toBe("keep me around");
  });

  it("clears every session for a project, including unmapped invested drafts", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "invested");
    // The remap leaves the invested draft alive unmapped; project removal
    // must still sweep it, or its sidebar row outlives the project.
    store.setProjectDraftThreadId(projectRef, otherDraftId, { threadId: otherThreadId });

    store.clearProjectDraftThreadId(projectRef);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(otherDraftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setProjectDraftThreadId(otherProjectRef, sharedDraftId, { threadId });
    store.setPrompt(sharedDraftId, "keep me");

    store.clearProjectDraftThreadId(projectRef);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectRef(otherProjectRef)?.threadId,
    ).toBe(threadId);
    expect(draftByKey(sharedDraftId)?.prompt).toBe("keep me");
  });

  it("clears draft registration independently", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "remove me");
    store.clearDraftThread(draftId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("marks a promoted draft by scoped ref without deleting composer state", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "promote me");

    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.promotedTo).toEqual(
      scopeThreadRef(TEST_ENVIRONMENT_ID, threadId),
    );
    expect(draftByKey(draftId)?.prompt).toBe("promote me");
  });

  it("reads local draft composer state through a scoped thread ref", () => {
    const store = useComposerDraftStore.getState();
    const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "scoped access");

    expect(store.getComposerDraft(draftId)?.prompt).toBe("scoped access");
    expect(store.getComposerDraft(threadRef)?.prompt).toBe("scoped access");
  });

  it("does not clear composer drafts for existing server threads during promotion cleanup", () => {
    const store = useComposerDraftStore.getState();
    const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    store.setPrompt(threadRef, "keep me");

    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThread(threadRef)).toBeNull();
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("keep me");
  });

  it("promotes a draft without changing another thread's draft", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "promote me");
    store.setProjectDraftThreadId(otherProjectRef, otherDraftId, { threadId: otherThreadId });
    store.setPrompt(otherDraftId, "keep me");

    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.promotedTo).toEqual(
      scopeThreadRef(TEST_ENVIRONMENT_ID, threadId),
    );
    expect(draftByKey(draftId)?.prompt).toBe("promote me");
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectRef(otherProjectRef)?.threadId,
    ).toBe(otherThreadId);
    expect(draftByKey(otherDraftId)?.prompt).toBe("keep me");
  });

  it("promotes matching thread ids separately for each environment", () => {
    const store = useComposerDraftStore.getState();
    const localThreadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);
    const remoteThreadRef = scopeThreadRef(OTHER_TEST_ENVIRONMENT_ID, threadId);

    store.setProjectDraftThreadId(projectRef, localDraftId, { threadId });
    store.setPrompt(localDraftId, "local draft");
    store.setProjectDraftThreadId(remoteProjectRef, remoteDraftId, { threadId });
    store.setPrompt(remoteDraftId, "remote draft");

    markPromotedDraftThreadByRef(localThreadRef);

    expect(store.getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(store.getDraftThreadByProjectRef(remoteProjectRef)?.threadId).toBe(threadId);
    expect(store.getDraftThreadByRef(localThreadRef)?.promotedTo).toEqual(localThreadRef);
    expect(store.getDraftThreadByRef(remoteThreadRef)?.promotedTo).toBeNull();
    expect(draftByKey(localDraftId)?.prompt).toBe("local draft");
    expect(draftByKey(remoteDraftId)?.prompt).toBe("remote draft");

    markPromotedDraftThreadByRef(remoteThreadRef);

    expect(store.getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(store.getDraftThreadByProjectRef(remoteProjectRef)).toBeNull();
    expect(store.getDraftThreadByRef(localThreadRef)?.promotedTo).toEqual(localThreadRef);
    expect(store.getDraftThreadByRef(remoteThreadRef)?.promotedTo).toEqual(remoteThreadRef);
    expect(draftByKey(localDraftId)?.prompt).toBe("local draft");
    expect(draftByKey(remoteDraftId)?.prompt).toBe("remote draft");
  });

  it("only marks promoted drafts for the matching environment ref", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "promote me");

    markPromotedDraftThreadByRef(scopeThreadRef(OTHER_TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      threadId,
    );
    expect(draftByKey(draftId)?.prompt).toBe("promote me");
  });

  it("finalizes a promoted draft after the canonical thread route is active", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "promote me");
    markPromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    finalizePromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("finalizes a matching materialized draft even when promotion was not pre-marked", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, { threadId });
    store.setPrompt(draftId, "promote me");

    finalizePromotedDraftThreadByRef(scopeThreadRef(TEST_ENVIRONMENT_ID, threadId));

    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toBeNull();
    expect(draftByKey(draftId)).toBeUndefined();
  });

  it("updates branch context on an existing draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "main",
      worktreePath: null,
    });
    store.setDraftThreadContext(draftId, {
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectRef(projectRef)?.threadId).toBe(
      threadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
      envMode: "worktree",
    });
  });

  it("stores the start-from-origin choice with the draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      envMode: "worktree",
      startFromOrigin: true,
    });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.startFromOrigin).toBe(true);

    store.setDraftThreadContext(draftId, { startFromOrigin: false });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)?.startFromOrigin).toBe(false);
  });

  it("preserves existing branch and worktree when setProjectDraftThreadId receives undefined", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "main",
      worktreePath: "/tmp/main-worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
    };
    store.setProjectDraftThreadId(projectRef, draftId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      branch: "main",
      worktreePath: "/tmp/main-worktree",
      envMode: "worktree",
    });
  });

  it("preserves worktree env mode without a worktree path", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
      envMode: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: "local" | "worktree";
    };
    store.setProjectDraftThreadId(projectRef, draftId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: TEST_ENVIRONMENT_ID,
      projectId,
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
  });

  it("clears branch and worktree but keeps env mode when remapping a draft to another environment", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/local-only",
      worktreePath: "/tmp/local-worktree",
      envMode: "worktree",
      startFromOrigin: true,
    });

    store.setLogicalProjectDraftThreadId(scopedProjectKey(projectRef), remoteProjectRef, draftId, {
      threadId,
    });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: OTHER_TEST_ENVIRONMENT_ID,
      projectId,
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
    });
  });

  it("clears branch and worktree but keeps env mode when changing a draft thread project ref", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectRef, draftId, {
      threadId,
      branch: "feature/local-only",
      worktreePath: "/tmp/local-worktree",
      envMode: "worktree",
      startFromOrigin: true,
    });

    store.setDraftThreadContext(draftId, {
      projectRef: remoteProjectRef,
    });

    expect(useComposerDraftStore.getState().getDraftThread(draftId)).toMatchObject({
      environmentId: OTHER_TEST_ENVIRONMENT_ID,
      projectId,
      branch: null,
      worktreePath: null,
      envMode: "worktree",
      startFromOrigin: true,
    });
  });
});

describe("composerDraftStore modelSelection", () => {
  const threadId = ThreadId.make("thread-model-options");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores a model selection in the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadRef,
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", {
        reasoningEffort: "xhigh",
        fastMode: true,
      }),
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_INSTANCE],
    ).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", {
        reasoningEffort: "xhigh",
        fastMode: true,
      }),
    );
  });

  it("drops a draft's model pick so the thread's selection shows, keeping its text", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "still typing");
    store.setModelSelection(
      threadRef,
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", { reasoningEffort: "xhigh" }),
    );

    store.clearModelSelection(threadRef);

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider).toEqual({});
    expect(draft?.activeProvider).toBeNull();
    expect(draft?.prompt).toBe("still typing");
  });

  it("drops a draft that held only a model pick", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.4"));

    store.clearModelSelection(threadRef);

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });

  it("keeps default-only model selections on the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.4"));

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_INSTANCE],
    ).toEqual(modelSelection(CODEX_DRIVER, "gpt-5.4"));
  });

  it("replaces only the targeted provider options on the current model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadRef,
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        effort: "max",
        fastMode: true,
      }),
    );
    store.setStickyModelSelection(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        effort: "max",
        fastMode: true,
      }),
    );

    store.setProviderModelOptions(
      threadRef,
      CLAUDE_AGENT_DRIVER,
      toSelections({ thinking: false }),
      {
        persistSticky: true,
      },
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        thinking: false,
      }),
    );
    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        thinking: false,
      }),
    );
  });

  it("keeps explicit default-state overrides on the selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadRef,
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        effort: "max",
      }),
    );

    store.setProviderModelOptions(threadRef, CLAUDE_AGENT_DRIVER, toSelections({ thinking: true }));

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        thinking: true,
      }),
    );
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider).toEqual({});
  });

  it("keeps explicit off/default codex overrides on the selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.4", { fastMode: true }));

    store.setProviderModelOptions(
      threadRef,
      CODEX_DRIVER,
      toSelections({ reasoningEffort: "high", fastMode: false }),
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_INSTANCE],
    ).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.4", {
        reasoningEffort: "high",
        fastMode: false,
      }),
    );
  });

  it("keeps explicit Cursor reset overrides on the selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(
      threadRef,
      modelSelection(CURSOR_DRIVER, "claude-opus-4-6", {
        reasoning: "xhigh",
        fastMode: true,
        thinking: false,
      }),
    );

    store.setProviderModelOptions(
      threadRef,
      CURSOR_DRIVER,
      toSelections({ reasoning: "medium", fastMode: false, thinking: true }),
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CURSOR_INSTANCE],
    ).toEqual(
      modelSelection(CURSOR_DRIVER, "claude-opus-4-6", {
        reasoning: "medium",
        fastMode: false,
        thinking: true,
      }),
    );
  });

  it("preserves the selected Cursor model when only traits change", () => {
    const store = useComposerDraftStore.getState();

    store.setProviderModelOptions(threadRef, CURSOR_DRIVER, toSelections({ reasoning: "high" }), {
      model: "gpt-5.4",
      persistSticky: true,
    });

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CURSOR_INSTANCE],
    ).toEqual(
      modelSelection(CURSOR_DRIVER, "gpt-5.4", {
        reasoning: "high",
      }),
    );
    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CURSOR_INSTANCE],
    ).toEqual(
      modelSelection(CURSOR_DRIVER, "gpt-5.4", {
        reasoning: "high",
      }),
    );
  });

  it("updates only the draft when sticky persistence is omitted", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );
    store.setModelSelection(
      threadRef,
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );

    store.setProviderModelOptions(
      threadRef,
      CLAUDE_AGENT_DRIVER,
      toSelections({ thinking: false }),
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        thinking: false,
      }),
    );
    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }));
  });

  it("does not clear other provider options when setting options for a single provider", () => {
    const store = useComposerDraftStore.getState();

    // Set options for both providers
    store.setModelOptions(
      threadRef,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    // Now set options for only codex — claudeAgent should be untouched
    store.setModelOptions(threadRef, providerModelOptions({ codex: { reasoningEffort: "xhigh" } }));

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider[CODEX_INSTANCE]?.options).toEqual(
      createModelSelection(CODEX_INSTANCE, "gpt-5.4", toSelections({ reasoningEffort: "xhigh" }))
        .options,
    );
    expect(draft?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE]?.options).toEqual(
      createModelSelection(
        CLAUDE_AGENT_INSTANCE,
        "claude-opus-4-6",
        toSelections({ effort: "max" }),
      ).options,
    );
  });

  it("preserves other provider options when switching the active model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setModelOptions(
      threadRef,
      providerModelOptions({
        codex: { fastMode: true },
        claudeAgent: { effort: "max" },
      }),
    );

    store.setModelSelection(threadRef, modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6"));

    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE]).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );
    expect(draft?.modelSelectionByProvider[CODEX_INSTANCE]?.options).toEqual(
      createModelSelection(CODEX_INSTANCE, "gpt-5.4", toSelections({ fastMode: true })).options,
    );
    expect(draft?.activeProvider).toBe("claudeAgent");
  });

  it("creates the first sticky snapshot from provider option changes", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.4"));

    store.setProviderModelOptions(threadRef, CODEX_DRIVER, toSelections({ fastMode: true }), {
      persistSticky: true,
    });

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider[CODEX_INSTANCE]).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.4", {
        fastMode: true,
      }),
    );
  });

  it("stores provider option changes on a selected custom instance", () => {
    const store = useComposerDraftStore.getState();

    store.setProviderModelOptions(
      threadRef,
      CODEX_DRIVER,
      toSelections({ reasoningEffort: "low" }),
      {
        instanceId: CODEX_SECONDARY_INSTANCE,
        model: "gpt-5-codex",
        persistSticky: true,
      },
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_SECONDARY_INSTANCE],
    ).toEqual(
      expect.objectContaining({
        instanceId: CODEX_SECONDARY_INSTANCE,
        options: [{ id: "reasoningEffort", value: "low" }],
      }),
    );
    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.activeProvider).toBe(CODEX_SECONDARY_INSTANCE);
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe(CODEX_SECONDARY_INSTANCE);
    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider[CODEX_INSTANCE]).toBe(
      undefined,
    );
    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CODEX_SECONDARY_INSTANCE],
    ).toEqual(
      expect.objectContaining({
        instanceId: CODEX_SECONDARY_INSTANCE,
        options: [{ id: "reasoningEffort", value: "low" }],
      }),
    );
  });

  it("updates only the draft when sticky persistence is disabled", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );
    store.setModelSelection(
      threadRef,
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }),
    );

    store.setProviderModelOptions(
      threadRef,
      CLAUDE_AGENT_DRIVER,
      toSelections({ thinking: false }),
      {
        persistSticky: false,
      },
    );

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        thinking: false,
      }),
    );
    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CLAUDE_AGENT_INSTANCE],
    ).toEqual(modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { effort: "max" }));
  });
});

describe("composerDraftStore setModelSelection", () => {
  const threadId = ThreadId.make("thread-model");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("keeps explicit model overrides instead of coercing to null", () => {
    const store = useComposerDraftStore.getState();

    store.setModelSelection(threadRef, modelSelection(CODEX_DRIVER, "gpt-5.3-codex"));

    expect(
      draftFor(threadId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider[CODEX_INSTANCE],
    ).toEqual(modelSelection(CODEX_DRIVER, "gpt-5.3-codex"));
  });
});

describe("composerDraftStore sticky composer settings", () => {
  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores a sticky model selection", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", {
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider[CODEX_INSTANCE]).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", {
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex");
  });

  it("normalizes empty sticky model options by dropping selection options", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(modelSelection(CODEX_DRIVER, "gpt-5.4"));

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider[CODEX_INSTANCE]).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.4"),
    );
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("codex");
  });

  it("drops empty cursor model options when normalizing sticky state", () => {
    const store = useComposerDraftStore.getState();

    store.setStickyModelSelection(
      modelSelection(CURSOR_DRIVER, "gpt-5.4", {
        reasoning: undefined,
        fastMode: undefined,
        thinking: undefined,
        contextWindow: undefined,
      }),
    );

    expect(
      useComposerDraftStore.getState().stickyModelSelectionByProvider[CURSOR_INSTANCE],
    ).toEqual(modelSelection(CURSOR_DRIVER, "gpt-5.4"));
    expect(useComposerDraftStore.getState().stickyActiveProvider).toBe("cursor");
  });

  // D10: the effort a new draft starts on is Extra High's to set; a remembered effort (written
  // whenever any trait was touched, the default included) is not carried over. The other traits are.
  it("a new draft inherits the remembered model and traits, never the effort", () => {
    const store = useComposerDraftStore.getState();
    const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, ThreadId.make("thread-sticky-effort"));
    const draftId = ThreadId.make("thread-sticky-effort");

    store.setStickyModelSelection(
      modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", {
        effort: "medium",
        contextWindow: "1m",
      }),
    );
    store.setStickyModelSelection(
      modelSelection(CODEX_DRIVER, "gpt-5.4", { reasoningEffort: "medium" }),
    );
    store.applyStickyState(threadRef);

    expect(draftFor(draftId, TEST_ENVIRONMENT_ID)?.modelSelectionByProvider).toEqual({
      claudeAgent: modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6", { contextWindow: "1m" }),
      codex: modelSelection(CODEX_DRIVER, "gpt-5.4"),
    });
  });

  it("applies sticky activeProvider to new drafts", () => {
    const store = useComposerDraftStore.getState();
    const threadId = ThreadId.make("thread-sticky-active-provider");
    const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

    store.setStickyModelSelection(modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6"));
    store.applyStickyState(threadRef);

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toMatchObject({
      modelSelectionByProvider: {
        claudeAgent: modelSelection(CLAUDE_AGENT_DRIVER, "claude-opus-4-6"),
      },
      activeProvider: "claudeAgent",
    });
  });
});

describe("composerDraftStore provider-scoped option updates", () => {
  const threadId = ThreadId.make("thread-provider");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("retains off-provider option memory without changing the active selection", () => {
    const store = useComposerDraftStore.getState();
    store.setModelSelection(
      threadRef,
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", {
        reasoningEffort: "medium",
      }),
    );
    store.setProviderModelOptions(threadRef, CLAUDE_AGENT_DRIVER, toSelections({ effort: "max" }));
    const draft = draftFor(threadId, TEST_ENVIRONMENT_ID);
    expect(draft?.modelSelectionByProvider[CODEX_INSTANCE]).toEqual(
      modelSelection(CODEX_DRIVER, "gpt-5.3-codex", { reasoningEffort: "medium" }),
    );
    expect(draft?.modelSelectionByProvider[CLAUDE_AGENT_INSTANCE]?.options).toEqual(
      createModelSelection(
        CLAUDE_AGENT_INSTANCE,
        "claude-opus-4-6",
        toSelections({ effort: "max" }),
      ).options,
    );
    expect(draft?.activeProvider).toBe("codex");
  });
});

describe("composerDraftStore runtime and interaction settings", () => {
  const threadId = ThreadId.make("thread-settings");
  const threadRef = scopeThreadRef(TEST_ENVIRONMENT_ID, threadId);

  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("stores runtime mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadRef, "approval-required");

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.runtimeMode).toBe("approval-required");
  });

  it("stores interaction mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setInteractionMode(threadRef, "plan");

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)?.interactionMode).toBe("plan");
  });

  it("removes empty settings-only drafts when overrides are cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadRef, "approval-required");
    store.setInteractionMode(threadRef, "plan");
    store.setRuntimeMode(threadRef, null);
    store.setInteractionMode(threadRef, null);

    expect(draftFor(threadId, TEST_ENVIRONMENT_ID)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createDeferredStorage
// ---------------------------------------------------------------------------

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("composer draft persistence", () => {
  it("defers attachment reads and serialization until typing stops, then restores the last draft", async () => {
    // Drafts persist into the signed-in account's storage only.
    vi.stubGlobal("window", {
      localStorage: createMockStorage(),
      sessionStorage: createMockStorage(),
    });
    openAccountLifetime("composer-persistence-test");
    await useComposerDraftStore.persist.clearStorage();
    vi.useFakeTimers();
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      resetComposerDraftStore();
      const heavyThreadId = ThreadId.make("heavy-draft");
      const typingThreadId = ThreadId.make("typing-draft");
      const heavyRef = scopeThreadRef(TEST_ENVIRONMENT_ID, heavyThreadId);
      const typingRef = scopeThreadRef(TEST_ENVIRONMENT_ID, typingThreadId);
      const heavyKey = scopedThreadKey(heavyRef);
      useComposerDraftStore.getState().setPrompt(heavyRef, "Keep this image");
      const attachments = [
        {
          id: "heavy-image",
          name: "image.png",
          mimeType: "image/png",
          sizeBytes: 49_152,
          dataUrl: `data:image/png;base64,${"AQID".repeat(16_384)}`,
        },
      ];
      let attachmentReads = 0;
      useComposerDraftStore.setState((state) => ({
        draftsByThreadKey: {
          ...state.draftsByThreadKey,
          [heavyKey]: {
            ...state.draftsByThreadKey[heavyKey]!,
            get persistedAttachments() {
              attachmentReads += 1;
              return attachments;
            },
          },
        },
      }));
      attachmentReads = 0;
      stringify.mockClear();

      for (let index = 1; index <= 20; index++) {
        useComposerDraftStore.getState().setPrompt(typingRef, `Draft ${index}`);
      }
      expect(attachmentReads).toBe(0);
      expect(stringify).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      expect(attachmentReads).toBe(1);
      expect(stringify).toHaveBeenCalledTimes(1);

      resetComposerDraftStore();
      await useComposerDraftStore.persist.rehydrate();
      expect(draftFor(typingThreadId, TEST_ENVIRONMENT_ID)?.prompt).toBe("Draft 20");
      expect(draftFor(heavyThreadId, TEST_ENVIRONMENT_ID)?.persistedAttachments).toEqual(
        attachments,
      );
    } finally {
      stringify.mockRestore();
      await useComposerDraftStore.persist.clearStorage();
      vi.useRealTimers();
      closeAccountLifetime();
      vi.unstubAllGlobals();
      resetComposerDraftStore();
    }
  });
});

describe("createDeferredStorage", () => {
  const serialize = vi.fn((value: string) => `s:${value}`);

  beforeEach(() => {
    vi.useFakeTimers();
    serialize.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates getItem immediately", () => {
    const base = createMockStorage();
    base.getItem.mockReturnValueOnce("value");
    const storage = createDeferredStorage(base, serialize);

    expect(storage.getItem("key")).toBe("value");
    expect(base.getItem).toHaveBeenCalledWith("key");
  });

  it("neither serializes nor writes until the debounce fires", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    expect(serialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(serialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "s:v1");
  });

  it("serializes and writes only the last value when setItem is called rapidly", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    storage.setItem("key", "v2");
    storage.setItem("key", "v3");

    vi.advanceTimersByTime(300);
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "s:v3");
  });

  it("removeItem cancels a pending setItem write", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    storage.removeItem("key");

    vi.advanceTimersByTime(300);
    expect(serialize).not.toHaveBeenCalled();
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).toHaveBeenCalledWith("key");
  });

  it("flush serializes and writes the pending value immediately", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    storage.flush();
    expect(base.setItem).toHaveBeenCalledWith("key", "s:v1");

    // Timer should be cancelled; no duplicate write.
    vi.advanceTimersByTime(300);
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.flush();
    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("flush after removeItem is a no-op", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.flush();

    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("setItem works normally after removeItem cancels a pending write", () => {
    const base = createMockStorage();
    const storage = createDeferredStorage(base, serialize);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.setItem("key", "v2");

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "s:v2");
  });
});
