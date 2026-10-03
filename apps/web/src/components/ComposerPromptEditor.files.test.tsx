/**
 * Files in the composer's text: each file's place in the prompt is one
 * placeholder of its own, matched by order to the draft's files, and the
 * editor reports the files it holds in the order they sit.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, type LexicalEditor } from "lexical";
import { act, createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor } from "../composer-logic";
import { INLINE_FILE_PLACEHOLDER as F } from "../lib/composerFiles";
import { INLINE_PICTURE_PLACEHOLDER as P } from "../lib/composerPictures";
import type { ComposerFileView } from "./chat/ComposerFile";
import type { ComposerPictureView } from "./chat/ComposerPicture";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";

vi.mock("./chat/FileTagChip", () => ({
  FILE_TAG_CHIP_CLASS_NAME: "",
  FileTagChipContent: () => null,
}));
vi.mock("./chat/ComposerPendingTerminalContexts", () => ({
  ComposerPendingTerminalContextChip: () => null,
}));
vi.mock("./chat/AssistantCitationChip", () => ({ AssistantCitationChip: () => null }));

let lexicalEditor: LexicalEditor;
vi.mock("@lexical/react/LexicalPlainTextPlugin", () => ({
  PlainTextPlugin: function HeadlessEditor() {
    [lexicalEditor] = useLexicalComposerContext();
    return null;
  },
}));

let renderer: ReactTestRenderer | undefined;
const editorRef = createRef<ComposerPromptEditorHandle>();
const changes: Array<{ value: string; pictureIds: string[]; fileIds: string[] }> = [];

const picture = (id: string, number: number): ComposerPictureView => ({
  id,
  number,
  name: `${id}.png`,
  src: null,
  width: 120,
  height: 80,
  keepOriginal: false,
  preparing: false,
  failed: false,
});

const file = (id: string, number: number): ComposerFileView => ({
  id,
  number,
  name: `${id}.pdf`,
  sizeBytes: 2048,
  status: "ready",
  progress: 0,
});

function composer(
  value: string,
  pictures: ReadonlyArray<ComposerPictureView>,
  files: ReadonlyArray<ComposerFileView> = [],
) {
  return (
    <ComposerPromptEditor
      value={value}
      cursor={collapseExpandedComposerCursor(value, value.length)}
      terminalContexts={[]}
      skills={[]}
      pictures={pictures}
      files={files}
      disabled={false}
      placeholder="Write a prompt"
      onRemoveTerminalContext={() => {}}
      onChange={(nextValue, _cursor, _expanded, _adjacent, _contexts, pictureIds, fileIds) => {
        changes.push({ value: nextValue, pictureIds, fileIds });
      }}
      onPaste={() => {}}
      editorRef={editorRef}
    />
  );
}

async function render(
  value: string,
  pictures: ReadonlyArray<ComposerPictureView>,
  files: ReadonlyArray<ComposerFileView>,
) {
  await act(() => {
    if (renderer) renderer.update(composer(value, pictures, files));
    else renderer = create(composer(value, pictures, files));
  });
}

function nodeTypes(): string[] {
  return lexicalEditor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw new Error("Expected a composer paragraph");
    return paragraph.getChildren().map((node) => node.getType());
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null });
  changes.length = 0;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("files in the composer's text", () => {
  it.each([
    [
      "a file between words sits between them",
      `See ${F} please`,
      [],
      [file("spec", 1)],
      ["text", "composer-file", "text"],
      [],
      ["spec"],
    ],
    [
      "pictures and files keep their own orders",
      `${F}${P}${F}`,
      [picture("one", 1)],
      [file("a", 1), file("b", 2)],
      ["composer-file", "composer-picture", "composer-file"],
      ["one"],
      ["a", "b"],
    ],
    [
      "a place whose file is gone drops out",
      `a${F}b${F}`,
      [],
      [file("a", 1)],
      ["text", "composer-file", "text"],
      [],
      ["a"],
    ],
  ])("%s", async (_label, prompt, pictures, files, types, pictureIds, fileIds) => {
    await render(prompt, pictures, files);
    expect(nodeTypes()).toEqual(types);
    expect(editorRef.current?.readSnapshot().pictureIds).toEqual(pictureIds);
    expect(editorRef.current?.readSnapshot().fileIds).toEqual(fileIds);
  });

  it("writes each file back as its placeholder", async () => {
    const prompt = `Read:${F}and${P}`;
    await render(prompt, [picture("one", 1)], [file("a", 1)]);
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
  });

  it("reports the files left when one is removed from the text", async () => {
    await render(`a${F}b${F}`, [], [file("a", 1), file("b", 2)]);
    await act(() => {
      lexicalEditor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow();
          if (!$isElementNode(paragraph)) return;
          paragraph
            .getChildren()
            .find((node) => node.getType() === "composer-file")
            ?.remove();
        },
        { discrete: true },
      );
    });
    expect(changes.at(-1)).toEqual({ value: `ab${F}`, pictureIds: [], fileIds: ["b"] });
  });
});
