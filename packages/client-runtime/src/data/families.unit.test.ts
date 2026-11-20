// @effect-diagnostics globalDate:off -- the spend day has a fixed expected instant.
import { expect, it } from "vite-plus/test";
import { RepoListEntry } from "@t3tools/shared/hqChanges";
import { HqNavigationApp } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";
import { liveProjects, liveZerops, ORG, zeropsVersion } from "./__fixtures__/account.ts";
import { gitRemote } from "./__fixtures__/hqWire.ts";
import { detailScopeOf } from "./demand.ts";
import { hqAppDetailFamily } from "./families/hqAppDetail.ts";
import { hqAppFamily } from "./families/hqNavigation.ts";
import { assetUrlExpired } from "./families/mateWorkspace.ts";
import { projectFamily, projectsScope } from "./families/project.ts";
import { midnightIn } from "./families/projectSpend.ts";
import { publicRoutingFamily, routingsScope } from "./families/publicRouting.ts";
import { serviceFamily } from "./families/service.ts";
import { usageFamily, usageOwnerOf } from "./families/usage.ts";
import { activeScope } from "./families/version.ts";
import { emptyAccount } from "./model.ts";
import { indexOf, reduceAccount, type AccountInput } from "./reducer.ts";
import { readsOfState } from "./store.ts";

const apply = (inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);

// witness: packages/client-runtime/src/data/families/hqAppDetail.ts | repo.remote === undefined && prior?.remote !== undefined → repo.remote == null && prior?.remote !== undefined
it("ST13: An app detail that omits its remote keeps its custody, while an explicit disconnection replaces it", () => {
  const readRepo = Schema.decodeUnknownSync(RepoListEntry);
  const repo = readRepo({
    name: "api",
    mainHead: "a".repeat(40),
    updatedAt: "2026-10-06T00:00:00Z",
  });
  const repos = (row: typeof repo) => hqAppDetailFamily.hq!.decode([row], "repos")!;
  const connected = readRepo({ ...repo, remote: gitRemote });
  const disconnected = readRepo({ ...repo, remote: null });
  const held = repos(connected);

  expect(hqAppDetailFamily.keepUnsaid!(held, repos(repo), "listing")).toEqual({
    kind: "repos",
    value: [{ ...repo, remote: gitRemote }],
  });
  expect(hqAppDetailFamily.keepUnsaid!(held, repos(disconnected), "listing")).toEqual({
    kind: "repos",
    value: [{ ...repo, remote: null }],
  });
});

// witness: packages/client-runtime/src/data/families/hqNavigation.ts | adopted: Schema.optionalKey(Schema.Boolean), → adopt: Schema.optionalKey(Schema.Boolean),
it("ST14: An adopted birth keeps its identity, so its existing project is protected", () => {
  const adopted = {
    id: "birth-ada",
    face: "ada",
    madeBy: "owner",
    intent: { recipe: { revision: "abc" }, agents: ["one"] },
    attempts: {},
    projectId: "ada",
    adopted: true,
  };
  const app = Schema.decodeUnknownSync(HqNavigationApp)({
    id: "shop",
    name: "Shop",
    contents: { empty: false, deletingProjectIds: [] },
    environments: [],
    changes: [],
    releaseOffer: null,
    projectIds: ["ada"],
    births: [adopted],
  });
  expect(hqAppFamily.hq!.decode(app, "app:shop")?.births).toEqual([adopted]);
});

// witness: packages/client-runtime/src/data/families/project.ts | from === "push" && userRoles !== undefined → from === "push" && userRoles !== undefined && userRoles.length > 0
it("ST15: A project frame's user roles are the whole override list: an empty list removes every known override", () => {
  const project = {
    id: "p1",
    clientId: ORG,
    name: "p1",
    status: "ACTIVE",
    lastUpdate: "2026-10-06T10:00:00Z",
  };
  const row = (patch: Readonly<Record<string, unknown>>, version: number | null) => ({
    family: "project" as const,
    id: project.id,
    value: projectFamily.zerops!.decode({ ...project, ...patch })!.value,
    revision: { kind: "zerops" as const, version },
  });
  const renamed = { name: "Renamed", lastUpdate: "2026-10-06T10:05:00Z" };
  const scope = projectsScope(ORG);
  const granted = apply([
    ...liveProjects(ORG, [project]),
    {
      kind: "rows",
      scope: detailScopeOf(ORG, { family: "project", listing: "project", ownerId: "p1" }),
      generation: 0,
      method: "read",
      via: "zerops-read",
      rows: [
        row(
          {
            userRoles: [
              { clientUserId: "cu-1", roleCode: "BASIC_USER" },
              { clientUserId: "cu-dev", roleCode: "OWNER" },
            ],
          },
          null,
        ),
      ],
    },
    {
      kind: "rows",
      scope,
      generation: 1,
      method: "read",
      via: "zerops-read",
      rows: [row({ ...renamed, userRoles: [{ mine: true, roleCode: "READ_ONLY" }] }, 3)],
    },
  ]);
  expect(readsOfState(granted).fact("project", "p1")).toMatchObject({
    value: {
      userRoles: [
        { clientUserId: "cu-1", roleCode: "BASIC_USER" },
        { clientUserId: "cu-dev", roleCode: "OWNER" },
      ],
      viewerRoleCode: "READ_ONLY",
    },
  });
  const updated = reduceAccount(granted, {
    kind: "rows",
    scope,
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [row({ ...renamed, userRoles: [] }, 4)],
  });
  const fact = readsOfState(updated.state).fact("project", "p1");
  expect(
    fact.kind === "known"
      ? [fact.value.name, fact.value.userRoles, fact.value.viewerRoleCode]
      : null,
  ).toEqual(["Renamed", [], undefined]);
});

