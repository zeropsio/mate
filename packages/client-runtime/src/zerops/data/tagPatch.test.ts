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
      name: "a group membership replaces the old one and keeps a person's tag",
      tags: ["mate:g:old", "person:own"],
      patch: { kind: "group-membership", next: { groupId: "g1", role: "dev" } },
      adds: ["mate:g:g1", "mate:role:dev"],
      removes: ["mate:g:old"],
    },
    {
      name: "an agent's name also declares the Mate",
      tags: ["person:own"],
      patch: { kind: "agent-name", name: "Vera" },
      adds: ["mate:bot:Vera", "mate"],
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
      tags: ["mate:g:g1", "mate", "mate:standup:u1", "mate:signer:codex:u1", "person:own"],
      patch: { kind: "stand-up-done" },
      adds: ["mate:g:g1", "mate", "mate:signer:codex:u1"],
      removes: ["mate:standup:u1"],
    },
    {
      name: "a project closed off says so, keeping every other tag",
      tags: ["mate:g:g1", "mate", "person:own"],
      patch: { kind: "closed-off" },
      adds: ["mate:g:g1", "mate", "mate:closed-off"],
      removes: [],
    },
    {
      name: "a project already marked closed off is left as it is",
      tags: ["mate", "mate:closed-off", "person:own"],
      patch: { kind: "closed-off" },
      adds: ["mate", "mate:closed-off"],
      removes: [],
    },
    {
      name: "a face changed replaces the one before and keeps every other tag",
      tags: [
        "mate:g:g1",
        "mate:role:dev",
        "mate:name:Acme Docs",
        "mate:bot:Ada",
        "mate",
        "mate:standup:u1",
        "mate:signer:codex:u1",
        "mate:face:coral:gem",
        "person:own",
      ],
      patch: { kind: "mate-face", face: { tint: "sky", shape: "seal" } },
      adds: [
        "mate:g:g1",
        "mate:role:dev",
        "mate:name:Acme Docs",
        "mate:bot:Ada",
        "mate",
        "mate:standup:u1",
        "mate:signer:codex:u1",
        "mate:face:sky:seal",
      ],
      removes: ["mate:face:coral:gem"],
    },
    {
      name: "a face changed on a Mate that wore its name's tint keeps its name's place",
      tags: ["mate:g:g1", "mate:bot:Ada", "mate", "person:own"],
      patch: { kind: "mate-face", face: { tint: "sky", shape: "seal" } },
      adds: ["mate:g:g1", "mate:bot:Ada", "mate", "mate:face:sky:seal:named"],
      removes: [],
    },
    {
      name: "a membership write keeps a stand-up still waiting",
      tags: ["mate:g:old", "mate:standup:u1", "person:own"],
      patch: { kind: "group-membership", next: { groupId: "g1", role: "dev" } },
      adds: ["mate:standup:u1"],
      removes: ["mate:g:old"],
    },
  ])("$name, and changes nothing applied again", ({ tags, patch, adds, removes }) => {
    const once = applyProjectTagPatch(tags, patch);

    expect(once).toEqual(expect.arrayContaining([...adds, "person:own"]));
    for (const tag of removes) expect(once).not.toContain(tag);
    expect(sameProjectTags(applyProjectTagPatch(once, patch), once)).toBe(true);
  });
});
