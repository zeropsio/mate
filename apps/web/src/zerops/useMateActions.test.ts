import { describe, expect, it } from "vite-plus/test";

import { validateMateName } from "./useMateActions";

describe("validateMateName", () => {
  it.each<{
    readonly name: string;
    readonly value: string;
    readonly taken: { readonly names: ReadonlyArray<string>; readonly complete: boolean };
    readonly current?: string;
    readonly verdict: string | undefined;
  }>([
    {
      name: "an unread listing never reads as no names taken",
      value: "Ada",
      taken: { names: [], complete: false },
      verdict: "Checking which names are taken…",
    },
    {
      name: "a name read as taken is refused while the rest are read",
      value: "fen",
      taken: { names: ["Fen"], complete: false },
      verdict: "fen is already an agent on this account.",
    },
    {
      name: "a name missing from a partial listing may still be taken",
      value: "Ada",
      taken: { names: ["Fen"], complete: false },
      verdict: "Checking which names are taken…",
    },
    {
      name: "a name missing from a complete listing is free",
      value: "Ada",
      taken: { names: ["Fen"], complete: true },
      verdict: undefined,
    },
    {
      name: "the Mate's own name stays its own while the rest are read",
      value: "Fen",
      taken: { names: ["Fen"], complete: false },
      current: "Fen",
      verdict: undefined,
    },
    {
      name: "an empty name is refused before anything is read",
      value: " ",
      taken: { names: [], complete: false },
      verdict: "Give the agent a name.",
    },
  ])("$name", ({ value, taken, current, verdict }) => {
    expect(validateMateName(value, taken, current)).toBe(verdict);
  });
});
