import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import {
  deriveZeropsGroups,
  formatFaceTag,
  formatGroupTag,
  formatRoleTag,
  generateZeropsGroupId,
  readZeropsGroupTags,
  withZeropsBotTag,
  withZeropsChangedFace,
  withZeropsFaceTag,
  withZeropsGroupTags,
  withZeropsMateAtBirth,
  withZeropsMateTag,
  withZeropsStandUpTag,
  withoutZeropsStandUpTag,
  formatLabelTag,
  ZEROPS_GROUP_ID_LENGTH,
  ZEROPS_GROUP_LABEL_MAX_LENGTH,
  type ZeropsEnvironmentRole,
  type ZeropsPlacedBirth,
} from "./groups.ts";
import { withMateSignerTag } from "./mateAccess.ts";

function project(
  name: string,
  tagList: ReadonlyArray<string> | undefined = [],
  id = name,
  created?: string,
): ZeropsProject {
  return {
    id,
    name,
    status: "ACTIVE",
    ...(tagList === undefined ? {} : { tagList }),
    ...(created === undefined ? {} : { created }),
  };
}

describe("tag format", () => {
  it.each([
    { gid: "7k2m9qx4vb1c", expected: "mate:g:7k2m9qx4vb1c" },
    { gid: "0", expected: "mate:g:0" },
  ])("formats the group tag for $gid", ({ gid, expected }) => {
    expect(formatGroupTag(gid)).toBe(expected);
  });

  it.each([
    { role: "dev", expected: "mate:role:dev" },
    { role: "stage", expected: "mate:role:stage" },
    { role: "devstage", expected: "mate:role:devstage" },
    { role: "prod", expected: "mate:role:prod" },
  ] satisfies ReadonlyArray<{ role: ZeropsEnvironmentRole; expected: string }>)(
    "formats the role tag for $role",
    ({ role, expected }) => {
      expect(formatRoleTag(role)).toBe(expected);
    },
  );
});

describe("readZeropsGroupTags", () => {
  it.each([
    {
      name: "reads all three tags",
      tagList: ["mate:g:abc", "mate:role:prod", "mate:name:Beviro CRM"],
      expected: { groupId: "abc", role: "prod", label: "Beviro CRM" },
    },
    {
      name: "ignores foreign tags",
      tagList: ["billing:team-a", "mate:g:abc", "internal"],
      expected: { groupId: "abc", role: undefined, label: undefined },
    },
    {
      name: "is absent for an untagged project",
      tagList: [],
      expected: { groupId: undefined, role: undefined, label: undefined },
    },
    {
      name: "takes the first group tag when a project carries several",
      tagList: ["mate:g:first", "mate:g:second"],
      expected: { groupId: "first", role: undefined, label: undefined },
    },
    {
      name: "rejects an unknown role rather than inventing one",
      tagList: ["mate:g:abc", "mate:role:production"],
      expected: { groupId: "abc", role: undefined, label: undefined },
    },
    {
      name: "rejects an empty group id",
      tagList: ["mate:g:"],
      expected: { groupId: undefined, role: undefined, label: undefined },
    },
    {
      name: "ignores an unknown mate kind",
      tagList: ["mate:vg:abc"],
      expected: { groupId: undefined, role: undefined, label: undefined },
    },
    {
      name: "keeps colons inside a label — a name may contain them",
      tagList: ["mate:g:abc", "mate:name:Beviro: the CRM"],
      expected: { groupId: "abc", role: undefined, label: "Beviro: the CRM" },
    },
    {
      name: "rejects a blank label",
      tagList: ["mate:g:abc", "mate:name:   "],
      expected: { groupId: "abc", role: undefined, label: undefined },
    },
    {
      name: "reads the bare marker as the Mate's existence, wherever it sits",
      tagList: ["mate:g:abc", "mate:role:dev", "mate"],
      expected: { mate: true, groupId: "abc", role: "dev", label: undefined },
    },
    {
      name: "does not mistake a namespaced tag for the marker",
      tagList: ["mate:role:dev", "mate:bot:Ada"],
      expected: { groupId: undefined, role: "dev", label: undefined, bot: "Ada" },
    },
  ])("$name", ({ tagList, expected }) => {
    expect(readZeropsGroupTags(tagList)).toEqual({ mate: false, ...expected });
  });

  it("treats a project with no tagList field as untagged", () => {
    expect(readZeropsGroupTags(undefined)).toEqual({
      mate: false,
      groupId: undefined,
      role: undefined,
      label: undefined,
    });
  });
});

describe("withZeropsMateTag", () => {
  it("declares the Mate once, after every other tag", () => {
    expect(withZeropsMateTag(["mate:g:abc", "mate:role:dev"])).toEqual([
      "mate:g:abc",
      "mate:role:dev",
      "mate",
    ]);
    expect(withZeropsMateTag(undefined)).toEqual(["mate"]);
  });

  it("is idempotent — every set-up path may write it without looking", () => {
    const once = withZeropsMateTag(["keep"]);
    expect(withZeropsMateTag(once)).toEqual(once);
  });

  it("survives a regroup and a leave: existence is not membership", () => {
    const declared = withZeropsMateTag(["mate:g:old", "mate:role:dev"]);
    expect(withZeropsGroupTags(declared, { groupId: "new", role: "dev" })).toContain("mate");
    expect(withZeropsGroupTags(declared, {})).toEqual(["mate"]);
  });
});

