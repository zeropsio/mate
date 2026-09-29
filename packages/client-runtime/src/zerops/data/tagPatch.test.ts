import { describe, expect, it } from "vite-plus/test";

import {
  applyProjectTagPatch,
  sameProjectTags,
  type ProjectTagPatch,
  type ProjectTagRefusal,
} from "./tagPatch.ts";

const REGISTRY = ["mate:tool:gitea", "mate:gn:g1:acme", "mate:gm:g1:p1:mate", "person:own"];

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
    {
      name: "a group is registered beside the others, its slug derived from the list read",
      tags: REGISTRY,
      patch: { kind: "registry-group", groupId: "g2", name: "Acme" },
      adds: ["mate:gn:g2:acme-2"],
      removes: [],
    },
    {
      name: "a member is added to its group",
      tags: REGISTRY,
      patch: { kind: "registry-member", groupId: "g1", projectId: "p2", member: "stage" },
      adds: ["mate:gm:g1:p2:stage"],
      removes: [],
    },
    {
      name: "a production replaces one whose project the platform says is deleted",
      tags: [...REGISTRY, "mate:gm:g1:p-dead:production"],
      patch: {
        kind: "registry-member",
        groupId: "g1",
        projectId: "p-prod",
        member: "production",
        gone: ["p-dead"],
      },
      adds: ["mate:gm:g1:p-prod:production", "mate:gm:g1:p1:mate"],
      removes: ["mate:gm:g1:p-dead:production"],
    },
  ])("$name, and changes nothing applied again", ({ tags, patch, adds, removes }) => {
    const once = applyProjectTagPatch(tags, patch);
    if (!once.ok) throw new Error(once.refusal.reason);

    expect(once.tags).toEqual(expect.arrayContaining([...adds, "person:own"]));
    for (const tag of removes) expect(once.tags).not.toContain(tag);
    const twice = applyProjectTagPatch(once.tags, patch);
    expect(twice.ok && sameProjectTags(twice.tags, once.tags)).toBe(true);
  });

  it.each<{
    readonly name: string;
    readonly patch: ProjectTagPatch;
    readonly refusal: Partial<ProjectTagRefusal>;
  }>([
    {
      name: "a member of a group the registry does not name",
      patch: { kind: "registry-member", groupId: "g9", projectId: "p2", member: "mate" },
      refusal: { code: "group-unknown" },
    },
    {
      name: "a member already in the group as something else",
      patch: { kind: "registry-member", groupId: "g1", projectId: "p1", member: "stage" },
      refusal: { code: "registry-conflict" },
    },
    {
      name: "a group with no name",
      patch: { kind: "registry-group", groupId: "g2", name: "  " },
      refusal: { code: "registry-conflict" },
    },
    {
      // Named, so the caller can ask the platform whether that project still exists.
      name: "a second production, naming the project that holds the first",
      patch: { kind: "registry-member", groupId: "g1", projectId: "p3", member: "production" },
      refusal: { code: "production-held", projectId: "p-prod" },
    },
    {
      name: "a second production beside one nobody said is deleted",
      patch: {
        kind: "registry-member",
        groupId: "g1",
        projectId: "p3",
        member: "production",
        gone: ["p-other"],
      },
      refusal: { code: "production-held", projectId: "p-prod" },
    },
  ])("refuses $name", ({ patch, refusal }) => {
    expect(
      applyProjectTagPatch([...REGISTRY, "mate:gm:g1:p-prod:production"], patch),
    ).toMatchObject({ ok: false, refusal });
  });
});
