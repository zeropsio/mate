import { describe, expect, it } from "vite-plus/test";
import serviceFixture from "../../zerops/__fixtures__/z3-eval.service-stack.json" with { type: "json" };

import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { indexOf, reduceAccount, type AccountInput } from "../reducer.ts";
import { activeScope, versionFamily } from "./version.ts";

const decode = versionFamily.zerops!.decode;
const ORG = "org";
const scope = activeScope(ORG);

const versionRow = (id: string, version: number, status: string, serviceId = "s1") => {
  const value = decode({
    ...serviceFixture.list[0]!.activeAppVersion!,
    id,
    projectId: "p1",
    serviceStackId: serviceId,
    status,
    _version: version,
  })!.value;
  return { family: "version" as const, id, value, revision: { kind: "zerops" as const, version } };
};

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
  it("never counts a version the active list never admitted while its row says it is not active", () => {
    const building = apply(live(), [rows(versionRow("next", 1, "BUILDING"))]);
    expect(indexOf(building, "active", "s1")).toEqual(new Set(["old"]));
  });

  it("lets a version go that left the active list, whatever its last row said", () => {
    const left = apply(live(), [members([], ["old"])]);
    expect(indexOf(left, "active", "s1") ?? new Set()).toEqual(new Set());
  });
});
