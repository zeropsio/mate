// @vitest-environment happy-dom
/**
 * Copy, cut and paste in the composer, run for real: the editor mounted in a
 * DOM with its plain-text plugin and history, and clipboard events dispatched
 * on its root. A picture's place never reaches the clipboard as a character;
 * a cut picture moves with its words.
 */
import {
  $getRoot,
  $isTextNode,
  KEY_BACKSPACE_COMMAND,
  UNDO_COMMAND,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor } from "../composer-logic";
import { INLINE_PICTURE_PLACEHOLDER as P } from "../lib/composerPictures";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER as T } from "../lib/terminalContext";
import type { ComposerPictureView } from "./chat/ComposerPicture";
import {
  COMPOSER_CLIPBOARD_TYPE,
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditor";

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

let root: Root | undefined;
let editable: HTMLElement;
let editor: LexicalEditor;
const changes: Array<{ value: string; pictureIds: string[] }> = [];
const pastePictures = vi.fn((ids: ReadonlyArray<string>): ReadonlyArray<string | null> => ids);

async function mount(value: string, pictures: ReadonlyArray<ComposerPictureView>) {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(() =>
    root!.render(
      <ComposerPromptEditor
        value={value}
        cursor={collapseExpandedComposerCursor(value, value.length)}
        terminalContexts={[]}
        skills={[]}
        pictures={pictures}
        onPastePictures={pastePictures}
        disabled={false}
        placeholder="Write a prompt"
        onRemoveTerminalContext={() => {}}
        onChange={(nextValue, _cursor, _expanded, _adjacent, _contexts, pictureIds) => {
          changes.push({ value: nextValue, pictureIds });
        }}
        onPaste={() => {}}
        editorRef={createRef<ComposerPromptEditorHandle>()}
      />,
    ),
  );
  editable = container.querySelector<HTMLElement>("[contenteditable]")!;
  editor = (editable as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
}

/** A point at a text offset of the composer's one paragraph, each picture one character. */
function $pointAt(offset: number) {
  const paragraph = $getRoot().getFirstChildOrThrow<ElementNode>();
  const children = paragraph.getChildren();
  let remaining = offset;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]!;
    const size = child.getTextContentSize();
    if ($isTextNode(child) && remaining <= size) {
      return { key: child.getKey(), offset: remaining, type: "text" as const };
    }
    if (remaining === 0)
      return { key: paragraph.getKey(), offset: index, type: "element" as const };
    remaining -= size;
  }
  return { key: paragraph.getKey(), offset: children.length, type: "element" as const };
}

/** Where a text offset sits in the editor's DOM, as a person's selection would put it. */
function domPointAt(offset: number): [Node, number] {
  return editor.getEditorState().read(() => {
    const point = $pointAt(offset);
    const element = editor.getElementByKey(point.key)!;
    return point.type === "text" ? [element.firstChild!, point.offset] : [element, point.offset];
  });
}

/** Selects from one text offset to another, as a person does: in the DOM. */
async function select(start: number, end: number) {
  const [anchorNode, anchorOffset] = domPointAt(start);
  const [focusNode, focusOffset] = domPointAt(end);
  await act(() => {
    editable.focus();
    document.getSelection()!.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  });
}

async function clipboardEvent(type: "copy" | "cut" | "paste", data = new DataTransfer()) {
  await act(() => {
    editable.dispatchEvent(
      new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  return data;
}

const text = () => editor.getEditorState().read(() => $getRoot().getTextContent());
const lastChange = () => changes.at(-1);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  changes.length = 0;
  pastePictures.mockClear();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("copying from the composer", () => {
  const value = `The old${P} header\nwith the new one:${P}`;

  it("puts the words on the clipboard, never a picture's place", async () => {
    await mount(value, [picture("one", 1), picture("two", 2)]);
    await select(0, text().length);

    const data = await clipboardEvent("copy");

    expect(data.getData("text/plain")).toBe("The old header\nwith the new one:");
    expect(JSON.parse(data.getData(COMPOSER_CLIPBOARD_TYPE))).toEqual({
      text: value,
      pictures: ["one", "two"],
    });
  });

  it("leaves words alone to the editor's own copy", async () => {
    await mount(value, [picture("one", 1), picture("two", 2)]);
    await select(0, 3);

    const data = await clipboardEvent("copy");

    expect(data.getData("text/plain")).toBe("The");
    expect(data.types).not.toContain(COMPOSER_CLIPBOARD_TYPE);
  });
});

describe("pasting into the composer", () => {
  it("a cut picture moves with its words", async () => {
    await mount(`The old${P} header\nwith the new one:${P}`, [
      picture("one", 1),
      picture("two", 2),
    ]);
    await select(4, 15);

    const data = await clipboardEvent("cut");
    expect(data.getData("text/plain")).toBe("old header");
    expect(lastChange()).toEqual({ value: `The \nwith the new one:${P}`, pictureIds: ["two"] });

    await select(text().length, text().length);
    await clipboardEvent("paste", data);

    expect(pastePictures).toHaveBeenCalledExactlyOnceWith(["one"]);
    expect(lastChange()).toEqual({
      value: `The \nwith the new one:${P}old${P} header`,
      pictureIds: ["two", "one"],
    });
  });

  it("a picture the composer cannot place again leaves its words", async () => {
    pastePictures.mockImplementationOnce((ids) => ids.map(() => null));
    await mount(`Look${P}`, [picture("one", 1)]);
    await select(0, 5);
    const data = await clipboardEvent("copy");

    await select(5, 5);
    await clipboardEvent("paste", data);

    expect(lastChange()).toEqual({ value: `Look${P}Look`, pictureIds: ["one"] });
  });

  it("a picture copied again takes the place the composer gives it", async () => {
    pastePictures.mockImplementationOnce((ids) => ids.map((id) => `${id}-again`));
    await mount(`Look${P}`, [picture("one", 1)]);
    await select(0, 5);
    const data = await clipboardEvent("copy");

    await select(5, 5);
    await clipboardEvent("paste", data);

    expect(lastChange()).toEqual({ value: `Look${P}Look${P}`, pictureIds: ["one", "one-again"] });
  });

  it("text from elsewhere comes without picture or context places", async () => {
    await mount(`Before${P}`, [picture("one", 1)]);
    await select(6, 6);
    const data = new DataTransfer();
    data.setData("text/plain", `Compare the old${P} header${T} now`);

    await clipboardEvent("paste", data);

    expect(lastChange()).toEqual({
      value: `BeforeCompare the old header now${P}`,
      pictureIds: ["one"],
    });
    expect(pastePictures).not.toHaveBeenCalled();
  });
});

describe("undo in the composer", () => {
  it("a picture deleted with Backspace comes back in its place", async () => {
    await mount(`Look${P}here`, [picture("one", 1)]);
    await select(5, 5);

    await act(() => {
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }),
      );
    });
    expect(lastChange()).toEqual({ value: "Lookhere", pictureIds: [] });

    await act(() => {
      editor.dispatchCommand(UNDO_COMMAND, undefined);
    });
    expect(lastChange()).toEqual({ value: `Look${P}here`, pictureIds: ["one"] });
  });
});
