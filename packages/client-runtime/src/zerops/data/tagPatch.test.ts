import { describe, expect, it } from "vite-plus/test";

import { applyProjectTagPatch, sameProjectTags, type ProjectTagPatch } from "./tagPatch.ts";

describe("applyProjectTagPatch", () => {
  it.each<{
    readonly name: string;
    readonly tags: ReadonlyArray<string>;
    readonly patch: ProjectTagPatch;
    readonly adds: ReadonlyArray<string>;
    readonly removes: ReadonlyArray<string>;
  }>([
    {
      name: "a Mate declared carries the marker, and every tag it had",
      tags: ["person:own"],
      patch: { kind: "mate" },
      adds: ["mate"],
      removes: [],
    },
    {
      name: "a signer replaces the agent's previous signer only",
      tags: ["mate:signer:codex:u0", "mate:signer:claude-code:u0", "person:own"],
      patch: { kind: "agent-signer", agentId: "codex", userId: "u1" },
      adds: ["mate:signer:codex:u1"],
      removes: ["mate:signer:codex:u0"],
    },
    {
      name: "a stand-up answered clears its ask and keeps the signer who answered it",
      tags: ["mate", "mate:standup:u1", "mate:signer:codex:u1", "person:own"],
      patch: { kind: "stand-up-done" },
      adds: ["mate", "mate:signer:codex:u1"],
      removes: ["mate:standup:u1"],
    },
    {
      name: "a project closed off says so, keeping every other tag",
      tags: ["mate", "person:own"],
      patch: { kind: "closed-off" },
      adds: ["mate", "mate:closed-off"],
      removes: [],
    },
    {
      name: "a project already marked closed off is left as it is",
      tags: ["mate", "mate:closed-off", "person:own"],
      patch: { kind: "closed-off" },
      adds: ["mate", "mate:closed-off"],
      removes: [],
    },
  ])("$name, and changes nothing applied again", ({ tags, patch, adds, removes }) => {
    const once = applyProjectTagPatch(tags, patch);

    expect(once).toEqual(expect.arrayContaining([...adds, "person:own"]));
    for (const tag of removes) expect(once).not.toContain(tag);
    expect(sameProjectTags(applyProjectTagPatch(once, patch), once)).toBe(true);
  });
});
