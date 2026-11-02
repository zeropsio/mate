import { describe, expect, it } from "vite-plus/test";
import { MATE_PLACES_INSTRUCTIONS } from "./matePlacesInstructions.ts";

describe("MATE_PLACES_INSTRUCTIONS", () => {
  it.each([
    ["values and secrets", "Vault"],
    ["domains, zerops.app addresses and ports", "··· → Addresses"],
    ["rolling production back", "··· → Roll back to"],
    ["who can open a project", "Project access"],
    ["inviting someone", "Team → Invite"],
    ["the organization's model key", "Settings › Automation › Model key"],
  ])("a Mate names the place in Mate where the person does %s", (_thing, place) => {
    expect(MATE_PLACES_INSTRUCTIONS).toContain(place);
  });

  // Codex caps an additionalContext entry at ~1,000 tokens (4 bytes each) and truncates the
  // middle of a longer one; the places ride in an entry of their own.
  it("stays well inside Codex's per-entry cap", () => {
    expect(Buffer.byteLength(MATE_PLACES_INSTRUCTIONS)).toBeLessThan(1_000);
  });
});
