import { describe, expect, it } from "vite-plus/test";

import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { indexOf, reduceAccount, type AccountInput } from "../reducer.ts";
import { activeScope, versionFamily } from "./version.ts";

const decode = versionFamily.zerops!.decode;
const ORG = "org";
const scope = activeScope(ORG);

const versionRow = (id: string, version: number, status: string, serviceId = "s1") => ({
  family: "version" as const,
  id,
  value: { id, projectId: "p1", serviceId, status, source: "GIT" },
  revision: { kind: "zerops" as const, version },
});

const rows = (...batch: ReturnType<typeof versionRow>[]): AccountInput => ({
  kind: "rows",
  scope,
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: batch,
});

const members = (add: string[], remove: string[]): AccountInput => ({
  kind: "membership",
  scope,
  generation: 1,
  delta: { add, remove },
});

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>): AccountState =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);

/** The organization's active versions, read: `old` is the one service s1 runs. */
const live = (): AccountState =>
  apply(emptyAccount, [
    {
      kind: "stream",
      key: linkKeys.zerops(ORG),
      now: 0,
      event: { kind: "demand", demanded: true },
    },
    { kind: "stream", key: scope, now: 0, event: { kind: "demand", demanded: true } },
    { kind: "stream", key: scope, now: 0, event: { kind: "attempt" } },
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: ["old"],
      rows: [versionRow("old", 1, "ACTIVE")],
    },
  ]);

describe("the version family", () => {
  it("reads a whole app-version row: its service, project, status and source", () => {
    expect(
      decode({
        id: "v1",
        clientId: "c1",
        projectId: "p1",
        serviceStackId: "s1",
        name: null,
        status: "ACTIVE",
        source: "NONE",
        created: "2026-10-05T18:49:09Z",
        _version: 3,
      }),
    ).toEqual({
      id: "v1",
      version: 3,
      value: { id: "v1", projectId: "p1", serviceId: "s1", status: "ACTIVE", source: "NONE" },
    });
  });

  it("reads a row whose source the search left out as one with no source stated", () => {
    expect(
      decode({ id: "v1", projectId: "p1", serviceStackId: "s1", status: "BACKUP" })?.value.source,
    ).toBeNull();
  });

  it.each([
    { name: "without its service", row: { id: "v1", projectId: "p1", status: "ACTIVE" } },
    { name: "without its status", row: { id: "v1", projectId: "p1", serviceStackId: "s1" } },
    { name: "not an object", row: "v1" },
  ])("refuses a row $name", ({ row }) => {
    expect(decode(row)).toBeNull();
  });

  // A replaced active version arrives as one membership frame `add:[new], delete:[old]` and one
  // update frame (old BACKUP, new ACTIVE), in either order.
  it.each([
    {
      order: "membership first",
      frames: [
        members(["new"], ["old"]),
        rows(versionRow("old", 2, "BACKUP"), versionRow("new", 2, "ACTIVE")),
      ],
    },
    {
      order: "updates first",
      frames: [
        rows(versionRow("old", 2, "BACKUP"), versionRow("new", 2, "ACTIVE")),
        members(["new"], ["old"]),
      ],
    },
  ])("a replaced active version leaves the service on the new one, $order", ({ frames }) => {
    const before = live();
    expect(indexOf(before, "active", "s1")).toEqual(new Set(["old"]));

    const replaced = apply(before, frames);
    expect(indexOf(replaced, "active", "s1")).toEqual(new Set(["new"]));
  });

  it("never counts a version the active list never admitted while its row says it is not active", () => {
    const building = apply(live(), [rows(versionRow("next", 1, "BUILDING"))]);
    expect(indexOf(building, "active", "s1")).toEqual(new Set(["old"]));
  });

  it("lets a version go that left the active list, whatever its last row said", () => {
    const left = apply(live(), [members([], ["old"])]);
    expect(indexOf(left, "active", "s1") ?? new Set()).toEqual(new Set());
  });
});
