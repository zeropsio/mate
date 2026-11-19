import { expect, it } from "vite-plus/test";
import {
  commandStandsAlone,
  compactCommandOffered,
  providerCommandOffered,
} from "./commandOffers.ts";

const empty = { pictures: 0, files: 0, keptAttachments: 0, terminalContexts: 0, reviewComments: 0 };

// witness: packages/client-runtime/src/zerops/composer/commandOffers.ts | words.slice(0, range.start).trim() === "" && words.slice(range.end).trim() === "" → words.slice(0, range.start).trim() === ""
it("CP12: /compact is offered only where the command is all the draft says: words before or after it withhold it", () => {
  expect(commandStandsAlone("/comp", { start: 0, end: 5 })).toBe(true);
  expect(commandStandsAlone("  /comp  ", { start: 2, end: 7 })).toBe(true);
  expect(commandStandsAlone("fix this /comp", { start: 9, end: 14 })).toBe(false);
  expect(commandStandsAlone("/comp now", { start: 0, end: 5 })).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/commandOffers.ts | reviewComments === 0 → true
it("CP13: /compact is not offered while the draft carries a picture, a file, a kept attachment, a terminal context or a review comment", () => {
  const input = { standsAlone: true, compactUnavailable: false, load: empty };
  expect(compactCommandOffered(input)).toBe(true);
  expect(compactCommandOffered({ ...input, load: { ...empty, pictures: 1 } })).toBe(false);
  expect(compactCommandOffered({ ...input, load: { ...empty, files: 1 } })).toBe(false);
  expect(compactCommandOffered({ ...input, load: { ...empty, keptAttachments: 1 } })).toBe(false);
  expect(compactCommandOffered({ ...input, load: { ...empty, terminalContexts: 1 } })).toBe(false);
  expect(compactCommandOffered({ ...input, load: { ...empty, reviewComments: 1 } })).toBe(false);
});

// witness: packages/client-runtime/src/zerops/composer/commandOffers.ts | !input.standsAlone || input.compactUnavailable → !input.standsAlone
it("CP14: A conversation that cannot be compacted is offered no /compact", () => {
  expect(compactCommandOffered({ standsAlone: true, compactUnavailable: true, load: empty })).toBe(
    false,
  );
});

// witness: packages/client-runtime/src/zerops/composer/commandOffers.ts | name !== "compact" || compactOffered → compactOffered
it("CP15: Where /compact is withheld only the provider's compact leaves the menu: every other provider command stays offered", () => {
  expect(providerCommandOffered("compact", false)).toBe(false);
  expect(providerCommandOffered("review", false)).toBe(true);
  expect(providerCommandOffered("compact", true)).toBe(true);
});
