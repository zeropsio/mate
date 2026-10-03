import { describe, expect, it } from "vite-plus/test";

import { INLINE_FILE_PLACEHOLDER, INLINE_PICTURE_PLACEHOLDER } from "~/lib/composerPictures";
import { heldDraftRuns } from "./ComposerRoom.logic";

const P = INLINE_PICTURE_PLACEHOLDER;
const F = INLINE_FILE_PLACEHOLDER;

// The held room lays out the draft as the composer will, so the composer takes its place
// without the page moving: its words, and its pictures and files at their size.
describe("heldDraftRuns", () => {
  it.each([
    { name: "no draft", text: "", runs: [] },
    { name: "one line", text: "Fix the build", runs: [{ kind: "text", text: "Fix the build" }] },
    {
      name: "lines, the last one empty as the editor keeps it",
      text: "one\ntwo\n",
      runs: [{ kind: "text", text: "one\ntwo\n​" }],
    },
    {
      name: "words around a picture",
      text: `Look at this${P}and fix it`,
      runs: [
        { kind: "text", text: "Look at this" },
        { kind: "picture" },
        { kind: "text", text: "and fix it" },
      ],
    },
    {
      name: "a picture and a file side by side",
      text: `${P}${F}`,
      runs: [{ kind: "picture" }, { kind: "file" }],
    },
  ])("$name", ({ text, runs }) => {
    expect(heldDraftRuns(text)).toEqual(runs);
  });
});
