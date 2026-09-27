import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ageClass, ConversationWorking, type WorkingBubble } from "./ConversationWorking";

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

  // Its words to the person are a chat bubble, its corner toward the face;
  // its thinking is no bubble at all — no fill, no corner, no line — in
  // italics, at every age, so the two are told apart at a glance (the owner,
  // 2026-09-27: "almost no distinction between messages that are thoughts and
  // notes").
  it.each([
    { kind: "note", filled: true, cornered: true, italic: false },
    { kind: "question", filled: true, cornered: true, italic: false },
    { kind: "thought", filled: false, cornered: false, italic: true },
  ])("draws a $kind in its own hand at every age", ({ kind, filled, cornered, italic }) => {
    const ofKind = drawn.filter((bubble) => bubble.kind === kind);
    expect(ofKind.length).toBeGreaterThan(0);
    for (const { hand } of ofKind) {
      expect(hand.some((name) => name.startsWith("bg-"))).toBe(filled);
      expect(hand.some((name) => name.startsWith("rounded"))).toBe(cornered);
      expect(hand.includes("italic")).toBe(italic);
      expect(hand.some((name) => name.startsWith("before:") || name.startsWith("border"))).toBe(
        false,
      );
    }
  });

  // What it said to the person stays readable a while; what it thought to
  // itself passes: at every age a thought is the dimmer of the two.
  it.each([1, 2, 3, 4, 5])("dims a thought more than its words at age %i", (age) => {
    const opacity = (kind: WorkingBubble["kind"]) =>
      Number(/opacity-(\d+)/.exec(ageClass(kind, age))?.[1] ?? 100);
    expect(opacity("thought")).toBeLessThan(opacity("note"));
    expect(opacity("question")).toBe(opacity("note"));
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
