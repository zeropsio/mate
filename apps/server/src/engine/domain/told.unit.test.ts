import { expect, it } from "vite-plus/test";
import { whereWith } from "./told.ts";

// witness: apps/server/src/engine/domain/told.ts | !run.maintenance && !isSlashCommand(run.text); → !run.maintenance;
it("ED+1: Where the work stands goes in front of a run's message between its own tags, alone when the message has no words, and never in front of a slash command or a maintenance run; breaks: a slash command turns into prose the model answers, or a compaction carries a block", () => {
  const block = "<zerops-where>\nW\n</zerops-where>";
  const update = "<zerops-update>\nMerged\n</zerops-update>\n\ngo";
  const cases = [
    [{ text: "go", maintenance: false, where: "W" }, "go", `${block}\n\ngo`],
    [{ text: "", maintenance: false, where: "W" }, "", block],
    [{ text: "/compact", maintenance: false, where: "W" }, "/compact", "/compact"],
    [{ text: "go", maintenance: true, where: "W" }, "go", "go"],
    [{ text: "go", maintenance: false }, "go", "go"],
    [{ text: update, maintenance: false, where: "W" }, update, `${block}\n\n${update}`],
  ] as const;
  for (const [run, told, expected] of cases) expect(whereWith(told, run)).toBe(expected);
});