// witness: packages/client-runtime/src/data/families/service.ts | new Set(["appVersionId", "appVersionName"]) → new Set(["appVersionId", "appVersionName", "ZEROPS_YAML"])
it("ST16: A service keeps only the variables surfaces read; every other is dropped at decode", () => {
  const variable = (key: string, content: string) => ({
    _version: 3,
    id: `${key}-id`,
    clientId: "org",
    projectId: "p1",
    serviceStackId: "s1",
    serviceStackName: "app",
    key,
    content,
    type: "USER",
    editable: true,
    sensitive: false,
    internal: false,
    created: "2026-10-07T10:00:00Z",
    lastUpdate: "2026-10-07T11:00:00Z",
  });
  const row = serviceFamily.zerops!.decode({
    id: "s1",
    projectId: "p1",
    name: "app",
    status: "ACTIVE",
    userData: [
      variable("appVersionId", "v1"),
      variable("appVersionName", "build 7"),
      variable("ZEROPS_YAML", "secret: hunter2"),
      variable("DB_PASSWORD", "hunter2"),
    ],
  });
  expect(row?.value.userData).toEqual([
    { key: "appVersionId", content: "v1" },
    { key: "appVersionName", content: "build 7" },
  ]);
  expect(JSON.stringify(row)).not.toContain("hunter2");
});

// witness: packages/client-runtime/src/data/families/version.ts | value.status === "ACTIVE" && listed !== "removed" → value.status === "ACTIVE" || listed !== "removed"
it("ST17: A version the active list never admitted is never counted while its row says it is not active", () => {
  const live = apply(
    liveZerops({ running: [], active: [{ id: "old", serviceId: "s1", status: "ACTIVE" }] }),
  );
  const building = reduceAccount(live, {
    kind: "rows",
    scope: activeScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [
      {
        family: "version",
        id: "next",
        revision: zeropsVersion(1),
        value: { id: "next", projectId: "p1", serviceId: "s1", status: "BUILDING", source: null },
      },
    ],
  });
  expect(indexOf(building.state, "active", "s1")).toEqual(new Set(["old"]));
});

// witness: packages/client-runtime/src/data/families/publicRouting.ts | listed === "member" ? (value.projectId ?? null) : null → value.projectId ?? null
it("ST18: A subdomain turned off leaves the project by the listing's delete alone", () => {
  const scope = routingsScope(ORG);
  const routing = publicRoutingFamily.zerops!.decode({
    id: "r1",
    projectId: "p1",
    isEditable: false,
    sslEnabled: true,
    domains: [
      {
        domainName: "buntest-demo-3000.prg1.zerops.app",
        dnsCheckStatus: "OK",
        sslStatus: "ACTIVE",
      },
    ],
    locations: [{ path: "/", port: 3000, serviceStackId: "s1" }],
  })!;
  const live = apply([
    ...liveProjects(ORG, [{ id: "p1" }]),
    { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
    { kind: "stream", key: scope, now: 0, event: { kind: "handshake" } },
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: ["r1"],
      rows: [
        { family: "publicRouting", id: "r1", value: routing.value, revision: zeropsVersion(1) },
      ],
    },
    { kind: "stream", key: scope, now: 0, event: { kind: "baseline-committed" } },
  ]);
  expect([...indexOf(live, "routingProject", "p1")]).toEqual(["r1"]);
  const removed = reduceAccount(live, {
    kind: "membership",
    scope,
    generation: 1,
    delta: { add: [], remove: ["r1"] },
  });
  expect([...indexOf(removed.state, "routingProject", "p1")]).toEqual([]);
  expect(
    removed.directives.filter(
      (directive) => directive.kind === "resolve-rows" || directive.kind === "verify-absence",
    ),
  ).toEqual([]);
});

// witness: packages/client-runtime/src/data/families/projectSpend.ts | return wall - offsetAt(first, timeZone); → return wall - offsetAt(first - 86_400_000, timeZone);
it("ST19: A spend day begins at midnight in its time zone, across a clock change too", () => {
  expect(midnightIn("2026-10-26", "Europe/Prague")).toBe(Date.parse("2026-10-25T23:00:00.000Z"));
});

// witness: packages/client-runtime/src/data/families/usage.ts | body: ({ ownerId }) => ({ search: projectSearchOf(ownerId ?? ""), groupBy: "containerId" }) → body: ({ orgId, ownerId }) => ({ search: projectSearchOf(`${orgId}/${ownerId?.split("/")[1]}`), groupBy: "containerId" })
it("ST20: Usage is asked in the project's own organization, whichever organization is shown", () => {
  const query = usageFamily.zeropsQuery!.body({
    orgId: "shown",
    ownerId: usageOwnerOf("project-org", "p1"),
  });
  expect(query.search).toEqual([
    { name: "clientId", operator: "eq", value: "project-org" },
    { name: "projectId", operator: "eq", value: "p1" },
  ]);
});

// witness: packages/client-runtime/src/data/families/mateWorkspace.ts | value.expiresAt <= now); → value.expiresAt < now);
it("ST+1: A Mate's signed address is expired from its expiry time on, and one without a finite expiry is never taken as current", () => {
  const signed = { relativeUrl: "/signed", expiresAt: 900 };
  expect(assetUrlExpired(signed, 899)).toBe(false);
  expect(assetUrlExpired(signed, 900)).toBe(true);
  expect(assetUrlExpired(signed, 901)).toBe(true);
  expect(assetUrlExpired({ relativeUrl: "/signed", expiresAt: Number.NaN }, 0)).toBe(true);
});