describe("the stand-up marker (mate:standup:)", () => {
  it.each([
    {
      name: "names who asked for it",
      tagList: ["mate:g:abc", "mate", "mate:standup:u-ada"],
      standUp: { by: "u-ada" },
    },
    {
      name: "is absent on a Mate nobody asked it of",
      tagList: ["mate:g:abc", "mate"],
      standUp: undefined,
    },
    {
      name: "names nobody when blank",
      tagList: ["mate:standup:", "mate:standup:  "],
      standUp: undefined,
    },
    {
      name: "takes the first when a list carries two",
      tagList: ["mate:standup:u-ada", "mate:standup:u-fen"],
      standUp: { by: "u-ada" },
    },
    {
      name: "is not a foreign tag that merely looks alike",
      tagList: ["standup:u-ada"],
      standUp: undefined,
    },
  ])("$name", ({ tagList, standUp }) => {
    expect(readZeropsGroupTags(tagList).standUp).toEqual(standUp);
  });

  it.each([
    {
      name: "is written after every other tag",
      tagList: ["mate:g:abc", "mate"],
      userId: "u-ada",
      expected: ["mate:g:abc", "mate", "mate:standup:u-ada"],
    },
    {
      name: "replaces one naming somebody else",
      tagList: ["mate:standup:u-fen", "keep"],
      userId: "u-ada",
      expected: ["keep", "mate:standup:u-ada"],
    },
    { name: "is not written for nobody", tagList: ["keep"], userId: "  ", expected: ["keep"] },
  ])("$name", ({ tagList, userId, expected }) => {
    expect(withZeropsStandUpTag(tagList, userId)).toEqual(expected);
  });

  it("clears every stand-up and nothing else, and clearing again changes nothing", () => {
    const cleared = withoutZeropsStandUpTag([
      "person:own",
      "mate:g:abc",
      "mate:standup:u-ada",
      "mate:bot:Ada",
      "mate:signer:codex:u-ada",
      "mate:standup:u-fen",
      "mate",
    ]);
    expect(cleared).toEqual([
      "person:own",
      "mate:g:abc",
      "mate:bot:Ada",
      "mate:signer:codex:u-ada",
      "mate",
    ]);
    expect(withoutZeropsStandUpTag(cleared)).toEqual(cleared);
  });

  it.each([
    {
      name: "a move to another group",
      write: (tags: ReadonlyArray<string>) =>
        withZeropsGroupTags(tags, { groupId: "new", role: "dev", label: "Acme Docs" }),
    },
    {
      name: "leaving the group",
      write: (tags: ReadonlyArray<string>) => withZeropsGroupTags(tags, {}),
    },
    {
      name: "naming the agent",
      write: (tags: ReadonlyArray<string>) => withZeropsBotTag(tags, "Fen"),
    },
    {
      name: "declaring the Mate again",
      write: (tags: ReadonlyArray<string>) => withZeropsMateTag(tags),
    },
  ])("stands through $name", ({ write }) => {
    const asked = withZeropsStandUpTag(["mate:g:old", "mate:role:dev", "mate"], "u-ada");
    expect(readZeropsGroupTags(write(asked)).standUp).toEqual({ by: "u-ada" });
  });
});

// Run 4 (2026-10-02): the same person made two Mates, one by New project and one by Add a Mate,
// and both waited for that person's sign-in — but only Add a Mate's stand-up named them. Both
// flows name who made the Mate at birth, so every window knows whose sign-in it waits for.
describe("the maker (mate:by:)", () => {
  it.each([
    { name: "names who made it", tagList: ["mate:g:abc", "mate", "mate:by:u-ada"], by: "u-ada" },
    { name: "is absent on a Mate born before it", tagList: ["mate:g:abc", "mate"], by: undefined },
    { name: "names nobody when blank", tagList: ["mate:by:", "mate:by:  "], by: undefined },
    {
      name: "takes the first when a list carries two",
      tagList: ["mate:by:u-ada", "mate:by:u-fen"],
      by: "u-ada",
    },
    { name: "is never the agent's name", tagList: ["mate:bot:Ada"], by: undefined },
  ])("$name", ({ tagList, by }) => {
    expect(readZeropsGroupTags(tagList).madeBy).toBe(by);
  });

  it.each([
    {
      name: "a development Mate, made by New project: its maker, and no stand-up",
      mate: { role: "dev" as const, madeBy: "u-ada" },
      by: "u-ada",
      standUp: undefined,
    },
    {
      name: "a development Mate, made by Add a Mate: its maker beside its stand-up",
      mate: { role: "dev" as const, madeBy: "u-ada", standUpBy: "u-ada" },
      by: "u-ada",
      standUp: { by: "u-ada" },
    },
    {
      name: "a stage with an agent: a deploy target, nobody's sign-in awaited",
      mate: { role: "stage" as const, madeBy: "u-ada" },
      by: undefined,
      standUp: undefined,
    },
    {
      name: "nobody named",
      mate: { role: "dev" as const, madeBy: "  " },
      by: undefined,
      standUp: undefined,
    },
  ])("is written at birth for $name", ({ mate, by, standUp }) => {
    const tags = readZeropsGroupTags(withZeropsMateAtBirth(["mate:g:abc", "mate:role:dev"], mate));
    expect({ by: tags.madeBy, standUp: tags.standUp }).toEqual({ by, standUp });
  });

  it("stands through a move to another group and the stand-up's clearing", () => {
    const born = withZeropsMateAtBirth(["mate:g:old", "mate:role:dev"], {
      role: "dev",
      madeBy: "u-ada",
      standUpBy: "u-ada",
    });
    const moved = withZeropsGroupTags(withoutZeropsStandUpTag(born), { groupId: "new" });
    expect(readZeropsGroupTags(moved).madeBy).toBe("u-ada");
  });
});

