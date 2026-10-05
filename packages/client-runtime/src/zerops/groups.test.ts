import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "./api.ts";
import {
  changedMateFace,
  deriveZeropsGroups,
  formatMateFace,
  generateZeropsGroupId,
  appProjectName,
  kindOfRole,
  nameUnderApp,
  projectNameInApp,
  readMateFace,
  readZeropsMembership,
  withZeropsMateTag,
  ZEROPS_GROUP_ID_LENGTH,
  type ZeropsPlacedBirth,
  heldGroupLabel,
} from "./groups.ts";
import type { HqMate } from "./hq/client.ts";
import type { HqPlacement } from "./hq/placement.ts";

/** Where HQ places a project: in application `appId`, as `kind`, with its Mate's record. */
function placed(
  appId: string,
  kind: HqPlacement["kind"] = "mate",
  options: { readonly appName?: string; readonly mate?: HqPlacement["mate"] } = {},
): HqPlacement {
  return { appId, appName: options.appName ?? "", kind, mate: options.mate ?? null };
}

function project(
  name: string,
  options: {
    readonly hq?: HqPlacement;
    readonly tagList?: ReadonlyArray<string> | undefined;
    readonly id?: string;
    readonly created?: string;
  } = {},
): ZeropsProject {
  const tagList = "tagList" in options ? options.tagList : [];
  return {
    id: options.id ?? name,
    name,
    status: "ACTIVE",
    ...(tagList === undefined ? {} : { tagList }),
    ...(options.created === undefined ? {} : { created: options.created }),
    ...(options.hq === undefined ? {} : { hq: options.hq }),
  };
}

describe("readZeropsMembership", () => {
  it.each([
    {
      name: "reads where HQ places the project: its application, its role, the application's name",
      input: { hq: placed("abc", "production", { appName: "Beviro CRM" }) },
      expected: { groupId: "abc", role: "prod", label: "Beviro CRM" },
    },
    {
      name: "reads a stage HQ places as the stage",
      input: { hq: placed("abc", "stage") },
      expected: { groupId: "abc", role: "stage" },
    },
    {
      name: "reads a Mate that is also its application's stage as a Mate, in the dev/stage role",
      input: { hq: placed("abc", "devstage", { mate: { face: "" } }) },
      expected: { mate: true, groupId: "abc", role: "devstage" },
    },
    {
      name: "is absent for a project HQ does not place",
      input: { tagList: [] },
      expected: {},
    },
    {
      // HQ is the structure's only writer: a tag anybody could plant places nothing.
      name: "ignores the structure tags a project still carries",
      input: { tagList: ["mate:g:abc", "mate:role:dev", "mate:name:Beviro CRM", "mate:bot:Ada"] },
      expected: {},
    },
    {
      name: "trims the application's name",
      input: { hq: placed("abc", "stage", { appName: "  Beviro: the CRM " }) },
      expected: { groupId: "abc", role: "stage", label: "Beviro: the CRM" },
    },
    {
      name: "takes a blank application name for none",
      input: { hq: placed("abc", "stage", { appName: "   " }) },
      expected: { groupId: "abc", role: "stage" },
    },
    {
      // The marker is the Zerops GUI's: HQ placing a Mate is its existence.
      name: "reads no Mate from the bare marker HQ does not place",
      input: { tagList: ["billing:team-a", "mate", "internal"] },
      expected: {},
    },
    {
      name: "reads no Mate from the marker on a project HQ places as a stage",
      input: { hq: placed("abc", "stage"), tagList: ["mate"] },
      expected: { groupId: "abc", role: "stage" },
    },
    {
      name: "takes a Mate HQ places for one, whatever its tags say",
      input: { hq: placed("abc", "mate"), tagList: [] },
      expected: { mate: true, groupId: "abc", role: "dev" },
    },
    {
      name: "does not mistake a namespaced tag for the marker",
      input: { tagList: ["mate:standup:u-ada", "mate:signer:codex:u-ada", "mate:closed-off"] },
      expected: {},
    },
    {
      // D3: a Mate's name is its project's in Zerops; one an HQ before it still sends is nobody's.
      name: "keeps no Mate's name HQ still sends",
      input: { hq: placed("abc", "mate", { mate: { name: "Ada", face: "" } as HqMate }) },
      expected: { mate: true, groupId: "abc", role: "dev" },
    },
    {
      name: "reads a Mate HQ holds in no application by its record, in no group",
      input: {
        hq: {
          appId: null,
          appName: null,
          kind: "mate",
          mate: { face: "sky:flower" },
        } satisfies HqPlacement,
      },
      expected: { mate: true, face: { tint: "sky", shape: "flower" } },
    },
    {
      name: "reads no birth intent from a tag",
      input: { tagList: ["mate", "mate:birth:b-1"] },
      expected: {},
    },
  ])("$name", ({ input, expected }) => {
    expect(readZeropsMembership(input)).toEqual({
      mate: false,
      groupId: undefined,
      role: undefined,
      label: undefined,
      standUp: undefined,
      face: undefined,
      ...expected,
    });
  });

  it("treats a project with no tagList field and no placement as neither", () => {
    expect(readZeropsMembership(undefined)).toEqual({
      mate: false,
      groupId: undefined,
      role: undefined,
      label: undefined,
      standUp: undefined,
      face: undefined,
    });
  });
});

