/**
 * Pictures in the composer's text: each picture's place in the prompt is one
 * placeholder, matched by order to the draft's pictures, and the editor reports
 * the pictures it holds in the order they sit.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, type LexicalEditor } from "lexical";
import { act, createRef } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor } from "../composer-logic";
import { INLINE_PICTURE_PLACEHOLDER as P } from "../lib/composerPictures";
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
const changes: Array<{ value: string; pictureIds: string[] }> = [];

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

function composer(value: string, pictures: ReadonlyArray<ComposerPictureView>) {
  return (
    <ComposerPromptEditor
      value={value}
      cursor={collapseExpandedComposerCursor(value, value.length)}
      terminalContexts={[]}
      skills={[]}
      pictures={pictures}
      disabled={false}
      placeholder="Write a prompt"
      onRemoveTerminalContext={() => {}}
      onChange={(nextValue, _cursor, _expanded, _adjacent, _contexts, pictureIds) => {
        changes.push({ value: nextValue, pictureIds });
      }}
      onPaste={() => {}}
      editorRef={editorRef}
    />
  );
}

async function render(value: string, pictures: ReadonlyArray<ComposerPictureView>) {
  await act(() => {
    if (renderer) renderer.update(composer(value, pictures));
    else renderer = create(composer(value, pictures));
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

describe("pictures in the composer's text", () => {
  it.each([
    [
      "a picture between words sits between them",
      `The header feels off:${P}Can you fix it?`,
      [picture("one", 1)],
      ["text", "composer-picture", "text"],
      ["one"],
    ],
    [
      "two pictures keep the order of the draft's pictures",
      `${P}and${P}`,
      [picture("one", 1), picture("two", 2)],
      ["composer-picture", "text", "composer-picture"],
      ["one", "two"],
    ],
    [
      "a place whose picture is gone drops out",
      `a${P}b${P}`,
      [picture("one", 1)],
      ["text", "composer-picture", "text"],
      ["one"],
    ],
  ])("%s", async (_label, prompt, pictures, types, ids) => {
    await render(prompt, pictures);
    expect(nodeTypes()).toEqual(types);
    expect(editorRef.current?.readSnapshot().pictureIds).toEqual(ids);
  });

  it("writes each picture back as its placeholder", async () => {
    const prompt = `Look:${P}and${P}`;
    await render(prompt, [picture("one", 1), picture("two", 2)]);
    expect(editorRef.current?.readSnapshot().value).toBe(prompt);
  });

  it("reorders its pictures when the draft's order changes", async () => {
    await render(`${P}x${P}`, [picture("one", 1), picture("two", 2)]);
    await render(`${P}x${P}`, [picture("two", 1), picture("one", 2)]);
    expect(editorRef.current?.readSnapshot().pictureIds).toEqual(["two", "one"]);
  });

  it("reports the pictures left when one is removed from the text", async () => {
    await render(`a${P}b${P}`, [picture("one", 1), picture("two", 2)]);
    await act(() => {
      lexicalEditor.update(
        () => {
          const paragraph = $getRoot().getFirstChildOrThrow();
          if (!$isElementNode(paragraph)) return;
          paragraph
            .getChildren()
            .find((node) => node.getType() === "composer-picture")
            ?.remove();
        },
        { discrete: true },
      );
    });
    expect(changes.at(-1)).toEqual({ value: `ab${P}`, pictureIds: ["two"] });
  });
});