describe("formatLabelTag", () => {
  it.each([
    { name: "collapses whitespace", input: "Beviro   CRM\n", expected: "mate:name:Beviro CRM" },
    { name: "is absent for a blank name", input: "   ", expected: undefined },
    { name: "is absent for an empty name", input: "", expected: undefined },
  ])("$name", ({ input, expected }) => {
    expect(formatLabelTag(input)).toBe(expected);
  });

  it("truncates a long name to the legibility budget without leaving a trailing space", () => {
    const tag = formatLabelTag(`${"a".repeat(ZEROPS_GROUP_LABEL_MAX_LENGTH)} tail`);
    expect(tag).toBe(`mate:name:${"a".repeat(ZEROPS_GROUP_LABEL_MAX_LENGTH)}`);
  });
});

describe("withZeropsGroupTags", () => {
  it("keeps every foreign tag and replaces only the mate ones", () => {
    expect(
      withZeropsGroupTags(["billing:team-a", "mate:g:old", "mate:role:dev", "keep-me"], {
        groupId: "new",
        role: "prod",
      }),
    ).toEqual(["billing:team-a", "keep-me", "mate:g:new", "mate:role:prod"]);
  });

  it("mirrors the group's name so the Zerops GUI shows something readable", () => {
    expect(withZeropsGroupTags([], { groupId: "abc", role: "dev", label: "Beviro CRM" })).toEqual([
      "mate:g:abc",
      "mate:role:dev",
      "mate:name:Beviro CRM",
    ]);
  });

  it("drops the old label too when a project leaves its group", () => {
    expect(withZeropsGroupTags(["mate:g:a", "mate:name:Old", "keep"], {})).toEqual(["keep"]);
  });

  it("writes no label without a group — a label for nothing is not written", () => {
    expect(withZeropsGroupTags([], { label: "Orphan" })).toEqual([]);
  });

  it("drops the mate tags when the project leaves its group", () => {
    expect(withZeropsGroupTags(["mate:g:old", "mate:role:dev", "other"], {})).toEqual(["other"]);
  });

  it("writes a group with no role", () => {
    expect(withZeropsGroupTags([], { groupId: "abc" })).toEqual(["mate:g:abc"]);
  });

  it("is idempotent", () => {
    const once = withZeropsGroupTags(["x"], { groupId: "abc", role: "dev" });
    expect(withZeropsGroupTags(once, { groupId: "abc", role: "dev" })).toEqual(once);
  });
});

describe("generateZeropsGroupId", () => {
  it("draws a Crockford base32 id of the fixed length", () => {
    let next = 0;
    const id = generateZeropsGroupId((array) => {
      for (let index = 0; index < array.length; index += 1) array[index] = next++ % 256;
      return array;
    });
    expect(id).toHaveLength(ZEROPS_GROUP_ID_LENGTH);
    expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]+$/);
  });

  it("never emits the ambiguous letters i, l, o, u", () => {
    const id = generateZeropsGroupId((array) => {
      for (let index = 0; index < array.length; index += 1) array[index] = 255 - index;
      return array;
    });
    expect(id).not.toMatch(/[ilou]/);
  });

  it("maps bytes onto the alphabet without modulo bias", () => {
    // The alphabet is 32 characters and 32 divides 256 exactly, so every byte
    // is usable and `byte % 32` is uniform — unlike the 62-character password
    // alphabet next door, this needs no rejection sampling.
    const draws = [0, 31, 32, 63, 64, 255];
    const id = generateZeropsGroupId((array) => {
      for (let index = 0; index < array.length; index += 1) {
        array[index] = draws[index % draws.length] ?? 0;
      }
      return array;
    });
    expect(id.slice(0, 6)).toBe("0z0z0z");
  });
});

