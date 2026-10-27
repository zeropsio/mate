import { describe, expect, it } from "vite-plus/test";

import { INLINE_FILE_PLACEHOLDER, INLINE_PICTURE_PLACEHOLDER } from "~/lib/composerPictures";
import { heldDraftRuns, nextReadAlongRoom, releaseReadAlongRoom } from "./ComposerRoom.logic";

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

describe("read-along timeline room", () => {
  const pending = { threadKey: "Ada", turnId: "turn-1", pendingHeight: 194, readAlong: false };
  const reading = { ...pending, pendingHeight: 0, readAlong: true };
  const resolved = () => nextReadAlongRoom(nextReadAlongRoom(null, pending), reading);

  it("ownership resolving to read-along keeps the pending room in the timeline", () => {
    expect(resolved().heldHeight).toBe(194);
  });
  it("ownership already known on first paint holds no room", () => {
    expect(nextReadAlongRoom(null, reading).heldHeight).toBe(0);
  });
  it.each([
    { title: "a new turn releases the held room", input: { ...reading, turnId: "turn-2" } },
    {
      title: "a conversation change releases the held room",
      input: { ...reading, threadKey: "Bea" },
    },
    {
      title: "a writable composer releases the held room",
      input: { ...reading, readAlong: false },
    },
  ])("$title", ({ input }) => {
    expect(nextReadAlongRoom(resolved(), input).heldHeight).toBe(0);
  });
  it("the person's scroll releases the room without recapturing it", () => {
    expect(nextReadAlongRoom(releaseReadAlongRoom(resolved()), reading).heldHeight).toBe(0);
  });
  it("pending ownership uses its latest measured room", () => {
    const resized = nextReadAlongRoom(nextReadAlongRoom(null, pending), {
      ...pending,
      pendingHeight: 174,
    });
    expect(nextReadAlongRoom(resized, reading).heldHeight).toBe(174);
  });
});
