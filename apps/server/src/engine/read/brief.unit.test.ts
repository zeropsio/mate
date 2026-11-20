import { ItemBody } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { BRIEF_MAX, briefLine, briefOf } from "./brief.ts";

const decodeBody = Schema.decodeUnknownSync(ItemBody);
const person = (text: string, state = "delivered") =>
  decodeBody({ kind: "person", text, attachments: [], sendId: "c1", delivery: { state, at: 1 } });
const note = (text: string) => decodeBody({ kind: "note", text, streaming: false, answer: false });
const call = (input: string) =>
  decodeBody({
    kind: "call",
    step: "command",
    tool: { name: "Bash" },
    words: null,
    state: "done",
    endedAt: 2,
    input,
  });
const linesOf = (bodies: ReadonlyArray<ItemBody>) =>
  bodies.map(briefLine).filter((line) => line !== null);

// witness: apps/server/src/engine/read/brief.ts | kept.reverse(); → kept.slice();
it("RS18: A brief tells the person's messages, the agent's words and a line per call oldest first, leaves out a message refused or not yet delivered, and keeps the latest that fit when the record is longer, saying earlier ones were left out; breaks: the new agent reads the conversation backwards, or the brief outgrows its bound", () => {
  const brief = briefOf(
    linesOf([
      person("make the header blue"),
      call("npm test"),
      note("Done: the header is blue."),
      person("never mind", "refused"),
      person("now the footer"),
      person("and the logo", "queued"),
    ]),
  );
  const order = ["make the header blue", "npm test", "the header is blue", "now the footer"].map(
    (words) => brief.indexOf(words),
  );
  expect(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1]!))).toBe(true);
  expect(brief).not.toContain("never mind");
  expect(brief).not.toContain("and the logo");
  expect(briefOf(linesOf([person("   ")]))).toBe("");

  const long = Array.from({ length: 40 }, (_, index) => person(`${index} ${"x".repeat(1_500)}`));
  const cut = briefOf(linesOf(long));
  expect(cut.length).toBeLessThanOrEqual(BRIEF_MAX);
  expect(cut).toContain("39 x");
  expect(cut).not.toContain("\nPerson: 0 x");
  expect(cut).toContain("left out");
});