describe("deriveZeropsGroups", () => {
  it("groups environments by their group tag and leaves the rest ungrouped", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", ["mate:g:aaa", "mate:role:dev"]),
        project("crm-prod", ["mate:g:aaa", "mate:role:prod"]),
        project("shop-dev", ["mate:g:bbb", "mate:role:dev"]),
        project("loose", []),
      ],
      { order: "name" },
    );

    expect(result.groups.map((group) => group.groupId)).toEqual(["aaa", "bbb"]);
    expect(result.groups[0]?.environments.map((environment) => environment.project.name)).toEqual([
      "crm-dev",
      "crm-prod",
    ]);
    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["loose"]);
  });

  it("orders environments dev → devstage → stage → prod, then by name", () => {
    const result = deriveZeropsGroups(
      [
        project("d", ["mate:g:aaa", "mate:role:prod"]),
        project("c", ["mate:g:aaa", "mate:role:stage"]),
        project("b", ["mate:g:aaa", "mate:role:devstage"]),
        project("a", ["mate:g:aaa", "mate:role:dev"]),
      ],
      { order: "name" },
    );

    expect(result.groups[0]?.environments.map((environment) => environment.role)).toEqual([
      "dev",
      "devstage",
      "stage",
      "prod",
    ]);
  });

  it("sorts a roleless environment last, and ties by name", () => {
    const result = deriveZeropsGroups(
      [
        project("zzz", ["mate:g:aaa"]),
        project("bbb", ["mate:g:aaa", "mate:role:prod"]),
        project("aaa", ["mate:g:aaa"]),
      ],
      { order: "name" },
    );

    expect(result.groups[0]?.environments.map((environment) => environment.project.name)).toEqual([
      "bbb",
      "aaa",
      "zzz",
    ]);
  });

  it("names a group from the store record when there is one", () => {
    const result = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa", "mate:name:Stale"])], {
      names: { aaa: "Beviro CRM" },
      order: "name",
    });

    expect(result.groups[0]?.name).toBe("Beviro CRM");
    expect(result.groups[0]?.nameSource).toBe("store");
  });

  it("falls back to the label tag when the store knows nothing — the tree names itself with no store at all", () => {
    const result = deriveZeropsGroups(
      [project("crm-dev", ["mate:g:aaa", "mate:name:Beviro CRM"])],
      {
        order: "name",
      },
    );

    expect(result.groups[0]?.name).toBe("Beviro CRM");
    expect(result.groups[0]?.nameSource).toBe("tag");
  });

  it("falls back to the group id when nothing names it, and says so", () => {
    const result = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa"])], { order: "name" });

    expect(result.groups[0]?.name).toBe("aaa");
    expect(result.groups[0]?.nameSource).toBe("id");
  });

  it("takes the majority label when a rename only half-applied", () => {
    const result = deriveZeropsGroups(
      [
        project("a", ["mate:g:aaa", "mate:name:New"]),
        project("b", ["mate:g:aaa", "mate:name:New"]),
        project("c", ["mate:g:aaa", "mate:name:Old"]),
      ],
      { order: "name" },
    );

    expect(result.groups[0]?.name).toBe("New");
  });

  it("breaks a label tie deterministically rather than by list order", () => {
    const forward = deriveZeropsGroups(
      [
        project("a", ["mate:g:aaa", "mate:name:Zebra"]),
        project("b", ["mate:g:aaa", "mate:name:Apple"]),
      ],
      { order: "name" },
    );
    const backward = deriveZeropsGroups(
      [
        project("b", ["mate:g:aaa", "mate:name:Apple"]),
        project("a", ["mate:g:aaa", "mate:name:Zebra"]),
      ],
      { order: "name" },
    );

    expect(forward.groups[0]?.name).toBe("Apple");
    expect(backward.groups[0]?.name).toBe("Apple");
  });

  it("orders groups by display name, case-insensitively", () => {
    const result = deriveZeropsGroups(
      [
        project("one", ["mate:g:aaa"]),
        project("two", ["mate:g:bbb"]),
        project("three", ["mate:g:ccc"]),
      ],
      { names: { aaa: "zebra", bbb: "Apple", ccc: "mango" }, order: "name" },
    );

    expect(result.groups.map((group) => group.name)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("reports the production environment of a group, and none when there is not exactly one", () => {
    const [single] = deriveZeropsGroups(
      [
        project("p", ["mate:g:aaa", "mate:role:prod"]),
        project("d", ["mate:g:aaa", "mate:role:dev"]),
      ],
      { order: "name" },
    ).groups;
    expect(single?.production?.project.name).toBe("p");

    const [ambiguous] = deriveZeropsGroups(
      [
        project("p1", ["mate:g:aaa", "mate:role:prod"]),
        project("p2", ["mate:g:aaa", "mate:role:prod"]),
      ],
      { order: "name" },
    ).groups;
    expect(ambiguous?.production).toBeUndefined();

    const [none] = deriveZeropsGroups([project("d", ["mate:g:aaa", "mate:role:dev"])], {
      order: "name",
    }).groups;
    expect(none?.production).toBeUndefined();
  });

  it("orders group names numerically, not lexically: env2 < env10", () => {
    const result = deriveZeropsGroups(
      [
        project("env10", ["mate:g:aaa", "mate:name:env10"]),
        project("env2", ["mate:g:bbb", "mate:name:env2"]),
      ],
      { order: "name" },
    );

    expect(result.groups.map((group) => group.name)).toEqual(["env2", "env10"]);
  });

  it("breaks an environment name tie by project id, deterministically", () => {
    const forward = deriveZeropsGroups(
      [
        project("dev", ["mate:g:aaa", "mate:role:dev"], "z"),
        project("dev", ["mate:g:aaa", "mate:role:dev"], "a"),
      ],
      { order: "name" },
    );
    const backward = deriveZeropsGroups(
      [
        project("dev", ["mate:g:aaa", "mate:role:dev"], "a"),
        project("dev", ["mate:g:aaa", "mate:role:dev"], "z"),
      ],
      { order: "name" },
    );

    expect(forward.groups[0]?.environments.map((entry) => entry.project.id)).toEqual(["a", "z"]);
    expect(backward.groups[0]?.environments.map((entry) => entry.project.id)).toEqual(["a", "z"]);
  });

  it("is stable regardless of the order projects arrive in", () => {
    const projects = [
      project("crm-prod", ["mate:g:aaa", "mate:role:prod"]),
      project("shop-dev", ["mate:g:bbb", "mate:role:dev"]),
      project("crm-dev", ["mate:g:aaa", "mate:role:dev"]),
    ];
    const forward = deriveZeropsGroups(projects, { order: "name" });
    const backward = deriveZeropsGroups(projects.toReversed(), { order: "name" });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("treats a project with no tagList field as ungrouped rather than throwing", () => {
    const result = deriveZeropsGroups([project("legacy", undefined)], { order: "name" });

    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["legacy"]);
  });
});

describe("deriveZeropsGroups — newest first", () => {
  it("orders groups by their earliest member's created time, newest first", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", ["mate:g:aaa"], "crm-dev", "2024-01-01T00:00:00Z"),
        project("shop-dev", ["mate:g:bbb"], "shop-dev", "2024-03-01T00:00:00Z"),
        project("blog-dev", ["mate:g:ccc"], "blog-dev", "2024-02-01T00:00:00Z"),
      ],
      { order: "newest" },
    );

    expect(result.groups.map((group) => group.groupId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("takes a group's birth from its earliest member — a later stage must not reorder it", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", ["mate:g:aaa"], "crm-dev", "2024-01-01T00:00:00Z"),
        // aaa's prod is added after bbb was born; if the group's birth were
        // taken from its newest member instead of its earliest, aaa would
        // wrongly jump ahead of bbb.
        project("crm-prod", ["mate:g:aaa"], "crm-prod", "2024-06-01T00:00:00Z"),
        project("shop-dev", ["mate:g:bbb"], "shop-dev", "2024-03-01T00:00:00Z"),
      ],
      { order: "newest" },
    );

    expect(result.groups.map((group) => group.groupId)).toEqual(["bbb", "aaa"]);
  });

  it("sorts a group with no created member last, and ties by name then id", () => {
    const result = deriveZeropsGroups(
      [
        project("zzz", ["mate:g:aaa", "mate:name:Zzz"]),
        project("bbb", ["mate:g:bbb", "mate:name:Bbb"], "bbb", "2024-01-01T00:00:00Z"),
        project("aaa", ["mate:g:ccc", "mate:name:Aaa"]),
      ],
      { order: "newest" },
    );

    // bbb has a created time so it leads; aaa and ccc both have none, tied,
    // broken by name (Aaa < Zzz).
    expect(result.groups.map((group) => group.groupId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("orders ungrouped projects by their own created time, newest first, missing created last", () => {
    const result = deriveZeropsGroups(
      [
        project("old", [], "old", "2024-01-01T00:00:00Z"),
        project("new", [], "new", "2024-06-01T00:00:00Z"),
        project("undated", []),
      ],
      { order: "newest" },
    );

    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["new", "old", "undated"]);
  });

  it("breaks an ungrouped created tie by name, then id", () => {
    const result = deriveZeropsGroups(
      [
        project("b", [], "z", "2024-01-01T00:00:00Z"),
        project("a", [], "a", "2024-01-01T00:00:00Z"),
      ],
      { order: "newest" },
    );

    expect(result.ungrouped.map((entry) => entry.id)).toEqual(["a", "z"]);
  });

  it("is stable regardless of the order projects arrive in", () => {
    const projects = [
      project("crm-dev", ["mate:g:aaa"], "crm-dev", "2024-01-01T00:00:00Z"),
      project("shop-dev", ["mate:g:bbb"], "shop-dev", "2024-03-01T00:00:00Z"),
      project("loose", [], "loose", "2024-02-01T00:00:00Z"),
    ];
    const forward = deriveZeropsGroups(projects, { order: "newest" });
    const backward = deriveZeropsGroups(projects.toReversed(), { order: "newest" });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });
});

/** A creation under way in group `groupId`, begun at `startedAt` wall ms. */
function birth(
  projectId: string,
  groupId: string,
  startedAt: number,
  over: Partial<ZeropsPlacedBirth["placement"]> = {},
): ZeropsPlacedBirth {
  return {
    projectId,
    startedAt,
    placement: {
      groupId,
      groupName: "Todo",
      kind: "mate",
      displayName: `Todo - ${projectId}`,
      ...over,
    },
  };
}

describe("deriveZeropsGroups — creations under way", () => {
  it.each([
    {
      case: "a birth the listing does not hold yet is a pending member of its group",
      projects: [project("crm-dev", ["mate:g:aaa"], "crm-dev")],
      births: [birth("p-new", "aaa", 1)],
      pending: { aaa: ["p-new"] },
      environments: { aaa: ["crm-dev"] },
    },
    {
      case: "a birth whose project the listing holds in a group is that listed member, once",
      projects: [project("crm-dev", ["mate:g:aaa"], "crm-dev")],
      births: [birth("crm-dev", "aaa", 1)],
      pending: { aaa: [] },
      environments: { aaa: ["crm-dev"] },
    },
    {
      case: "a birth listed before its group tag is written stays pending, not ungrouped",
      projects: [project("p-new", [], "p-new")],
      births: [birth("p-new", "aaa", 1)],
      pending: { aaa: ["p-new"] },
      environments: { aaa: [] },
    },
    {
      // Measured live (pass 31): the platform's listing held the new project 2.8 s before the
      // creation's call answered with its id, and the menu drew the Mate twice meanwhile.
      case: "a creation the platform has not named yet is its Mate once its group lists it",
      projects: [project("Todo - Wren", ["mate:g:new", "mate:bot:Wren"], "p-made")],
      births: [{ ...birth("new", "new", 1, { botName: "Wren" }), awaitingProject: true }],
      pending: { new: [] },
      environments: { new: ["p-made"] },
    },
    {
      // Run 6's second review: a stopped Ida stood beside the listed Ida all session. Its group
      // lists a Mate by its name: the project exists after all, and the listed row is it.
      case: "a creation that stopped is its Mate once its group lists it",
      projects: [project("Todo - Wren", ["mate:g:new", "mate:bot:Wren"], "p-made")],
      births: [
        { ...birth("new", "new", 1, { botName: "Wren" }), awaitingProject: true, failed: true },
      ],
      pending: { new: [] },
      environments: { new: ["p-made"] },
    },
    {
      case: "a creation that stopped stays pending while nothing lists it",
      projects: [],
      births: [
        { ...birth("new", "new", 1, { botName: "Wren" }), awaitingProject: true, failed: true },
      ],
      pending: { new: ["new"] },
      environments: { new: [] },
    },
    {
      case: "a creation not named yet stays pending beside a listed Mate of another name",
      projects: [project("Todo - Moss", ["mate:g:aaa", "mate:bot:Moss"], "p-moss")],
      births: [{ ...birth("aaa", "aaa", 1, { botName: "Wren" }), awaitingProject: true }],
      pending: { aaa: ["aaa"] },
      environments: { aaa: ["p-moss"] },
    },
    {
      case: "a birth in a group nothing lists yet creates the group",
      projects: [],
      births: [birth("p-b", "new", 2), birth("p-a", "new", 1)],
      pending: { new: ["p-a", "p-b"] },
      environments: { new: [] },
    },
  ])("$case", ({ projects, births, pending, environments }) => {
    const result = deriveZeropsGroups(projects, { order: "name", births });
    expect(
      Object.fromEntries(
        result.groups.map((group) => [
          group.groupId,
          group.pending.map((entry) => entry.projectId),
        ]),
      ),
    ).toEqual(pending);
    expect(
      Object.fromEntries(
        result.groups.map((group) => [
          group.groupId,
          group.environments.map((entry) => entry.project.id),
        ]),
      ),
    ).toEqual(environments);
    expect(result.ungrouped).toEqual([]);
  });

  it("carries what the creation knew of the pending member", () => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [birth("p-new", "aaa", 7, { kind: "production" })],
    }).groups;
    expect(group?.pending).toEqual([
      {
        projectId: "p-new",
        kind: "production",
        name: "Todo - p-new",
        startedAt: 7,
      },
    ]);
  });

  it.each([
    { case: "on its way", failed: undefined, expected: undefined },
    { case: "stopped before the platform took it", failed: true, expected: true },
  ])("says whether a pending member is $case", ({ failed, expected }) => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [{ ...birth("g-new", "aaa", 1), ...(failed === undefined ? {} : { failed }) }],
    }).groups;
    expect(group?.pending.map((entry) => entry.failed)).toEqual([expected]);
  });

  it("names a pending Mate as the Mate it will be, and anything else as its environment", () => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [
        birth("p-quinn", "aaa", 1, { displayName: "Todo - Quinn", botName: "Quinn" }),
        birth("p-stage", "aaa", 2, { kind: "stage", displayName: "Todo - stage" }),
      ],
    }).groups;
    expect(group?.pending.map((entry) => entry.name)).toEqual(["Quinn", "Todo - stage"]);
  });

  it("wears the face its person picked while it is pending, and none it was not given", () => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [
        birth("p-quinn", "aaa", 1, { face: { tint: "coral", shape: "gem" } }),
        birth("p-stage", "aaa", 2, { kind: "stage" }),
      ],
    }).groups;
    expect(group?.pending.map((entry) => entry.face)).toEqual([
      { tint: "coral", shape: "gem" },
      undefined,
    ]);
  });

  it.each([
    { case: "the store's name first", names: { aaa: "Stored" }, tags: [], expected: "Stored" },
    { case: "then the members' label", names: {}, tags: ["mate:name:Label"], expected: "Label" },
    { case: "then the name its creation gave it", names: {}, tags: [], expected: "Todo" },
  ])("names a group being created from $case", ({ names, tags, expected }) => {
    const [group] = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa", ...tags], "crm-dev")], {
      order: "name",
      names,
      births: [birth("p-new", "aaa", 1)],
    }).groups;
    expect(group?.name).toBe(expected);
  });

  it("says a group named by its creation was named that way", () => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [birth("p", "aaa", 1)],
    }).groups;
    expect(group).toMatchObject({ name: "Todo", nameSource: "birth" });
  });

  it("orders a group only its creations date by when they started, newest first", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", ["mate:g:aaa"], "crm-dev", "2024-01-01T00:00:00Z"),
        project("shop-dev", ["mate:g:bbb"], "shop-dev", "2024-03-01T00:00:00Z"),
        // Listed with no created time yet: its group is dated by the birth beside it.
        project("new-dev", ["mate:g:new"], "new-dev"),
      ],
      {
        order: "newest",
        births: [
          // Started after every listed group: on top at once.
          birth("p-new", "new", Date.parse("2024-06-01T00:00:00Z")),
          // Started between the two: between them.
          birth("p-mid", "mid", Date.parse("2024-02-01T00:00:00Z")),
          // A created member dates its group, whatever a later birth in it.
          birth("p-late", "aaa", Date.parse("2024-09-01T00:00:00Z")),
        ],
      },
    );
    expect(result.groups.map((group) => group.groupId)).toEqual(["new", "bbb", "mid", "aaa"]);
  });
});

