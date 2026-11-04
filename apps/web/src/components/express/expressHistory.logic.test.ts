import type { ChatAttachment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ChatMessage } from "~/types";
import { expressHistoryOf, expressPictureName, expressPictureOrigin } from "./expressHistory.logic";

const DESIGN = "urn:aaid:sc:VA6C2:5b1a2c3d-0000-4000-8000-000000000001";
const OTHER = "urn:aaid:sc:VA6C2:5b1a2c3d-0000-4000-8000-000000000002";

const picture = (id: string, name: string): ChatAttachment => ({
  type: "image",
  id,
  name,
  mimeType: "image/png",
  sizeBytes: 1000,
});
const file = (id: string, name: string): ChatAttachment => ({
  type: "file",
  id,
  name,
  mimeType: "image/png",
  sizeBytes: 9000,
});
const said = (
  role: "user" | "assistant",
  text: string,
  attachments: ReadonlyArray<ChatAttachment> = [],
) => ({ id: `${role}-${text}`, role, text, attachments }) as unknown as ChatMessage;

describe("expressPictureOrigin", () => {
  it.each([
    {
      title: "a picture saved from a design names the design it came from",
      name: expressPictureName(DESIGN, "png", 1),
      origin: { documentId: DESIGN },
    },
    {
      title: "a picture the composer re-encoded keeps its design",
      name: expressPictureName(DESIGN, "png", 1).replace(/\.png$/u, ".jpg"),
      origin: { documentId: DESIGN },
    },
    {
      title: "a picture edited without a design is the panel's, with no design",
      name: expressPictureName(undefined, "png", 1),
      origin: { documentId: undefined },
    },
    {
      title: "a picture the panel did not save is not the panel's",
      name: "image.png",
      origin: null,
    },
  ])("$title", ({ name, origin }) => {
    expect(expressPictureOrigin(name)).toEqual(origin);
  });
});

describe("expressHistoryOf", () => {
  it("lists the pictures the person sent from the panel, newest first", () => {
    const history = expressHistoryOf([
      said("user", "first", [picture("a", expressPictureName(undefined, "png", 1))]),
      said("assistant", "done"),
      said("user", "second", [
        picture("b", expressPictureName(undefined, "png", 2)),
        picture("pasted", "screenshot.png"),
      ]),
    ]);
    expect(history.map((entry) => entry.key)).toEqual(["picture:b", "picture:a"]);
  });

  it("a design's newest picture stands for it, in place of the Mate's link", () => {
    const history = expressHistoryOf([
      said("user", "mine", [picture("a", expressPictureName(DESIGN, "png", 1))]),
      said("user", "newer", [picture("b", expressPictureName(DESIGN, "png", 2))]),
      said("assistant", `Here it is: [Summer sale](https://new.express.adobe.com/id/${DESIGN})`),
    ]);
    expect(history.map((entry) => entry.key)).toEqual(["picture:b"]);
  });

  it("a design the Mate linked with no picture yet is listed by its words", () => {
    const history = expressHistoryOf([
      said(
        "assistant",
        `See [the banner](https://new.express.adobe.com/id/${OTHER}) or https://example.com/x`,
      ),
    ]);
    expect(history).toEqual([
      { kind: "design", key: `design:${OTHER}:the banner`, documentId: OTHER, words: "the banner" },
    ]);
  });

  it("a fitted picture opens again from the original sent beside it", () => {
    const name = expressPictureName(undefined, "png", 1);
    const [entry] = expressHistoryOf([
      said("user", "fitted", [
        picture("copy", name.replace(/\.png$/u, ".jpg")),
        file("original", name),
      ]),
    ]);
    expect(entry?.kind === "picture" ? entry.original?.attachmentId : null).toBe("original");
  });

  it("a link the Mate is still writing is read once its message is done", () => {
    const text = `See [the banner](https://new.express.adobe.com/id/${OTHER})`;
    const writing = { ...said("assistant", text), streaming: true } as ChatMessage;
    expect(expressHistoryOf([writing])).toEqual([]);
    expect(expressHistoryOf([{ ...writing, streaming: false }])).toHaveLength(1);
  });

  it.each([
    { title: "the same history again is the one already held", next: ["one", "two"], kept: true },
    { title: "a new entry is a new history", next: ["one", "two", "three"], kept: false },
    { title: "entries in another order are a new history", next: ["two", "one"], kept: false },
  ])("$title", ({ next, kept }) => {
    const linked = (names: ReadonlyArray<string>) =>
      names.map((name, index) =>
        said(
          "assistant",
          `[${name}](https://new.express.adobe.com/id/${DESIGN.slice(0, -1)}${index})`,
        ),
      );
    const held = expressHistoryOf(linked(["one", "two"]));
    expect(expressHistoryOf(linked(next), held) === held).toBe(kept);
  });
});
