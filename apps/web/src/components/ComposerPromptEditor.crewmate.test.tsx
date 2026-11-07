/**
 * A crewmate's `@handle` in the lead's composer is drawn as the crewmate — its
 * face in its tint and `@handle` — while its text stays `@handle`, and only
 * the crewmates the composer offers are drawn so.
 */
import { $getRoot, $isElementNode, type DecoratorNode } from "lexical";
import type { ReactElement } from "react";
import { act, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { collapseExpandedComposerCursor } from "../composer-logic";
import { getLexicalEditor, resetLexicalEditor } from "./ComposerPromptEditor.test-fixture";
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

vi.mock("@lexical/react/LexicalPlainTextPlugin", async () => ({
  PlainTextPlugin: (await import("./ComposerPromptEditor.test-fixture")).HeadlessEditor,
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
  return getLexicalEditor()
    .getEditorState()
    .read(() => {
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
  resetLexicalEditor();
  vi.unstubAllGlobals();
});

describe("a crewmate in the composer", () => {
  it("is a file's mention where the composer offers no crewmates", async () => {
    await renderPrompt("Ask @backend first");
    expect(nodeTypes()).toEqual(["text", "composer-mention", "text"]);
  });

  it("draws its chip with its face in its tint and its @handle", async () => {
    await renderPrompt("Ask @backend first", [BACKEND]);
    expect(nodeTypes()).toEqual(["text", "composer-crewmate", "text"]);
    expect(editorRef.current?.readSnapshot().value).toBe("Ask @backend first");
    const chip = getLexicalEditor()
      .getEditorState()
      .read(() => {
        const paragraph = $getRoot().getFirstChildOrThrow();
        if (!$isElementNode(paragraph)) throw new Error("Expected a composer paragraph");
        const node = paragraph.getChildAtIndex(1) as DecoratorNode<ReactElement>;
        return node.decorate(getLexicalEditor(), getLexicalEditor()._config);
      });
    const html = renderToStaticMarkup(chip);
    expect(html).toContain('data-composer-crewmate-chip="backend"');
    expect(html).toContain('data-mate-face-tint="sky"');
    expect(html).toContain(">@backend<");
  });
});