describe("bot names on the tag", () => {
  it("reads the agent's name off the project", () => {
    expect(readZeropsGroupTags(["mate:g:aaa", "mate:bot:Ada"]).bot).toBe("Ada");
  });

  it("has no name when the project carries none", () => {
    expect(readZeropsGroupTags(["mate:g:aaa"]).bot).toBeUndefined();
  });

  it("writes a name", () => {
    expect(withZeropsBotTag([], "Ada")).toContain("mate:bot:Ada");
  });

  /**
   * The writer used to rewrite the whole `mate:` namespace, so changing a role
   * silently deleted the agent's name — and a tool marker with it. Anything
   * the call was not asked about now survives it.
   */
  it("keeps the agent's name through an unrelated role change", () => {
    const after = withZeropsGroupTags(["mate:g:aaa", "mate:role:dev", "mate:bot:Ada"], {
      groupId: "aaa",
      role: "stage",
    });
    expect(after).toContain("mate:bot:Ada");
    expect(after).toContain("mate:role:stage");
    expect(after).not.toContain("mate:role:dev");
  });

  it("keeps a tool marker through a group write", () => {
    expect(withZeropsGroupTags(["mate:tool:gitea"], { groupId: "aaa" })).toContain(
      "mate:tool:gitea",
    );
  });

  it("replaces the name when a new one is given", () => {
    const after = withZeropsBotTag(["mate:bot:Ada"], "Bruno");
    expect(after).toContain("mate:bot:Bruno");
    expect(after).not.toContain("mate:bot:Ada");
  });

  it("writes no tag for a blank name rather than an empty one", () => {
    expect(withZeropsBotTag([], "   ")).toEqual([]);
  });

  it("still preserves tags this product does not own", () => {
    expect(withZeropsBotTag(["billing:team-a"], "Ada")).toContain("billing:team-a");
  });
});

