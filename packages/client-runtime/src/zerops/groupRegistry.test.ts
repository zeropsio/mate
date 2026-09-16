import { describe, expect, it } from "vite-plus/test";

import {
  deriveGroupSlug,
  formatZeropsRegistryTags,
  GROUP_SLUG_PATTERN,
  parseZeropsRegistry,
  projectTagWriteBody,
  toRoleRegistry,
  type ZeropsRegistry,
} from "./groupRegistry.ts";

const TAGS = [
  "mate:tool:gitea",
  "mate:gn:g-acme:acme",
  "mate:gm:g-acme:p-fen:mate",
  "mate:gm:g-acme:p-prod:production",
  "mate:gn:g-beta:beta",
  "mate:gm:g-beta:p-bmate:mate",
  "mate:release:g-acme:mates",
  "mate:leaving:u-jan",
  "billing:acme",
];

describe("parseZeropsRegistry", () => {
  it("reads the groups, their projects, the release switch and the leavers", () => {
    expect(parseZeropsRegistry(TAGS)).toEqual({
      groups: [
        {
          groupId: "g-acme",
          slug: "acme",
          projects: [
            { projectId: "p-fen", kind: "mate" },
            { projectId: "p-prod", kind: "production" },
          ],
          matesMayRelease: true,
        },
        {
          groupId: "g-beta",
          slug: "beta",
          projects: [{ projectId: "p-bmate", kind: "mate" }],
          matesMayRelease: false,
        },
      ],
      leaving: ["u-jan"],
      other: ["mate:tool:gitea", "billing:acme"],
    });
  });

  it("reads an empty or absent tag list as an empty registry", () => {
    expect(parseZeropsRegistry([])).toEqual({ groups: [], leaving: [], other: [] });
    expect(parseZeropsRegistry(undefined)).toEqual({ groups: [], leaving: [], other: [] });
  });

  it("takes a membership written before its group's name", () => {
    const registry = parseZeropsRegistry(["mate:gm:g-acme:p-fen:mate", "mate:gn:g-acme:acme"]);
    expect(registry.groups[0]?.projects).toEqual([{ projectId: "p-fen", kind: "mate" }]);
    expect(registry.other).toEqual([]);
  });

  it("orders groups by slug, whatever order the platform returned the tags in", () => {
    expect(
      parseZeropsRegistry(["mate:gn:g-z:zulu", "mate:gn:g-a:alpha"]).groups.map(
        (group) => group.slug,
      ),
    ).toEqual(["alpha", "zulu"]);
  });

  const kept: ReadonlyArray<{ readonly name: string; readonly tag: string }> = [
    { name: "a membership naming a group that does not exist", tag: "mate:gm:g-ghost:p-1:mate" },
    { name: "a release switch for a group that does not exist", tag: "mate:release:g-ghost:mates" },
    { name: "a membership with a kind nobody defined", tag: "mate:gm:g-acme:p-1:sandbox" },
    { name: "a membership missing its kind", tag: "mate:gm:g-acme:p-1" },
    { name: "a membership with a field too many", tag: "mate:gm:g-acme:p-1:mate:extra" },
    { name: "a group name whose slug is not a Gitea org name", tag: "mate:gn:g-x:Acme_Corp" },
    { name: "a group name with no slug", tag: "mate:gn:g-x" },
    { name: "a second name for a group that already has one", tag: "mate:gn:g-acme:other" },
    { name: "a leaving mark with no user", tag: "mate:leaving:" },
  ];

  it.each(kept.map((row) => [row.name, row.tag] as const))(
    "keeps %s rather than deleting it",
    (_name, tag) => {
      // `PUT /project/{id}` replaces tagList wholesale, so anything this
      // module cannot read has to come back out the other side.
      const registry = parseZeropsRegistry(["mate:gn:g-acme:acme", tag]);
      expect(registry.other).toContain(tag);
      expect(formatZeropsRegistryTags(registry)).toContain(tag);
    },
  );
});

