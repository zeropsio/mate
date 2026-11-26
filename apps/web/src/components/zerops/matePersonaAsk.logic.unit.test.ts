import { expect, it } from "vite-plus/test";
import { matePersonaAsked } from "./matePersonaAsk.logic";

// witness: apps/web/src/components/zerops/matePersonaAsk.logic.ts | input.madeBy === input.viewer && → true &&
it("MN99: A Mate asks how it should work with its person only of the person who made it, only while its server takes a persona and it holds none, and only until that person writes to it; breaks: a colleague opening someone's new Mate is asked to choose its persona", () => {
  const base = {
    takesPersona: true,
    persona: null,
    madeBy: "ada",
    viewer: "ada",
    written: false,
  } as const;
  const persona = { name: "Teacher", instructions: "Explain why." };
  const rows = [
    [base, true],
    [{ ...base, viewer: "petr" }, false],
    [{ ...base, madeBy: undefined }, false],
    [{ ...base, viewer: undefined, madeBy: undefined }, false],
    [{ ...base, takesPersona: null }, false],
    [{ ...base, takesPersona: false }, false],
    [{ ...base, persona: undefined }, false],
    [{ ...base, persona }, false],
    [{ ...base, written: true }, false],
  ] as const;
  for (const [input, asked] of rows) expect(matePersonaAsked(input)).toBe(asked);
});