/**
 * A Mate's face — the colour and the shape its person picked — rides on one
 * tag, `mate:face:<tint>:<shape>`. Read permissively: a part this client does
 * not know is left out, so the derived one stands in for it.
 */
describe("a Mate's face on the tag", () => {
  it.each(MATE_TINT_IDS)("reads back every shape %s is written with", (tint) => {
    for (const shape of MATE_SHAPE_IDS) {
      const tag = formatFaceTag({ tint, shape });
      expect(tag).toBe(`mate:face:${tint}:${shape}`);
      expect(readZeropsGroupTags(["mate:g:aaa", tag]).face).toEqual({ tint, shape });
    }
  });

  it.each([
    { case: "no face tag", tagList: ["mate:g:aaa", "mate:bot:Ada"], face: undefined },
    {
      case: "a tint a newer client added",
      tagList: ["mate:face:teal:gem"],
      face: { tint: undefined, shape: "gem" },
    },
    {
      case: "a shape a newer client added",
      tagList: ["mate:face:coral:blob"],
      face: { tint: "coral", shape: undefined },
    },
    { case: "nothing this client knows", tagList: ["mate:face:teal:blob"], face: undefined },
    {
      case: "a tag with no shape",
      tagList: ["mate:face:coral"],
      face: { tint: "coral", shape: undefined },
    },
    {
      case: "a part a newer client appended",
      tagList: ["mate:face:coral:gem:wink"],
      face: { tint: "coral", shape: "gem" },
    },
    {
      case: "an id in another case, never guessed at",
      tagList: ["mate:face:Coral:Gem"],
      face: undefined,
    },
    { case: "an empty tag", tagList: ["mate:face:"], face: undefined },
    {
      case: "two tags: the first this client can read",
      tagList: ["mate:face:teal:blob", "mate:face:sky:seal", "mate:face:rose:pick"],
      face: { tint: "sky", shape: "seal" },
    },
  ] as const)("reads $case", ({ tagList, face }) => {
    expect(readZeropsGroupTags(tagList).face).toEqual(face);
  });

  it("does not mistake a face for the marker, the name or membership", () => {
    const tags = readZeropsGroupTags(["mate:face:olive:clover"]);
    expect(tags).toMatchObject({ mate: false, groupId: undefined, bot: undefined });
  });

  it("writes one face, replacing the one before and keeping every other tag", () => {
    expect(
      withZeropsFaceTag(["billing:team-a", "mate:g:aaa", "mate:face:coral:gem", "mate"], {
        tint: "sky",
        shape: "seal",
      }),
    ).toEqual(["billing:team-a", "mate:g:aaa", "mate", "mate:face:sky:seal"]);
  });

  /** A face belongs to the Mate, not to its group: no other write of the list drops it. */
  it.each([
    {
      write: "a move to another group",
      after: (tags: ReadonlyArray<string>) =>
        withZeropsGroupTags(tags, { groupId: "bbb", role: "dev", label: "Acme Shop" }),
    },
    {
      write: "leaving the group",
      after: (tags: ReadonlyArray<string>) => withZeropsGroupTags(tags, {}),
    },
    {
      write: "a role change",
      after: (tags: ReadonlyArray<string>) =>
        withZeropsGroupTags(tags, { groupId: "aaa", role: "devstage", label: "Acme Docs" }),
    },
    {
      write: "a renamed project",
      after: (tags: ReadonlyArray<string>) =>
        withZeropsGroupTags(tags, { groupId: "aaa", role: "dev", label: "Acme Handbook" }),
    },
    {
      write: "a renamed Mate",
      after: (tags: ReadonlyArray<string>) => withZeropsBotTag(tags, "Bo"),
    },
    {
      write: "an unnamed Mate",
      after: (tags: ReadonlyArray<string>) => withZeropsBotTag(tags, ""),
    },
    { write: "the marker", after: (tags: ReadonlyArray<string>) => withZeropsMateTag(tags) },
    {
      write: "a signer recorded",
      after: (tags: ReadonlyArray<string>) => withMateSignerTag(tags, "claude", "user-1"),
    },
  ])("keeps the face through $write", ({ after }) => {
    const tags = after([
      "mate:g:aaa",
      "mate:role:dev",
      "mate:name:Acme Docs",
      "mate:bot:Ada",
      "mate",
      "mate:face:violet:flower",
    ]);
    expect(tags).toContain("mate:face:violet:flower");
    expect(readZeropsGroupTags(tags).face).toEqual({ tint: "violet", shape: "flower" });
  });
});

