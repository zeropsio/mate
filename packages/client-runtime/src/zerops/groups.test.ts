import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import {
  deriveZeropsGroups,
  formatGroupTag,
  formatRoleTag,
  generateZeropsGroupId,
  readZeropsGroupTags,
  withZeropsBotTag,
  withZeropsGroupTags,
  formatLabelTag,
  ZEROPS_GROUP_ID_LENGTH,
  ZEROPS_GROUP_LABEL_MAX_LENGTH,
  type ZeropsEnvironmentRole,
} from "./groups.ts";

function project(
  name: string,
  tagList: ReadonlyArray<string> | undefined = [],
  id = name,
): ZeropsProject {
  return { id, name, status: "ACTIVE", ...(tagList === undefined ? {} : { tagList }) };
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
  ])("$name", ({ tagList, expected }) => {
    expect(readZeropsGroupTags(tagList)).toEqual(expected);
  });

  it("treats a project with no tagList field as untagged", () => {
    expect(readZeropsGroupTags(undefined)).toEqual({
      groupId: undefined,
      role: undefined,
      label: undefined,
    });
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
    const result = deriveZeropsGroups([
      project("crm-dev", ["mate:g:aaa", "mate:role:dev"]),
      project("crm-prod", ["mate:g:aaa", "mate:role:prod"]),
      project("shop-dev", ["mate:g:bbb", "mate:role:dev"]),
      project("loose", []),
    ]);

    expect(result.groups.map((group) => group.groupId)).toEqual(["aaa", "bbb"]);
    expect(result.groups[0]?.environments.map((environment) => environment.project.name)).toEqual([
      "crm-dev",
      "crm-prod",
    ]);
    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["loose"]);
  });

  it("orders environments dev → devstage → stage → prod, then by name", () => {
    const result = deriveZeropsGroups([
      project("d", ["mate:g:aaa", "mate:role:prod"]),
      project("c", ["mate:g:aaa", "mate:role:stage"]),
      project("b", ["mate:g:aaa", "mate:role:devstage"]),
      project("a", ["mate:g:aaa", "mate:role:dev"]),
    ]);

    expect(result.groups[0]?.environments.map((environment) => environment.role)).toEqual([
      "dev",
      "devstage",
      "stage",
      "prod",
    ]);
  });

  it("sorts a roleless environment last, and ties by name", () => {
    const result = deriveZeropsGroups([
      project("zzz", ["mate:g:aaa"]),
      project("bbb", ["mate:g:aaa", "mate:role:prod"]),
      project("aaa", ["mate:g:aaa"]),
    ]);

    expect(result.groups[0]?.environments.map((environment) => environment.project.name)).toEqual([
      "bbb",
      "aaa",
      "zzz",
    ]);
  });

  it("names a group from the store record when there is one", () => {
    const result = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa", "mate:name:Stale"])], {
      names: { aaa: "Beviro CRM" },
    });

    expect(result.groups[0]?.name).toBe("Beviro CRM");
    expect(result.groups[0]?.nameSource).toBe("store");
  });

  it("falls back to the label tag when the store knows nothing — the tree names itself with no store at all", () => {
    const result = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa", "mate:name:Beviro CRM"])]);

    expect(result.groups[0]?.name).toBe("Beviro CRM");
    expect(result.groups[0]?.nameSource).toBe("tag");
  });

  it("falls back to the group id when nothing names it, and says so", () => {
    const result = deriveZeropsGroups([project("crm-dev", ["mate:g:aaa"])]);

    expect(result.groups[0]?.name).toBe("aaa");
    expect(result.groups[0]?.nameSource).toBe("id");
  });

  it("takes the majority label when a rename only half-applied", () => {
    const result = deriveZeropsGroups([
      project("a", ["mate:g:aaa", "mate:name:New"]),
      project("b", ["mate:g:aaa", "mate:name:New"]),
      project("c", ["mate:g:aaa", "mate:name:Old"]),
    ]);

    expect(result.groups[0]?.name).toBe("New");
  });

  it("breaks a label tie deterministically rather than by list order", () => {
    const forward = deriveZeropsGroups([
      project("a", ["mate:g:aaa", "mate:name:Zebra"]),
      project("b", ["mate:g:aaa", "mate:name:Apple"]),
    ]);
    const backward = deriveZeropsGroups([
      project("b", ["mate:g:aaa", "mate:name:Apple"]),
      project("a", ["mate:g:aaa", "mate:name:Zebra"]),
    ]);

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
      { names: { aaa: "zebra", bbb: "Apple", ccc: "mango" } },
    );

    expect(result.groups.map((group) => group.name)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("reports the production environment of a group, and none when there is not exactly one", () => {
    const [single] = deriveZeropsGroups([
      project("p", ["mate:g:aaa", "mate:role:prod"]),
      project("d", ["mate:g:aaa", "mate:role:dev"]),
    ]).groups;
    expect(single?.production?.project.name).toBe("p");

    const [ambiguous] = deriveZeropsGroups([
      project("p1", ["mate:g:aaa", "mate:role:prod"]),
      project("p2", ["mate:g:aaa", "mate:role:prod"]),
    ]).groups;
    expect(ambiguous?.production).toBeUndefined();

    const [none] = deriveZeropsGroups([project("d", ["mate:g:aaa", "mate:role:dev"])]).groups;
    expect(none?.production).toBeUndefined();
  });

  it("is stable regardless of the order projects arrive in", () => {
    const projects = [
      project("crm-prod", ["mate:g:aaa", "mate:role:prod"]),
      project("shop-dev", ["mate:g:bbb", "mate:role:dev"]),
      project("crm-dev", ["mate:g:aaa", "mate:role:dev"]),
    ];
    const forward = deriveZeropsGroups(projects);
    const backward = deriveZeropsGroups(projects.toReversed());

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("treats a project with no tagList field as ungrouped rather than throwing", () => {
    const result = deriveZeropsGroups([project("legacy", undefined)]);

    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["legacy"]);
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
   * a role — which is why `updateProjectGroupTags` reads before it writes.
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
