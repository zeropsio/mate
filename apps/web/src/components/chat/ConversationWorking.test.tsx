import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ConversationWorking, type WorkingBubble } from "./ConversationWorking";

type SaidKind = "note" | "question" | "thought";

const said = (kind: SaidKind, key: string): WorkingBubble => ({
  kind,
  key,
  body: <p>{`${kind} ${key}`}</p>,
});

/** A stretch some way in: every kind at more than one age, oldest first. */
const STRETCH: ReadonlyArray<WorkingBubble> = [
  said("thought", "t1"),
  said("note", "n1"),
  said("thought", "t2"),
  said("question", "q1"),
  said("note", "n2"),
  said("thought", "t3"),
];

/** The stream as drawn, oldest first: each bubble's age, what aging put on it, and its own hand. */
function streamOf(bubbles: ReadonlyArray<WorkingBubble>) {
  const markup = renderToStaticMarkup(
    <ConversationWorking
      activity={null}
      answering={false}
      browser={null}
      bubbles={bubbles}
      dock={null}
      environmentId={null}
      incidents={[]}
      onOpenAgents={() => undefined}
      speaker={{ name: "Nova", tint: "sky" }}
      threadRef={null}
    />,
  );
  return [
    ...markup.matchAll(
      /data-stream-age="(\d+)"><div class="min-h-0"><div class="([^"]*)"><div class="([^"]*)" data-stream-bubble="(\w+)"/g,
    ),
  ].map(([, age, aging = "", hand = "", kind]) => ({
    age: Number(age),
    aging: aging.split(" "),
    hand: hand.split(" "),
    kind,
  }));
}

const drawn = streamOf(STRETCH);

describe("the Mate's stream", () => {
  it("draws every bubble it was given, the newest at age 0", () => {
    expect(drawn.map((bubble) => [bubble.kind, bubble.age])).toEqual([
      ["thought", 5],
      ["note", 4],
      ["thought", 3],
      ["question", 2],
      ["note", 1],
      ["thought", 0],
    ]);
  });

  // Its words to the person are a filled bubble, its corner toward the face;
  // its thinking is text on a hairline, muted and in italics, with no fill —
  // at every age, so a light thought never reads as an aged note, nor an aged
  // note as a thought.
  it.each([
    { kind: "note", filled: true, cornered: true, italic: false, hairline: false },
    { kind: "question", filled: true, cornered: true, italic: false, hairline: false },
    { kind: "thought", filled: false, cornered: false, italic: true, hairline: true },
  ])(
    "draws a $kind in its own hand at every age",
    ({ kind, filled, cornered, italic, hairline }) => {
      const ofKind = drawn.filter((bubble) => bubble.kind === kind);
      expect(ofKind.length).toBeGreaterThan(0);
      for (const { hand } of ofKind) {
        expect(hand.some((name) => name.startsWith("bg-"))).toBe(filled);
        expect(hand.includes("rounded-es-md")).toBe(cornered);
        expect(hand.includes("italic")).toBe(italic);
        expect(hand.includes("before:bg-border")).toBe(hairline);
      }
    },
  );

  it("keeps a thought in a note's box, so neither moves the stream", () => {
    // What sizes a box: its padding, margin, border and width.
    const box = (kind: string) =>
      drawn
        .find((bubble) => bubble.kind === kind)
        ?.hand.filter((name) => /^(p|m|border|w|min-w|max-w|h|min-h|max-h)[a-z]?(-|$)/.test(name));
    // The hairline is drawn, never a border that would take a pixel of width.
    expect(box("thought")).toEqual(box("note"));
    expect(box("note")).toEqual(["w-fit", "max-w-full", "px-3.5", "py-2"]);
  });

  it.each(drawn.filter((bubble) => bubble.age > 0))(
    "ages a $kind at $age by dimming and shrinking it, never by repainting it",
    ({ aging }) => {
      for (const name of aging) {
        expect(name).toMatch(
          /^(origin-bottom-left|pt-2|transition|duration-500|scale-\d+|opacity-\d+)$/,
        );
      }
      expect(aging.some((name) => name.startsWith("opacity-"))).toBe(true);
    },
  );
});