describe("formatZeropsRegistryTags", () => {
  it("round-trips a registry it read", () => {
    const registry = parseZeropsRegistry(TAGS);
    expect(formatZeropsRegistryTags(registry)).toEqual([...TAGS].sort());
  });

  it("is stable, so a registry that has not moved writes the same document", () => {
    const registry = parseZeropsRegistry(TAGS);
    expect(formatZeropsRegistryTags(registry)).toEqual(
      formatZeropsRegistryTags(parseZeropsRegistry(formatZeropsRegistryTags(registry))),
    );
  });

  it("writes a new group, its projects and its switch", () => {
    const registry: ZeropsRegistry = {
      groups: [
        {
          groupId: "g-new",
          slug: "new",
          projects: [
            { projectId: "p-a", kind: "mate" },
            { projectId: "p-b", kind: "stage" },
          ],
          matesMayRelease: true,
        },
      ],
      leaving: [],
      other: ["mate:tool:gitea"],
    };
    expect(formatZeropsRegistryTags(registry)).toEqual([
      "mate:gm:g-new:p-a:mate",
      "mate:gm:g-new:p-b:stage",
      "mate:gn:g-new:new",
      "mate:release:g-new:mates",
      "mate:tool:gitea",
    ]);
  });

  it("writes no switch for a group that has not turned it on", () => {
    expect(
      formatZeropsRegistryTags({
        groups: [{ groupId: "g", slug: "acme", projects: [], matesMayRelease: false }],
        leaving: [],
        other: [],
      }),
    ).toEqual(["mate:gn:g:acme"]);
  });
});

describe("toRoleRegistry", () => {
  it("hands the role function the groups and their projects", () => {
    expect(toRoleRegistry(parseZeropsRegistry(TAGS))).toEqual({
      groups: [
        {
          id: "g-acme",
          slug: "acme",
          projects: [
            { id: "p-fen", kind: "mate" },
            { id: "p-prod", kind: "production" },
          ],
        },
        { id: "g-beta", slug: "beta", projects: [{ id: "p-bmate", kind: "mate" }] },
      ],
    });
  });
});

describe("deriveGroupSlug", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly existing?: ReadonlyArray<string>;
    readonly expected: string;
  }> = [
    { name: "Acme", expected: "acme" },
    { name: "Acme Corp", expected: "acme-corp" },
    { name: "  Acme   Corp  ", expected: "acme-corp" },
    { name: "Acme / Corp!", expected: "acme-corp" },
    { name: "Ácme Čorp", expected: "acme-corp" },
    // A slug has to start with a letter, so a numeric name gets a prefix.
    { name: "2024 Launch", expected: "group-2024-launch" },
    { name: "42", expected: "group-42" },
    { name: "", expected: "group" },
    { name: "!!!", expected: "group" },
    // Two characters is the floor.
    { name: "A", expected: "group" },
    { name: "ab", expected: "ab" },
    // Thirty characters is the ceiling, and it never ends on a dash.
    { name: "a".repeat(40), expected: "a".repeat(30) },
    { name: `${"ab ".repeat(12)}`, expected: "ab-ab-ab-ab-ab-ab-ab-ab-ab-ab" },
    // Unique in the account: the slug is the Gitea org.
    { name: "Acme", existing: ["acme"], expected: "acme-2" },
    { name: "Acme", existing: ["acme", "acme-2"], expected: "acme-3" },
    { name: "a".repeat(40), existing: ["a".repeat(30)], expected: `${"a".repeat(28)}-2` },
  ];

  it.each(table.map((row) => [row.name || "(empty)", row] as const))("%s", (_label, row) => {
    const slug = deriveGroupSlug(row.name, row.existing ?? []);
    expect(slug).toBe(row.expected);
    expect(GROUP_SLUG_PATTERN.test(slug)).toBe(true);
  });

  it("gives up rather than returning a slug that collides", () => {
    const taken = ["acme", ...Array.from({ length: 998 }, (_, index) => `acme-${index + 2}`)];
    expect(() => deriveGroupSlug("Acme", taken)).toThrow(/No free slug/u);
  });
});

describe("projectTagWriteBody", () => {
  it("carries the five fields the platform replaces, and never userRoles", () => {
    const body = projectTagWriteBody({
      name: "Gitea",
      description: "the account's git host",
      tagList: ["mate:tool:gitea"],
      publicIpV4Shared: true,
      maxCreditLimit: 100,
    });
    expect(body).toEqual({
      name: "Gitea",
      description: "the account's git host",
      tagList: ["mate:tool:gitea"],
      publicIpV4Shared: true,
      maxCreditLimit: 100,
    });
    expect(Object.keys(body)).not.toContain("userRoles");
  });

  it("fills the fields a caller did not read back, rather than omitting them", () => {
    // The platform replaces the record: an omitted field is "set it to
    // nothing", not "leave it alone".
    expect(projectTagWriteBody({ name: "Gitea", tagList: [] })).toEqual({
      name: "Gitea",
      description: "",
      tagList: [],
      publicIpV4Shared: false,
      maxCreditLimit: null,
    });
  });
});