/**
 * A face changed after the Mate's birth. A Mate that wore its name's tint —
 * no face picked, or one picked since — keeps its name among the names the
 * tints are shared out over (`mate:face:<tint>:<shape>:named`), so nobody else
 * changes colour; a Mate whose face was picked at its birth never had a place
 * there and takes none now.
 */
describe("a Mate's face changed after its birth", () => {
  const SKY_SEAL = { tint: "sky", shape: "seal" } as const;

  it.each([
    {
      case: "a Mate that wore its name's tint keeps its name's place",
      before: ["mate", "mate:bot:Ada"],
      tag: "mate:face:sky:seal:named",
    },
    {
      case: "a Mate whose face was picked at its birth takes no place",
      before: ["mate", "mate:bot:Ada", "mate:face:coral:gem"],
      tag: "mate:face:sky:seal",
    },
    {
      case: "a Mate changed before keeps the place it kept",
      before: ["mate", "mate:bot:Ada", "mate:face:coral:gem:named"],
      tag: "mate:face:sky:seal:named",
    },
    {
      case: "a Mate whose face this client reads no tint from wore its name's",
      before: ["mate", "mate:bot:Ada", "mate:face:teal:gem"],
      tag: "mate:face:sky:seal:named",
    },
  ])("$case", ({ before, tag }) => {
    const after = withZeropsChangedFace(before, SKY_SEAL);
    expect(after.filter((entry) => entry.startsWith("mate:face:"))).toEqual([tag]);
    expect(readZeropsGroupTags(after).face).toMatchObject(SKY_SEAL);
  });

  it.each([
    { tagList: ["mate:face:sky:seal:named"], face: { ...SKY_SEAL, named: true } },
    { tagList: ["mate:face:sky:seal"], face: SKY_SEAL },
    { tagList: ["mate:face:sky:seal:wink"], face: SKY_SEAL },
    { tagList: ["mate:face:teal:blob:named"], face: undefined },
  ] as const)("reads $tagList", ({ tagList, face }) => {
    expect(readZeropsGroupTags(tagList).face).toStrictEqual(face);
  });

  it("keeps every other tag, a person's own and every other kind of ours", () => {
    const before = [
      "billing:team-a",
      "mate:g:aaa",
      "mate:role:dev",
      "mate:name:Acme Docs",
      "mate:bot:Ada",
      "mate",
      "mate:standup:user-1",
      "mate:signer:claude:user-1",
      "mate:face:coral:gem",
    ];
    const after = withZeropsChangedFace(before, SKY_SEAL);
    expect(after).toEqual([...before.slice(0, -1), "mate:face:sky:seal"]);
  });

  it("changes nothing when it is the face the Mate already wears", () => {
    const once = withZeropsChangedFace(["mate", "mate:bot:Ada"], SKY_SEAL);
    expect(withZeropsChangedFace(once, SKY_SEAL)).toEqual(once);
  });
});

