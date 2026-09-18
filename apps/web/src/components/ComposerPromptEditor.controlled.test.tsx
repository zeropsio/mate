/**
 * The controlled round trip: the prompt the composer is handed, the prompt the
 * editor holds, and the one report that reconciles them.
 *
 * The screen owns the prompt and the editor is told what it is, so every write
 * from outside comes back through the change listener as if someone had typed
 * it. Saying that echo out loud would have the screen write what it just read,
 * for ever — `Maximum update depth exceeded`, measured live (`verified.md`,
 * 2026-09-18). Staying quiet for a *moment* instead is what these tests are
 * about: a keystroke that lands inside that moment must still be heard.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $getSelection, type LexicalEditor } from "lexical";
import { act, createRef, useEffect, useState } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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
// Keep the real composer, its nodes, its updates and its snapshot API. Only
// the DOM view is omitted so Lexical runs headlessly in this component test.
vi.mock("@lexical/react/LexicalPlainTextPlugin", () => ({
  PlainTextPlugin: function HeadlessEditor() {
    [lexicalEditor] = useLexicalComposerContext();
    return null;
  },
}));

let renderer: ReactTestRenderer | undefined;
let renders = 0;
const changes: Array<{ value: string; cursor: number }> = [];
const editorRef = createRef<ComposerPromptEditorHandle>();

/** Writes the prompt from outside the editor, the way a menu or a recall does. */
let writePrompt: (prompt: string) => void = () => {};

/**
 * Makes the editor read as focused, which is what it is while someone types.
 * Headlessly there is no contenteditable, so the one thing the component asks
 * the DOM — is my root element the active element — is answered here. The
 * editor is told it stays headless, so Lexical keeps off the DOM either way.
 */
function focusEditor() {
  const rootElement = { nodeName: "DIV" };
  lexicalEditor.getRootElement = () => rootElement as unknown as HTMLElement;
  (lexicalEditor as unknown as { _headless: boolean })._headless = true;
  vi.stubGlobal("document", { activeElement: rootElement });
}

/** The screen around the editor: it holds the prompt and hands it back. */
function Harness() {
  const [prompt, setPrompt] = useState("");
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    writePrompt = (next: string) => {
      setPrompt(next);
      setCursor(next.length);
    };
    renders += 1;
  });
  return (
    <ComposerPromptEditor
      value={prompt}
      cursor={cursor}
      // The chat hands a fresh literal when the thread has no contexts.
      terminalContexts={[]}
      skills={[]}
      disabled={false}
      placeholder="Write a prompt"
      onRemoveTerminalContext={() => {}}
      onChange={(nextValue, nextCursor) => {
        changes.push({ value: nextValue, cursor: nextCursor });
        setPrompt(nextValue);
        setCursor(nextCursor);
      }}
      onPaste={() => {}}
      editorRef={editorRef}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null });
  renders = 0;
  changes.length = 0;
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

async function mount() {
  await act(() => {
    renderer = create(<Harness />);
  });
}

/** One keystroke, as Lexical sees it. */
function $typeInto(text: string) {
  $getRoot().selectEnd();
  $getSelection()?.insertText(text);
}

async function type(text: string) {
  await act(() => {
    lexicalEditor.update(() => $typeInto(text), { discrete: true });
  });
}

describe("the composer's controlled round trip", () => {
  it("settles after a typing burst", async () => {
    await mount();
    for (const character of "hello world".split("")) {
      await type(character);
    }
    expect(changes.at(-1)?.value).toBe("hello world");
    expect(changes.length).toBe("hello world".length);
    // One commit per keystroke, plus the mount. An echo that spoke would
    // double this, and React counts those commits towards the nested-update
    // limit it throws at.
    expect(renders).toBe("hello world".length + 1);
  });

  it("settles after a typing burst in a focused editor", async () => {
    await mount();
    focusEditor();
    for (const character of "hello world".split("")) {
      await type(character);
    }
    expect(changes.at(-1)?.value).toBe("hello world");
    expect(changes.length).toBe("hello world".length);
    // One commit per keystroke, plus the mount. An echo that spoke would
    // double this, and React counts those commits towards the nested-update
    // limit it throws at.
    expect(renders).toBe("hello world".length + 1);
  });

  it("stays quiet when the prompt it is handed is the prompt it already holds", async () => {
    await mount();
    await type("recalled");
    changes.length = 0;
    await act(() => {
      writePrompt("recalled");
    });
    expect(changes).toEqual([]);
  });

  it("stays quiet about a prompt written from outside", async () => {
    await mount();
    changes.length = 0;
    await act(() => {
      writePrompt("/plan the release");
    });
    expect(editorRef.current?.readSnapshot().value).toBe("/plan the release");
    expect(changes).toEqual([]);
  });

  it("hears a keystroke that lands in the same commit as a write from outside", async () => {
    await mount();
    focusEditor();
    await type("a");
    changes.length = 0;

    // Lexical commits an update in a microtask, so a keystroke queued before
    // that commit is carried by it — one commit, two intents. The screen's
    // write must not silence the keystroke riding along with it.
    await act(() => {
      queueMicrotask(() => {
        lexicalEditor.update(() => $typeInto("c"));
      });
      writePrompt("ab");
    });

    expect(editorRef.current?.readSnapshot().value).toBe("abc");
    expect(changes.at(-1)?.value).toBe("abc");
  });
});
