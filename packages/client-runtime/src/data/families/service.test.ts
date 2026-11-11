import { describe, expect, it } from "vite-plus/test";
import serviceFixture from "../../zerops/__fixtures__/z3-eval.service-stack.json" with { type: "json" };
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectFamily } from "./project.ts";
import { serviceFamily, servicesScope } from "./service.ts";

/** The complete service listing and complete /user-data/search records, with test values. */
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

describe("a service row's variables", () => {
  it("keep only what surfaces read of them: every other variable is dropped at decode", () => {
    const row = serviceFamily.zerops!.decode({
      ...serviceFixture.list[0]!,
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
});

describe("a service read by its id", () => {
  const service = (lastUpdate: string, subdomainAccess: boolean) =>
    serviceFamily.zerops!.decode({
      ...serviceFixture.list[0]!,
      id: "zcp",
      projectId: "p1",
      name: "zcp",
      lastUpdate,
      subdomainAccess,
    })!.value;
  const project = projectFamily.zerops!.decode({
    ...serviceFixture.list[0]!.project!,
    id: "p1",
    clientId: ORG,
  })!.value;
  const held = () =>
    liveZerops({
      running: [],
      projects: [project],
      services: [service("2026-10-02T12:01:40Z", false)],
    });
  const read = (lastUpdate: string): AccountInput => ({
    kind: "rows",
    scope: servicesScope(ORG),
    generation: 1,
    method: "read",
    via: "zerops-read",
    rows: [
      {
        family: "service",
        id: "zcp",
        value: service(lastUpdate, true),
        revision: { kind: "zerops", version: null },
      },
    ],
  });
  it.each([
    {
      name: "updated after the row held: it replaces it",
      at: "2026-10-02T12:01:50Z",
      access: true,
    },
    {
      name: "no newer than the row held: it changes nothing",
      at: "2026-10-02T12:01:40Z",
      access: false,
    },
  ])("$name", ({ at, access }) => {
    const state = [...held(), read(at)].reduce(
      (current, input) => reduceAccount(current, input).state,
      emptyAccount,
    );
    expect(readsOfState(state).fact("service", "zcp")).toMatchObject({
      value: { subdomainAccess: access },
    });
  });
});
