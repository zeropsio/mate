import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectFamily, projectsScope, type ProjectValue } from "./project.ts";

const decode = projectFamily.zerops!.decode;

describe("projectFamily.decode", () => {
  it.each<{ readonly name: string; readonly raw: unknown; readonly row: unknown }>([
    {
      name: "keeps the whole row: its organization, tags, words and placement",
      raw: {
        id: "p1",
        clientId: "org",
        name: "Shop",
        status: "ACTIVE",
        created: "2026-10-05T18:49:08Z",
        description: "Preserve user description",
        tagList: ["custom", "mate:agent:Pia"],
        publicZone: "fte2334ab.prg1-zerops.zone",
        zeropsSubdomainHost: "24cb",
        mode: "LIGHT",
        userRoles: [{ clientUserId: "cu-1", roleCode: "OWNER" }],
        _version: 7,
      },
      row: {
        id: "p1",
        version: 7,
        value: {
          id: "p1",
          clientId: "org",
          name: "Shop",
          status: "ACTIVE",
          created: "2026-10-05T18:49:08Z",
          description: "Preserve user description",
          tagList: ["custom", "mate:agent:Pia"],
          publicZone: "fte2334ab.prg1-zerops.zone",
          zeropsSubdomainHost: "24cb",
          mode: "LIGHT",
          userRoles: [{ clientUserId: "cu-1", roleCode: "OWNER" }],
        },
      },
    },
    {
      name: "leaves out what the row leaves null, and orders by nothing without a version",
      raw: { id: "p1", name: "Shop", status: "NEW", description: null, publicZone: null },
      row: { id: "p1", version: null, value: { id: "p1", name: "Shop", status: "NEW" } },
    },
    {
      // A listing row names at most the viewer's own grant (a NO_ACCESS member's search), or none
      // (an organization member's): it says nothing of anybody else's.
      name: "takes the viewer's own grant a listing row names, and no list of everybody's",
      raw: {
        id: "p1",
        name: "Shop",
        status: "ACTIVE",
        userRoles: [{ mine: true, roleCode: "OWNER" }],
      },
      row: {
        id: "p1",
        version: null,
        value: { id: "p1", name: "Shop", status: "ACTIVE", viewerRoleCode: "OWNER" },
      },
    },
    {
      name: "an empty list of grants is unsaid, never everybody's grants taken away",
      raw: {
        id: "p1",
        name: "Shop",
        status: "ACTIVE",
        userRoles: [],
        lastUpdate: "2026-10-06T10:00:00Z",
      },
      row: {
        id: "p1",
        version: null,
        value: { id: "p1", name: "Shop", status: "ACTIVE", lastUpdate: "2026-10-06T10:00:00Z" },
      },
    },
    { name: "refuses a row without its name", raw: { id: "p1", status: "ACTIVE" }, row: null },
    { name: "refuses a row without its status", raw: { id: "p1", name: "Shop" }, row: null },
  ])("$name", ({ raw, row }) => {
    expect(decode(raw)).toEqual(row);
  });
});