describe("kindOfRole — what HQ calls a project placed for a role", () => {
  it.each([
    ["dev", "mate"],
    ["devstage", "devstage"],
    ["stage", "stage"],
    ["prod", "production"],
  ] as const)("%s is %s", (role, kind) => {
    expect(kindOfRole(role)).toBe(kind);
  });
});

// Set up Mate on a plain project (restored over 116a2c54c) brings a Mate into a project its
// person tagged for themselves: their tags stay. Only the obsolete `mate:*` metadata tags an earlier
// client wrote on a Mate go, now that HQ holds that metadata.
describe("withZeropsMateTag", () => {
  it.each([
    {
      case: "a plain project keeps its own tags",
      tags: ["billing:team-a", "env:shop"],
      want: ["billing:team-a", "env:shop", "mate"],
    },
    {
      case: "an old Mate's metadata tags go",
      tags: ["mate:standup:u-ada", "mate:face:rose:seal"],
      want: ["mate"],
    },
    {
      case: "both at once",
      tags: ["billing:team-a", "mate", "mate:g:abc"],
      want: ["billing:team-a", "mate"],
    },
    { case: "no tags", tags: undefined, want: ["mate"] },
  ])("$case", ({ tags, want }) => {
    expect(withZeropsMateTag(tags)).toEqual(want);
  });

  it("is idempotent — every set-up path may write it without looking", () => {
    const once = withZeropsMateTag(["keep"]);
    expect(withZeropsMateTag(once)).toEqual(once);
  });
});

describe("who asked for a Mate's stand-up, as HQ's birth record names them", () => {
  const born = (standupRequestedBy: string | null | undefined) =>
    placed("abc", "mate", {
      mate: { face: "", ...(standupRequestedBy === undefined ? {} : { standupRequestedBy }) },
    });
  it.each([
    { name: "names who asked for it", hq: born("u-ada"), standUp: { by: "u-ada" } },
    { name: "is absent on a Mate nobody asked it of", hq: born(null), standUp: undefined },
    { name: "is absent where an older HQ says nothing", hq: born(undefined), standUp: undefined },
    { name: "names nobody when blank", hq: born("  "), standUp: undefined },
    { name: "is absent on a project HQ does not place", hq: undefined, standUp: undefined },
  ])("$name", ({ hq, standUp }) => {
    expect(readZeropsMembership({ hq }).standUp).toEqual(standUp);
  });
});

