import { describe, expect, it } from "vite-plus/test";
import serviceFixture from "../../zerops/__fixtures__/z3-eval.service-stack.json" with { type: "json" };
import { liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { detailScopeOf } from "../demand.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, streamOf, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectFamily, projectsScope, type ProjectValue } from "./project.ts";

// The captured project's complete platform row, with a synthetic identity and time.
const recorded = serviceFixture.list[0]!.project!;
const { userRoles: _roles, ...listing } = recorded;
const role = recorded.userRoles[0]!;
const grants = [
  { clientUserId: "cu-1", roleCode: "BASIC_USER" },
  { clientUserId: "cu-dev", roleCode: "OWNER" },
];
const value = (patch: Readonly<Record<string, unknown>>): ProjectValue =>
  projectFamily.zerops!.decode({ ...listing, id: "p1", clientId: ORG, name: "p1", ...patch })!
    .value as ProjectValue;
const scope = projectsScope(ORG);
const held = (): ReadonlyArray<AccountInput> =>
  liveZerops({ running: [], projects: [{ id: "p1", lastUpdate: "2026-10-06T10:00:00Z" }] }).map(
    (input) =>
      input.kind === "baseline-commit" && input.scope === scope
        ? {
            ...input,
            rows: [
              {
                family: "project",
                id: "p1",
                value: value({ lastUpdate: "2026-10-06T10:00:00Z" }),
                revision: zeropsVersion(1),
              },
            ],
          }
        : input,
  );
const ownRead = (lastUpdate: string): AccountInput => {
  const detail = detailScopeOf(ORG, { family: "project", listing: "project", ownerId: "p1" });
  return {
    kind: "rows",
    scope: detail,
    generation: streamOf(emptyAccount, detail).generation,
    method: "read",
    via: "zerops-read",
    rows: [
      {
        family: "project",
        id: "p1",
        value: value({
          lastUpdate,
          userRoles: grants.map((grant, i) => ({ ...role, ...grant, id: `r${i}` })),
        }),
        revision: { kind: "zerops", version: null },
      },
    ],
  };
};
const listingRow = (method: "read" | "push", userRoles: ReadonlyArray<unknown>): AccountInput => ({
  kind: "rows",
  scope,
  generation: 1,
  method,
  via: method === "read" ? "zerops-read" : "zerops-realtime",
  rows: [
    {
      family: "project",
      id: "p1",
      value: value({ name: "Renamed", lastUpdate: "2026-10-06T10:05:00Z", userRoles }),
      revision: zeropsVersion(method === "read" ? 3 : 4),
    },
  ],
});
const reduce = (inputs: ReadonlyArray<AccountInput>) =>
  readsOfState(
    inputs.reduce((current, input) => reduceAccount(current, input).state, emptyAccount),
  ).fact("project", "p1");

describe("the project's own row", () => {
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

  it("A project updateStream frame's userRoles is the whole override list: an empty list removes every known override", () => {
    const fact = reduce([
      ...held(),
      ownRead("2026-10-06T10:00:00Z"),
      listingRow("read", [{ mine: true, roleCode: "READ_ONLY" }]),
      listingRow("push", []),
    ]);
    const grantsOf =
      fact.kind !== "known"
        ? null
        : {
            name: fact.value.name,
            userRoles: fact.value.userRoles,
            viewerRoleCode: fact.value.viewerRoleCode,
          };
    expect(grantsOf).toEqual({ name: "Renamed", userRoles: [], viewerRoleCode: undefined });
  });
});
