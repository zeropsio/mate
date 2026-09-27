import { describe, expect, it } from "vite-plus/test";

import {
  collectCrewmateMentions,
  selectionTouchesMentionBoundary,
  splitPromptIntoComposerSegments,
  splitPromptIntoEditorSegments,
} from "./composer-editor-mentions";
import { INLINE_TERMINAL_CONTEXT_PLACEHOLDER } from "./lib/terminalContext";

describe("splitPromptIntoComposerSegments", () => {
  it("splits mention tokens followed by whitespace into mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md please")).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("does not convert an incomplete trailing mention token", () => {
    expect(splitPromptIntoComposerSegments("Inspect @AGENTS.md")).toEqual([
      { type: "text", text: "Inspect @AGENTS.md" },
    ]);
  });

  it("keeps newlines around mention tokens", () => {
    expect(splitPromptIntoComposerSegments("one\n@AGENTS.md \ntwo")).toEqual([
      { type: "text", text: "one\n" },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " \ntwo" },
    ]);
  });

  it("splits quoted mention tokens containing whitespace", () => {
    expect(splitPromptIntoComposerSegments('Inspect @"My File.md" please')).toEqual([
      { type: "text", text: "Inspect " },
      { type: "mention", path: "My File.md", source: '@"My File.md"' },
      { type: "text", text: " please" },
    ]);
  });

  it("unescapes quoted mention token content", () => {
    expect(splitPromptIntoComposerSegments('Inspect @"docs/My \\"File\\".md" please')).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: 'docs/My "File".md',
        source: '@"docs/My \\"File\\".md"',
      },
      { type: "text", text: " please" },
    ]);
  });

  it("splits generated markdown file links into mention segments", () => {
    expect(
      splitPromptIntoComposerSegments(
        "Inspect [package.json](path/to/package.json) before continuing",
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: "path/to/package.json",
        source: "[package.json](path/to/package.json)",
      },
      { type: "text", text: " before continuing" },
    ]);
  });

  it("does not turn normal web links into file mention segments", () => {
    expect(
      splitPromptIntoComposerSegments("Read [the docs](https://example.com/docs) first"),
    ).toEqual([{ type: "text", text: "Read [the docs](https://example.com/docs) first" }]);
  });

  it.each(["@expo/ui", "@jane/foo.js", "@scope/pkg/sub/path"])(
    "does not turn scoped package reference %s into file mention segments",
    (reference) => {
      const prompt = `Install ${reference} next`;
      expect(splitPromptIntoComposerSegments(prompt)).toEqual([{ type: "text", text: prompt }]);
    },
  );

  it("keeps IME-composed text containing a scoped package reference as text", () => {
    const prompt = "入力 @expo/ui　を追加";
    expect(splitPromptIntoComposerSegments(prompt)).toEqual([{ type: "text", text: prompt }]);
  });

  it("turns canonical scoped folder links into file mention segments", () => {
    expect(splitPromptIntoComposerSegments("Inspect [sub](@scope/pkg/sub) next")).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: "@scope/pkg/sub",
        source: "[sub](@scope/pkg/sub)",
      },
      { type: "text", text: " next" },
    ]);
  });

  it("decodes reserved path characters from generated links", () => {
    expect(
      splitPromptIntoComposerSegments(
        "Inspect [config#draft?.json](config%23draft%3F.json) before continuing",
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      {
        type: "mention",
        path: "config#draft?.json",
        source: "[config#draft?.json](config%23draft%3F.json)",
      },
      { type: "text", text: " before continuing" },
    ]);
  });

  it("splits skill tokens followed by whitespace into skill segments", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up please")).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "review-follow-up", source: "$review-follow-up" },
      { type: "text", text: " please" },
    ]);
  });

  it("splits digit-leading skill tokens into skill segments", () => {
    expect(splitPromptIntoComposerSegments("Use $2spec please")).toEqual([
      { type: "text", text: "Use " },
      { type: "skill", name: "2spec", source: "$2spec" },
      { type: "text", text: " please" },
    ]);
  });

  it("keeps digits-only dollar amounts and compact monetary expressions as text", () => {
    expect(splitPromptIntoComposerSegments("I'll pay $20 tomorrow")).toEqual([
      { type: "text", text: "I'll pay $20 tomorrow" },
    ]);
    expect(splitPromptIntoComposerSegments("Budget is $20k tomorrow")).toEqual([
      { type: "text", text: "Budget is $20k tomorrow" },
    ]);
    expect(splitPromptIntoComposerSegments("Cost is $100M total")).toEqual([
      { type: "text", text: "Cost is $100M total" },
    ]);
    expect(splitPromptIntoComposerSegments("Limit is $1e6 here")).toEqual([
      { type: "text", text: "Limit is $1e6 here" },
    ]);
  });

  it("does not convert an incomplete trailing skill token", () => {
    expect(splitPromptIntoComposerSegments("Use $review-follow-up")).toEqual([
      { type: "text", text: "Use $review-follow-up" },
    ]);
  });

  it("keeps inline terminal context placeholders at their prompt positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md please`,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " please" },
    ]);
  });

  it("preserves consecutive terminal context placeholders without dropping positions", () => {
    expect(
      splitPromptIntoComposerSegments(
        `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}tail`,
      ),
    ).toEqual([
      { type: "terminal-context", context: null },
      { type: "terminal-context", context: null },
      { type: "text", text: "tail" },
    ]);
  });

  it("keeps skill parsing alongside mentions and terminal placeholders", () => {
    expect(
      splitPromptIntoComposerSegments(
        `Inspect ${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}$review-follow-up after @AGENTS.md `,
      ),
    ).toEqual([
      { type: "text", text: "Inspect " },
      { type: "terminal-context", context: null },
      { type: "skill", name: "review-follow-up", source: "$review-follow-up" },
      { type: "text", text: " after " },
      { type: "mention", path: "AGENTS.md", source: "@AGENTS.md" },
      { type: "text", text: " " },
    ]);
  });
});

