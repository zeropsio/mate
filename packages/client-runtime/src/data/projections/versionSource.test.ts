import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { activeScope, versionScope } from "../families/version.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { versionSource } from "./versionSource.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

const live = () =>
  apply(emptyAccount, liveZerops({ running: [], active: [{ id: "v1", serviceId: "s1" }] }));
const derive = (state: AccountState, versionId: string) =>
  versionSource.derive(readsOfState(state), { orgId: ORG, versionId });

describe("versionSource", () => {
  it.each([
    {
      name: "a version the active versions hold",
      versionId: "v1",
      expected: { kind: "known", source: "GIT" },
    },
    {
      name: "a version their answered list does not hold: to be read by id",
      versionId: "v2",
      expected: { kind: "awaited" },
    },
  ])("$name", ({ versionId, expected }) => {
    expect(derive(live(), versionId)).toEqual(expected);
  });

  it("keeps what it holds through an outage", () => {
    const down = apply(live(), [
      event(activeScope(ORG), { kind: "parent-lost" }),
      event(linkKeys.zerops(ORG), {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "socket closed" },
      }),
    ]);
    expect(derive(down, "v1")).toEqual({ kind: "known", source: "GIT" });
    expect(derive(down, "v2")).toEqual({ kind: "awaited" });
  });

  it("waits for the active versions' first answer before anything is read by id", () => {
    const connecting = apply(emptyAccount, [
      event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
      event(activeScope(ORG), { kind: "demand", demanded: true }),
    ]);
    expect(derive(connecting, "v2")).toEqual({ kind: "unknown" });
  });

  it("says a version the platform does not have is not listed, once its read by id is refused", () => {
    const scope = versionScope(ORG, "v2");
    const gone = apply(live(), [
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      event(scope, {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "definitive-refusal", message: "HTTP 400" },
      }),
    ]);
    expect(derive(gone, "v2")).toEqual({ kind: "not-listed" });
  });

  it("says a version it does not hold will not arrive once the active versions were refused", () => {
    const refused = apply(live(), [
      event(activeScope(ORG), {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "authoritative-denial", message: "no" },
      }),
    ]);
    expect(derive(refused, "v2")).toEqual({ kind: "refused" });
    expect(derive(refused, "v1")).toEqual({ kind: "known", source: "GIT" });
  });

  it("says a version whose read by id answered a row it cannot read was unreadable", () => {
    const scope = versionScope(ORG, "v2");
    const damaged = apply(live(), [
      event(scope, { kind: "demand", demanded: true }),
      event(scope, { kind: "attempt" }),
      { kind: "baseline-begin", scope, generation: 1 },
      {
        kind: "baseline-commit",
        scope,
        generation: 1,
        via: "zerops-read",
        members: ["v2"],
        rows: [],
        partial: true,
      },
      event(scope, { kind: "baseline-committed" }),
    ]);
    expect(derive(damaged, "v2")).toEqual({ kind: "unreadable" });
  });
});