describe("who made a Mate, as HQ's record names them", () => {
  const made = (madeBy: string | null | undefined) =>
    placed("abc", "mate", {
      mate: { face: "", ...(madeBy === undefined ? {} : { madeBy }) },
    });
  it.each([
    { name: "names who made it", hq: made("u-ada"), madeBy: "u-ada" },
    { name: "is absent on a Mate recorded before HQ kept it", hq: made(null), madeBy: undefined },
    { name: "is absent where an older HQ says nothing", hq: made(undefined), madeBy: undefined },
    { name: "names nobody when blank", hq: made("  "), madeBy: undefined },
    { name: "is absent on a project HQ does not place", hq: undefined, madeBy: undefined },
  ])("$name", ({ hq, madeBy }) => {
    expect(readZeropsMembership({ hq }).madeBy).toEqual(madeBy);
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
  it("groups environments by where HQ places them and leaves the rest ungrouped", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", { hq: placed("aaa", "mate") }),
        project("crm-prod", { hq: placed("aaa", "production") }),
        project("shop-dev", { hq: placed("bbb", "mate") }),
        project("loose"),
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

  it("orders environments Mate → stage → production, then by name", () => {
    const result = deriveZeropsGroups(
      [
        project("d", { hq: placed("aaa", "production") }),
        project("c", { hq: placed("aaa", "stage") }),
        project("b", { hq: placed("aaa", "mate") }),
        project("a", { hq: placed("aaa", "stage") }),
      ],
      { order: "name" },
    );

    expect(
      result.groups[0]?.environments.map((environment) => [
        environment.project.name,
        environment.role,
      ]),
    ).toEqual([
      ["b", "dev"],
      ["a", "stage"],
      ["c", "stage"],
      ["d", "prod"],
    ]);
  });

  it("names a group after its application in HQ, and says so", () => {
    const result = deriveZeropsGroups(
      [project("crm-dev", { hq: placed("aaa", "mate", { appName: "Beviro CRM" }) })],
      { order: "name" },
    );

    expect(result.groups[0]).toMatchObject({ name: "Beviro CRM", nameSource: "hq" });
  });

  // `mate-rig-e2e-a`, 2026-10-02: a New project that stopped before its Mate left an application
  // with no project, drawn nowhere — nobody could add the Mate it was made for.
  it("draws an application HQ holds with no project as its group, empty, as HQ names it", () => {
    const result = deriveZeropsGroups(
      [project("crm-dev", { hq: placed("aaa", "mate", { appName: "Beviro CRM" }) })],
      {
        order: "name",
        apps: [
          { id: "aaa", name: "Beviro CRM" },
          { id: "eee", name: "mate-rig-e2e-a" },
        ],
      },
    );

    expect(
      result.groups.map((group) => [
        group.groupId,
        group.name,
        group.nameSource,
        group.environments.length,
        group.pending.length,
      ]),
    ).toEqual([
      ["aaa", "Beviro CRM", "hq", 1, 0],
      ["eee", "mate-rig-e2e-a", "hq", 0, 0],
    ]);
  });

  // HQ refuses an application without a name: one read blank is a read problem, its id the handle.
  it("says the name is unread when its application's name reads blank, the id as its handle", () => {
    const result = deriveZeropsGroups([project("crm-dev", { hq: placed("aaa", "mate") })], {
      order: "name",
    });

    expect(result.groups[0]).toMatchObject({ name: "aaa", nameSource: "unread" });
  });

  it("orders groups by display name, case-insensitively", () => {
    const result = deriveZeropsGroups(
      [
        project("one", { hq: placed("aaa", "mate", { appName: "zebra" }) }),
        project("two", { hq: placed("bbb", "mate", { appName: "Apple" }) }),
        project("three", { hq: placed("ccc", "mate", { appName: "mango" }) }),
      ],
      { order: "name" },
    );

    expect(result.groups.map((group) => group.name)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("reports the production environment of a group, and none when there is not exactly one", () => {
    const [single] = deriveZeropsGroups(
      [
        project("p", { hq: placed("aaa", "production") }),
        project("d", { hq: placed("aaa", "mate") }),
      ],
      { order: "name" },
    ).groups;
    expect(single?.production?.project.name).toBe("p");

    const [ambiguous] = deriveZeropsGroups(
      [
        project("p1", { hq: placed("aaa", "production") }),
        project("p2", { hq: placed("aaa", "production") }),
      ],
      { order: "name" },
    ).groups;
    expect(ambiguous?.production).toBeUndefined();

    const [none] = deriveZeropsGroups([project("d", { hq: placed("aaa", "mate") })], {
      order: "name",
    }).groups;
    expect(none?.production).toBeUndefined();
  });

  it("orders group names numerically, not lexically: env2 < env10", () => {
    const result = deriveZeropsGroups(
      [
        project("env10", { hq: placed("aaa", "mate", { appName: "env10" }) }),
        project("env2", { hq: placed("bbb", "mate", { appName: "env2" }) }),
      ],
      { order: "name" },
    );

    expect(result.groups.map((group) => group.name)).toEqual(["env2", "env10"]);
  });

  it("breaks an environment name tie by project id, deterministically", () => {
    const forward = deriveZeropsGroups(
      [
        project("dev", { hq: placed("aaa", "mate"), id: "z" }),
        project("dev", { hq: placed("aaa", "mate"), id: "a" }),
      ],
      { order: "name" },
    );
    const backward = deriveZeropsGroups(
      [
        project("dev", { hq: placed("aaa", "mate"), id: "a" }),
        project("dev", { hq: placed("aaa", "mate"), id: "z" }),
      ],
      { order: "name" },
    );

    expect(forward.groups[0]?.environments.map((entry) => entry.project.id)).toEqual(["a", "z"]);
    expect(backward.groups[0]?.environments.map((entry) => entry.project.id)).toEqual(["a", "z"]);
  });

  it("is stable regardless of the order projects arrive in", () => {
    const projects = [
      project("crm-prod", { hq: placed("aaa", "production") }),
      project("shop-dev", { hq: placed("bbb", "mate") }),
      project("crm-dev", { hq: placed("aaa", "mate") }),
    ];
    const forward = deriveZeropsGroups(projects, { order: "name" });
    const backward = deriveZeropsGroups(projects.toReversed(), { order: "name" });

    expect(JSON.stringify(forward)).toBe(JSON.stringify(backward));
  });

  it("leaves a project HQ does not place ungrouped, whatever tags it carries, rather than throwing", () => {
    const result = deriveZeropsGroups(
      [
        project("legacy", { tagList: undefined }),
        project("planted", { tagList: ["mate:g:aaa", "mate:role:dev", "mate:name:Acme"] }),
      ],
      { order: "name" },
    );

    expect(result.groups).toEqual([]);
    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["legacy", "planted"]);
  });
});

describe("deriveZeropsGroups — newest first", () => {
  it("orders groups by their earliest member's created time, newest first", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", { hq: placed("aaa"), created: "2024-01-01T00:00:00Z" }),
        project("shop-dev", { hq: placed("bbb"), created: "2024-03-01T00:00:00Z" }),
        project("blog-dev", { hq: placed("ccc"), created: "2024-02-01T00:00:00Z" }),
      ],
      { order: "newest" },
    );

    expect(result.groups.map((group) => group.groupId)).toEqual(["bbb", "ccc", "aaa"]);
  });

  it("takes a group's birth from its earliest member — a later stage must not reorder it", () => {
    const result = deriveZeropsGroups(
      [
        project("crm-dev", { hq: placed("aaa"), created: "2024-01-01T00:00:00Z" }),
        // aaa's prod is added after bbb was born; if the group's birth were
        // taken from its newest member instead of its earliest, aaa would
        // wrongly jump ahead of bbb.
        project("crm-prod", {
          hq: placed("aaa", "production"),
          created: "2024-06-01T00:00:00Z",
        }),
        project("shop-dev", { hq: placed("bbb"), created: "2024-03-01T00:00:00Z" }),
      ],
      { order: "newest" },
    );

    expect(result.groups.map((group) => group.groupId)).toEqual(["bbb", "aaa"]);
  });

  it("sorts a group with no created member last, and ties by name then id", () => {
    const result = deriveZeropsGroups(
      [
        project("zzz", { hq: placed("aaa", "mate", { appName: "Zzz" }) }),
        project("bbb", {
          hq: placed("bbb", "mate", { appName: "Bbb" }),
          created: "2024-01-01T00:00:00Z",
        }),
        project("aaa", { hq: placed("ccc", "mate", { appName: "Aaa" }) }),
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
        project("old", { created: "2024-01-01T00:00:00Z" }),
        project("new", { created: "2024-06-01T00:00:00Z" }),
        project("undated"),
      ],
      { order: "newest" },
    );

    expect(result.ungrouped.map((entry) => entry.name)).toEqual(["new", "old", "undated"]);
  });

  it("breaks an ungrouped created tie by name, then id", () => {
    const result = deriveZeropsGroups(
      [
        project("b", { id: "z", created: "2024-01-01T00:00:00Z" }),
        project("a", { id: "a", created: "2024-01-01T00:00:00Z" }),
      ],
      { order: "newest" },
    );

    expect(result.ungrouped.map((entry) => entry.id)).toEqual(["a", "z"]);
  });

  it("is stable regardless of the order projects arrive in", () => {
    const projects = [
      project("crm-dev", { hq: placed("aaa"), created: "2024-01-01T00:00:00Z" }),
      project("shop-dev", { hq: placed("bbb"), created: "2024-03-01T00:00:00Z" }),
      project("loose", { created: "2024-02-01T00:00:00Z" }),
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

describe("deriveZeropsGroups — a creation awaiting its project", () => {
  // Pressed at 10:00:00; the platform lists the project before its call answers with the id.
  const T0 = Date.parse("2026-10-02T10:00:00.000Z");
  const at = (seconds: string) => `2026-10-02T${seconds}.000Z`;
  const awaiting = (over: Partial<ZeropsPlacedBirth> = {}): ZeropsPlacedBirth => ({
    ...birth("c-acme", "aaa", T0),
    awaitingProject: true,
    ...over,
  });
  const drawn = (tree: ReturnType<typeof deriveZeropsGroups>) => ({
    ungrouped: tree.ungrouped.map((entry) => entry.id),
    pending: tree.groups.flatMap((group) => group.pending.map((member) => member.projectId)),
  });

  it("holds back a listed unplaced project while it waits, and is that project once the id matches", () => {
    const projects = [project("p-acme", { created: at("10:00:02") })];
    expect(drawn(deriveZeropsGroups(projects, { order: "name", births: [awaiting()] }))).toEqual({
      ungrouped: [],
      pending: ["c-acme"],
    });
    expect(
      drawn(deriveZeropsGroups(projects, { order: "name", births: [birth("p-acme", "aaa", T0)] })),
    ).toEqual({ ungrouped: [], pending: ["p-acme"] });
  });

  it("draws another person's project made in the same span once the id arrives and is not it", () => {
    const projects = [project("p-other", { created: at("10:00:01") })];
    expect(
      drawn(deriveZeropsGroups(projects, { order: "name", births: [awaiting()] })).ungrouped,
    ).toEqual([]);
    expect(
      drawn(deriveZeropsGroups(projects, { order: "name", births: [birth("p-acme", "aaa", T0)] }))
        .ungrouped,
    ).toEqual(["p-other"]);
  });

  it.each([
    {
      case: "a stopped creation without an id draws the project it held back",
      projects: [project("p-other", { created: at("10:00:01") })],
      births: [awaiting({ failed: true })],
      ungrouped: ["p-other"],
    },
    {
      case: "a project made before the press is always drawn",
      projects: [project("p-old", { created: at("09:59:59") })],
      births: [awaiting()],
      ungrouped: ["p-old"],
    },
    {
      case: "a project whose making is not known is drawn",
      projects: [project("p-unknown")],
      births: [awaiting()],
      ungrouped: ["p-unknown"],
    },
    {
      case: "a project HQ places is drawn in its group whatever waits",
      projects: [project("p-placed", { created: at("10:00:01"), hq: placed("bbb") })],
      births: [awaiting()],
      ungrouped: [],
    },
  ])("$case", ({ projects, births, ungrouped }) => {
    expect(drawn(deriveZeropsGroups(projects, { order: "name", births })).ungrouped).toEqual(
      ungrouped,
    );
  });
});

describe("deriveZeropsGroups — creations under way", () => {
  it("replaces an uncertain creation with the project bearing its HQ intent, even after a rename", () => {
    const pending = {
      ...birth("local", "aaa", 1),
      intent: "intent-1",
      awaitingProject: true,
      failed: true,
    };
    const listed = project("Renamed", {
      id: "real",
      tagList: ["mate"],
      hq: placed("aaa", "mate", { mate: { face: "", birthId: "intent-1" } }),
    });
    const tree = deriveZeropsGroups([listed], { order: "name", births: [pending] });
    expect(tree.groups[0]?.pending).toEqual([]);
    expect(tree.groups[0]?.environments.map((entry) => entry.project.id)).toEqual(["real"]);
  });

  it("keeps a different intent's creation when two Mates have the same name", () => {
    const pending = {
      ...birth("local", "aaa", 1),
      intent: "intent-1",
      awaitingProject: true,
      failed: true,
    };
    const listed = project(pending.placement.displayName, {
      id: "real",
      tagList: ["mate:birth:intent-2"],
      hq: placed("aaa"),
    });
    expect(
      deriveZeropsGroups([listed], { order: "name", births: [pending] }).groups[0]?.pending,
    ).toHaveLength(1);
  });
  it.each([
    {
      case: "a birth the listing does not hold yet is a pending member of its group",
      projects: [project("crm-dev", { hq: placed("aaa") })],
      births: [birth("p-new", "aaa", 1)],
      pending: { aaa: ["p-new"] },
      environments: { aaa: ["crm-dev"] },
    },
    {
      case: "a birth whose project HQ places in a group is that listed member, once",
      projects: [project("crm-dev", { hq: placed("aaa") })],
      births: [birth("crm-dev", "aaa", 1)],
      pending: { aaa: [] },
      environments: { aaa: ["crm-dev"] },
    },
    {
      case: "a birth listed before HQ places it stays pending, not ungrouped",
      projects: [project("p-new")],
      births: [birth("p-new", "aaa", 1)],
      pending: { aaa: ["p-new"] },
      environments: { aaa: [] },
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

  // D3: a pending Mate's project is named as the Mate is; its name is that one name.
  it("names a pending member as its project will be named, a Mate by its own name", () => {
    const [group] = deriveZeropsGroups([], {
      order: "name",
      births: [
        birth("p-quinn", "aaa", 1, { displayName: "Quinn" }),
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
    { case: "its application's name in HQ first", appName: "Stored", expected: "Stored" },
    { case: "then the name its creation gave it", appName: "", expected: "Todo" },
  ])("names a group being created from $case", ({ appName, expected }) => {
    const [group] = deriveZeropsGroups(
      [project("crm-dev", { hq: placed("aaa", "mate", { appName }) })],
      {
        order: "name",
        births: [birth("p-new", "aaa", 1)],
      },
    ).groups;
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
        project("crm-dev", { hq: placed("aaa"), created: "2024-01-01T00:00:00Z" }),
        project("shop-dev", { hq: placed("bbb"), created: "2024-03-01T00:00:00Z" }),
        // Listed with no created time yet: its group is dated by the birth beside it.
        project("new-dev", { hq: placed("new") }),
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

/**
 * A Mate's face — the colour and the shape its person picked — is one value in HQ's record of
 * it, `<tint>:<shape>`. Read permissively: a part this client does not know is left out, so the
 * derived one stands in for it.
 */
describe("a Mate's face, as HQ records it", () => {
  it.each(MATE_TINT_IDS)("reads back every shape %s is written with", (tint) => {
    for (const shape of MATE_SHAPE_IDS) {
      const face = formatMateFace({ tint, shape });
      expect(face).toBe(`${tint}:${shape}`);
      expect(readMateFace(face)).toEqual({ tint, shape });
    }
  });

  it.each([
    { case: "no face recorded", face: "", expected: undefined },
    {
      case: "a tint a newer client added",
      face: "teal:gem",
      expected: { tint: undefined, shape: "gem" },
    },
    {
      case: "a shape a newer client added",
      face: "coral:blob",
      expected: { tint: "coral", shape: undefined },
    },
    { case: "nothing this client knows", face: "teal:blob", expected: undefined },
    { case: "a face with no shape", face: "coral", expected: { tint: "coral", shape: undefined } },
    {
      case: "a part a newer client appended",
      face: "coral:gem:wink",
      expected: { tint: "coral", shape: "gem" },
    },
    { case: "an id in another case, never guessed at", face: "Coral:Gem", expected: undefined },
  ] as const)("reads $case", ({ face, expected }) => {
    expect(readMateFace(face)).toEqual(expected);
  });

  it("reads the face off where HQ places its Mate, and none where HQ records no Mate", () => {
    const ada = placed("aaa", "mate", { mate: { face: "violet:flower" } });
    expect(readZeropsMembership({ hq: ada }).face).toEqual({ tint: "violet", shape: "flower" });
    expect(readZeropsMembership({ hq: placed("aaa", "mate") }).face).toBeUndefined();
  });
});

/**
 * A face changed after the Mate's birth. A Mate that wore its name's tint —
 * no face picked, or one picked since — keeps its name among the names the
 * tints are shared out over (`<tint>:<shape>:named`), so nobody else changes
 * colour; a Mate whose face was picked at its birth never had a place there
 * and takes none now.
 */
describe("a Mate's face changed after its birth", () => {
  const SKY_SEAL = { tint: "sky", shape: "seal" } as const;

  it.each([
    {
      case: "a Mate that wore its name's tint keeps its name's place",
      worn: "",
      face: "sky:seal:named",
    },
    {
      case: "a Mate whose face was picked at its birth takes no place",
      worn: "coral:gem",
      face: "sky:seal",
    },
    {
      case: "a Mate changed before keeps the place it kept",
      worn: "coral:gem:named",
      face: "sky:seal:named",
    },
    {
      case: "a Mate whose face this client reads no tint from wore its name's",
      worn: "teal:gem",
      face: "sky:seal:named",
    },
  ])("$case", ({ worn, face }) => {
    const changed = changedMateFace(readMateFace(worn), SKY_SEAL);
    expect(changed).toBe(face);
    expect(readMateFace(changed)).toMatchObject(SKY_SEAL);
  });

  it.each([
    { face: "sky:seal:named", expected: { ...SKY_SEAL, named: true } },
    { face: "sky:seal", expected: SKY_SEAL },
    { face: "sky:seal:wink", expected: SKY_SEAL },
    { face: "teal:blob:named", expected: undefined },
  ] as const)("reads $face", ({ face, expected }) => {
    expect(readMateFace(face)).toStrictEqual(expected);
  });
});

describe("deriveZeropsGroups — the viewer's own order", () => {
  const PROJECTS = [
    project("crm-dev", {
      hq: placed("aaa", "mate", { appName: "Crm" }),
      created: "2024-01-01T00:00:00Z",
    }),
    project("shop-dev", {
      hq: placed("bbb", "mate", { appName: "Shop" }),
      created: "2024-03-01T00:00:00Z",
    }),
    project("blog-dev", {
      hq: placed("ccc", "mate", { appName: "Blog" }),
      created: "2024-02-01T00:00:00Z",
    }),
    project("new-old", { id: "loose-old", created: "2024-01-01T00:00:00Z" }),
    project("new-new", { id: "loose-new", created: "2024-06-01T00:00:00Z" }),
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

describe("heldGroupLabel: HQ's name off the projects the account holds", () => {
  const placed = (appId: string, appName: string) => ({
    hq: { appId, appName, kind: "mate" as const, mate: { face: "" } },
  });
  it.each([
    ["HQ's name", [placed("grpA1", "Orchard")], "Orchard"],
    ["another application's member", [placed("grpB2", "Harbor")], undefined],
    ["no project held", [], undefined],
  ] as const)("%s", (_case, projects, label) => {
    expect(heldGroupLabel(projects, "grpA1")).toBe(label);
  });
});

describe("nameUnderApp", () => {
  it.each([
    { project: "SPN - Rune", app: "SPN", expected: "Rune" },
    { project: "Vary + - Milo", app: "Vary +", expected: "Milo" },
    { project: "  SPN - Rune  ", app: " SPN ", expected: "Rune" },
    { project: "Shopper - stage", app: "Shop", expected: "Shopper - stage" },
    { project: "Sage", app: "Ahmad Tea", expected: "Sage" },
    { project: "spn - Rune", app: "SPN", expected: "spn - Rune" },
    { project: "SPN Rune", app: "SPN", expected: "SPN Rune" },
    { project: "Rune", app: undefined, expected: "Rune" },
    { project: "SPN - Rune", app: "", expected: "SPN - Rune" },
    { project: "SPN", app: "SPN", expected: "SPN" },
    { project: "SPN - ", app: "SPN", expected: "SPN -" },
    { project: "SPN -   ", app: "SPN", expected: "SPN -" },
  ])("$project under $app is $expected", ({ project: name, app, expected }) => {
    expect(nameUnderApp(name, app)).toBe(expected);
  });
});

describe("appProjectName", () => {
  it("names a project in full: the application, a dash, its own name", () => {
    expect(appProjectName("SPN", "Rune")).toBe("SPN - Rune");
    expect(appProjectName(" SPN ", " Rune ")).toBe("SPN - Rune");
  });

  it("keeps the own name alone where the project has no application", () => {
    expect(appProjectName(undefined, "Rune")).toBe("Rune");
  });
});

describe("projectNameInApp", () => {
  it("cuts the application HQ names for the project", () => {
    const inApp = project("SPN - Rune", { hq: placed("a", "mate", { appName: "SPN" }) });
    expect(projectNameInApp(inApp)).toBe("Rune");
  });

  it("keeps the whole name of a project HQ places in no application", () => {
    expect(projectNameInApp(project("SPN - Rune"))).toBe("SPN - Rune");
  });
});