describe("a project's own row", () => {
  it("is read by its id while a screen demands it: its answer is the row", () => {
    const listing = projectFamily.details!.find((detail) => detail.suffix === "project")!;
    expect(listing.zerops.path({ orgId: "org", ownerId: "p1" })).toBe("/project/p1");
    expect(listing.zerops.items({ id: "p1", name: "Shop" })).toEqual([{ id: "p1", name: "Shop" }]);
    expect(listing.zerops.items(null)).toBeUndefined();
  });

  const grants = [
    { clientUserId: "cu-1", roleCode: "BASIC_USER" },
    { clientUserId: "cu-dev", roleCode: "OWNER" },
  ];
  const ownRead = (lastUpdate: string): AccountInput => ({
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: [
      {
        family: "project",
        id: "p1",
        value: { id: "p1", name: "p1", status: "ACTIVE", lastUpdate, userRoles: grants },
        revision: { kind: "zerops", version: null },
      },
    ],
  });
  const push: AccountInput = {
    kind: "rows",
    scope: projectsScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "project",
        id: "p1",
        value: { id: "p1", name: "Renamed", status: "ACTIVE", lastUpdate: "2026-10-06T10:05:00Z" },
        revision: zeropsVersion(2),
      },
    ],
  };
  const held = () =>
    liveZerops({
      running: [],
      projects: [{ id: "p1", lastUpdate: "2026-10-06T10:00:00Z" }],
    });
  const reduce = (inputs: ReadonlyArray<AccountInput>) =>
    readsOfState(
      inputs.reduce((current, input) => reduceAccount(current, input).state, emptyAccount),
    ).fact("project", "p1");

  it.each([
    {
      name: "as current as the listing's row: it brings everybody's grants",
      at: "2026-10-06T10:00:00Z",
      roles: grants,
    },
    {
      name: "older than the listing's row: it is not taken",
      at: "2026-10-06T09:00:00Z",
      roles: undefined,
    },
  ])("$name", ({ at, roles }) => {
    const fact = reduce([...held(), ownRead(at)]);
    expect(fact.kind === "known" ? fact.value.userRoles : null).toEqual(roles);
  });

  it("keeps everybody's grants under a later push, which names none", () => {
    const fact = reduce([...held(), ownRead("2026-10-06T10:00:00Z"), push]);
    expect(fact).toMatchObject({ kind: "known", value: { name: "Renamed", userRoles: grants } });
  });

  // The roster read again from its start (an outage, a transient fault, a restarted attempt).
  const scope = projectsScope(ORG);
  const rebaseline = (value: ProjectValue): ReadonlyArray<AccountInput> => [
    {
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "fault", fault: { outcome: "transient", message: "gone" }, jitter: 0 },
    },
    { kind: "stream", key: scope, now: 99_999, event: { kind: "retry-due" } },
    { kind: "stream", key: scope, now: 99_999, event: { kind: "attempt" } },
    { kind: "stream", key: scope, now: 99_999, event: { kind: "handshake" } },
    { kind: "baseline-begin", scope, generation: 3 },
    {
      kind: "baseline-commit",
      scope,
      generation: 3,
      via: "zerops-realtime",
      members: ["p1"],
      rows: [{ family: "project", id: "p1", value, revision: zeropsVersion(3) }],
    },
  ];
  const listingRead = (value: ProjectValue): AccountInput => ({
    kind: "rows",
    scope,
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: [{ family: "project", id: "p1", value, revision: zeropsVersion(3) }],
  });
  const row = { id: "p1", name: "Renamed", status: "ACTIVE", lastUpdate: "2026-10-06T10:05:00Z" };
  const grantsOf = (inputs: ReadonlyArray<AccountInput>) => {
    const fact = reduce(inputs);
    if (fact.kind !== "known") return null;
    const { userRoles, viewerRoleCode, name } = fact.value;
    return { name, userRoles, viewerRoleCode };
  };

  it.each<{
    readonly name: string;
    readonly after: ReadonlyArray<AccountInput>;
    readonly grants: ReturnType<typeof grantsOf>;
  }>([
    {
      name: "the roster's baseline read again, naming no grants, keeps everybody's",
      after: rebaseline(row),
      grants: { name: "Renamed", userRoles: grants, viewerRoleCode: undefined },
    },
    {
      name: "a listing's read naming no grants keeps everybody's",
      after: [listingRead(row)],
      grants: { name: "Renamed", userRoles: grants, viewerRoleCode: undefined },
    },
    {
      name: "a baseline naming the viewer's own grant keeps everybody's beside it",
      after: rebaseline({ ...row, viewerRoleCode: "READ_ONLY" }),
      grants: { name: "Renamed", userRoles: grants, viewerRoleCode: "READ_ONLY" },
    },
  ])("$name", ({ after, grants: expected }) => {
    expect(grantsOf([...held(), ownRead("2026-10-06T10:00:00Z"), ...after])).toEqual(expected);
  });
});