/**
 * Writing one kind must not delete the others. The first version of the
 * preserve rule dropped group, role and label unconditionally, so naming an
 * agent silently un-grouped its project — on a live account, before this test
 * existed.
 */
describe("withZeropsGroupTags preserves what it was not asked to change", () => {
  const FULL = ["mate:g:aaa", "mate:role:dev", "mate:name:Beviro CRM", "mate:bot:Ada"];

  it("keeps group, role and label when only the agent is named", () => {
    const after = withZeropsBotTag(FULL, "Bruno");
    expect(after).toContain("mate:g:aaa");
    expect(after).toContain("mate:role:dev");
    expect(after).toContain("mate:name:Beviro CRM");
    expect(after).toContain("mate:bot:Bruno");
  });

  /**
   * Membership is written as a whole, so a caller changing a role passes the
   * group with it. A role alone is a project that has left its group and kept
   * a role — which is why a membership patch meets a fresh read (`data/tagWriter.ts`).
   */
  it("treats a role without a group as leaving the group", () => {
    const after = withZeropsGroupTags(FULL, { role: "prod" });
    expect(after).toContain("mate:role:prod");
    expect(after).not.toContain("mate:g:aaa");
    expect(after).not.toContain("mate:name:Beviro CRM");
    // The agent still travels with the project.
    expect(after).toContain("mate:bot:Ada");
  });

  it("keeps the group and the name when the whole membership is passed", () => {
    const after = withZeropsGroupTags(FULL, {
      groupId: "aaa",
      role: "prod",
      label: "Beviro CRM",
    });
    expect(after).toContain("mate:g:aaa");
    expect(after).toContain("mate:name:Beviro CRM");
    expect(after).toContain("mate:role:prod");
    expect(after).not.toContain("mate:role:dev");
  });

  it("keeps the agent through a regrouping — it belongs to the project", () => {
    expect(withZeropsGroupTags(FULL, { groupId: "bbb" })).toContain("mate:bot:Ada");
  });

  it("drops a stale name mirror when the project moves group unnamed", () => {
    const after = withZeropsGroupTags(FULL, { groupId: "bbb" });
    expect(after).toContain("mate:g:bbb");
    expect(after).not.toContain("mate:name:Beviro CRM");
  });

  it("carries the new mirror when the move names the group", () => {
    const after = withZeropsGroupTags(FULL, { groupId: "bbb", label: "Acme Docs" });
    expect(after).toContain("mate:name:Acme Docs");
    expect(after).not.toContain("mate:name:Beviro CRM");
  });
});

describe("deriveZeropsGroups — the viewer's own order", () => {
  const PROJECTS = [
    project("crm-dev", ["mate:g:aaa", "mate:name:Crm"], "crm-dev", "2024-01-01T00:00:00Z"),
    project("shop-dev", ["mate:g:bbb", "mate:name:Shop"], "shop-dev", "2024-03-01T00:00:00Z"),
    project("blog-dev", ["mate:g:ccc", "mate:name:Blog"], "blog-dev", "2024-02-01T00:00:00Z"),
    project("new-old", [], "loose-old", "2024-01-01T00:00:00Z"),
    project("new-new", [], "loose-new", "2024-06-01T00:00:00Z"),
  ];

  it.each([
    {
      case: "every group named, in the viewer's order",
      customOrder: ["ccc", "aaa", "bbb"],
      groups: ["ccc", "aaa", "bbb"],
    },
    {
      case: "a group the order does not name follows the named ones",
      customOrder: ["aaa", "ccc"],
      groups: ["aaa", "ccc", "bbb"],
    },
    {
      case: "unnamed groups follow newest first, as a new project would",
      customOrder: ["ccc"],
      groups: ["ccc", "bbb", "aaa"],
    },
    {
      case: "an id the listing no longer holds takes no place",
      customOrder: ["gone", "bbb", "aaa", "ccc"],
      groups: ["bbb", "aaa", "ccc"],
    },
    {
      case: "no order yet reads as newest first",
      customOrder: undefined,
      groups: ["bbb", "ccc", "aaa"],
    },
  ])("orders the groups as the viewer arranged them: $case", ({ customOrder, groups }) => {
    const result = deriveZeropsGroups(PROJECTS, {
      order: "custom",
      ...(customOrder === undefined ? {} : { customOrder }),
    });
    expect(result.groups.map((group) => group.groupId)).toEqual(groups);
  });

  it("keeps the ungrouped projects newest first — only groups are arranged by hand", () => {
    const result = deriveZeropsGroups(PROJECTS, { order: "custom", customOrder: ["aaa"] });
    expect(result.ungrouped.map((entry) => entry.id)).toEqual(["loose-new", "loose-old"]);
  });
});