describe("selectionTouchesMentionBoundary", () => {
  it("returns true when selection includes the whitespace after a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json".length,
        "hi @package.json there".length,
      ),
    ).toBe(true);
  });

  it("returns true when selection includes the whitespace before a mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi there @package.json later",
        "hi there".length,
        "hi there ".length,
      ),
    ).toBe(true);
  });

  it("returns false when selection starts after the mention boundary whitespace", () => {
    expect(
      selectionTouchesMentionBoundary(
        "hi @package.json there",
        "hi @package.json ".length,
        "hi @package.json there".length,
      ),
    ).toBe(false);
  });

  it("returns true when selection includes whitespace after a mention following a terminal placeholder", () => {
    const prompt = `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md there`;
    expect(
      selectionTouchesMentionBoundary(
        prompt,
        `${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}@AGENTS.md`.length,
        prompt.length,
      ),
    ).toBe(true);
  });

  it("returns true when selection includes whitespace after a quoted mention", () => {
    expect(
      selectionTouchesMentionBoundary(
        'hi @"My File.md" there',
        'hi @"My File.md"'.length,
        'hi @"My File.md" there'.length,
      ),
    ).toBe(true);
  });

  it("returns true when selection includes whitespace after a markdown file link", () => {
    const prompt = "hi [package.json](path/to/package.json) there";
    expect(
      selectionTouchesMentionBoundary(
        prompt,
        "hi [package.json](path/to/package.json)".length,
        prompt.length,
      ),
    ).toBe(true);
  });
});

describe("collectCrewmateMentions", () => {
  const roster = ["backend", "frontend", "erik"];

  it.each<{ readonly name: string; readonly text: string; readonly handles: string[] }>([
    {
      name: "mentions in the order typed",
      text: "Rework @backend to X, implement Y on @frontend",
      handles: ["backend", "frontend"],
    },
    { name: "a mention at the very end", text: "Business plan, @erik", handles: ["erik"] },
    {
      name: "a mention before punctuation",
      text: "@erik, @backend: go",
      handles: ["erik", "backend"],
    },
    { name: "each crewmate once", text: "@backend X. @backend Y.", handles: ["backend"] },
    { name: "a handle not on the crew", text: "@ghost and @backend", handles: ["backend"] },
    { name: "an e-mail address", text: "mail ada@backend.io", handles: [] },
    { name: "a longer word that starts with a handle", text: "@backends", handles: [] },
  ])("$name", ({ text, handles }) => {
    expect(collectCrewmateMentions(text, roster)).toEqual(
      handles.map((handle) => ({ type: "mention", path: handle, source: "crewmate" })),
    );
  });
});

describe("splitPromptIntoEditorSegments", () => {
  const CREW = [
    { handle: "backend", tint: "sky" },
    { handle: "erik", tint: "amber" },
  ] as const;

  it.each<{
    readonly name: string;
    readonly prompt: string;
    readonly handles: Parameters<typeof splitPromptIntoEditorSegments>[2];
    readonly segments: ReturnType<typeof splitPromptIntoEditorSegments>;
  }>([
    {
      name: "a crewmate the composer offers is drawn as that crewmate",
      prompt: "Ask @backend and @erik first",
      handles: CREW,
      segments: [
        { type: "text", text: "Ask " },
        { type: "crewmate", handle: "backend", tint: "sky", source: "@backend" },
        { type: "text", text: " and " },
        { type: "crewmate", handle: "erik", tint: "amber", source: "@erik" },
        { type: "text", text: " first" },
      ],
    },
    {
      name: "a handle not on the list stays a file's mention",
      prompt: "Ask @frontend first",
      handles: CREW,
      segments: [
        { type: "text", text: "Ask " },
        { type: "mention", path: "frontend", source: "@frontend" },
        { type: "text", text: " first" },
      ],
    },
    {
      name: "a path that merely contains a handle stays a file's mention",
      prompt: "Read @backend/README.md now",
      handles: CREW,
      segments: [
        { type: "text", text: "Read " },
        { type: "mention", path: "backend/README.md", source: "@backend/README.md" },
        { type: "text", text: " now" },
      ],
    },
    {
      name: "a quoted mention of the same name stays a file's mention",
      prompt: 'Read @"backend" now',
      handles: CREW,
      segments: [
        { type: "text", text: "Read " },
        { type: "mention", path: "backend", source: '@"backend"' },
        { type: "text", text: " now" },
      ],
    },
    {
      name: "without crewmates on offer every mention parses as today",
      prompt: "Ask @backend first",
      handles: [],
      segments: splitPromptIntoComposerSegments("Ask @backend first"),
    },
    {
      name: "an unfinished handle is still text",
      prompt: "Ask @backend",
      handles: CREW,
      segments: [{ type: "text", text: "Ask @backend" }],
    },
  ])("$name", ({ prompt, handles, segments }) => {
    expect(splitPromptIntoEditorSegments(prompt, [], handles)).toEqual(segments);
  });
});
