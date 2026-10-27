/**
 * A crewmate's `@handle` in the lead's composer is drawn as the crewmate — its
 * face in its tint and `@handle` — while its text stays `@handle`, and only
 * the crewmates the composer offers are drawn so.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot, $isElementNode, type DecoratorNode, type LexicalEditor } from "lexical";
import type { ReactElement } from "react";
import { act, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor } from "../composer-logic";
import {
  ComposerPromptEditor,
  type ComposerCrewmateChip,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditor";

vi.mock("./chat/FileTagChip", () => ({
  FILE_TAG_CHIP_CLASS_NAME: "",
  FileTagChipContent: () => null,
}));
vi.mock("./chat/ComposerPendingTerminalContexts", () => ({
  ComposerPendingTerminalContextChip: () => null,
}));
vi.mock("./chat/AssistantCitationChip", () => ({ AssistantCitationChip: () => null }));

let lexicalEditor: LexicalEditor;
// The real composer, its nodes and its snapshot; only the DOM view is left out.
vi.mock("@lexical/react/LexicalPlainTextPlugin", () => ({
  PlainTextPlugin: function HeadlessEditor() {
    [lexicalEditor] = useLexicalComposerContext();
    return null;
  },
}));

let renderer: ReactTestRenderer | undefined;
const editorRef = createRef<ComposerPromptEditorHandle>();
const BACKEND: ComposerCrewmateChip = { handle: "backend", tint: "sky" };

async function renderPrompt(value: string, crewmates?: ReadonlyArray<ComposerCrewmateChip>) {
  await act(() => {
    renderer = create(
      <ComposerPromptEditor
        value={value}
        cursor={collapseExpandedComposerCursor(value, value.length)}
        terminalContexts={[]}
        skills={[]}
        {...(crewmates === undefined ? {} : { crewmates })}
        disabled={false}
        placeholder="Write a prompt"
        onRemoveTerminalContext={() => {}}
        onChange={() => {}}
        onPaste={() => {}}
        editorRef={editorRef}
      />,
    );
  });
}

function nodeTypes(): ReadonlyArray<string> {
  return lexicalEditor.getEditorState().read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw new Error("Expected a composer paragraph");
    return paragraph.getChildren().map((node) => node.getType());
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", {
    activeElement: null,
    documentElement: { classList: { contains: () => false } },
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("a crewmate in the composer", () => {
  it("is drawn as the crewmate the composer offers, its text still @handle", async () => {
    await renderPrompt("Ask @backend first", [BACKEND]);
    expect(nodeTypes()).toEqual(["text", "composer-crewmate", "text"]);
    expect(editorRef.current?.readSnapshot().value).toBe("Ask @backend first");
  });

  it("is a file's mention where the composer offers no crewmates", async () => {
    await renderPrompt("Ask @backend first");
    expect(nodeTypes()).toEqual(["text", "composer-mention", "text"]);
  });

  it("draws its chip with its face in its tint and its @handle", async () => {
    await renderPrompt("Ask @backend first", [BACKEND]);
    const chip = lexicalEditor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) throw new Error("Expected a composer paragraph");
      const node = paragraph.getChildAtIndex(1) as DecoratorNode<ReactElement>;
      return node.decorate(lexicalEditor, lexicalEditor._config);
    });
    const html = renderToStaticMarkup(chip);
    expect(html).toContain('data-composer-crewmate-chip="backend"');
    expect(html).toContain('data-mate-face-tint="sky"');
    expect(html).toContain(">@backend<");
  });
});
