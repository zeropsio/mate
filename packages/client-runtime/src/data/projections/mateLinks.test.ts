import { describe, expect, it } from "vite-plus/test";

import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { initialEnvironment } from "../../zerops/environments/environmentMachine.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateLink, mateLinks } from "./mateLinks.ts";

const value = (key: string, overrides: Partial<MateLinkValue> = {}): MateLinkValue => ({
  key,
  projectId: key.split(":")[0] ?? key,
  orgId: "org",
  origin: `https://${key.replace(":", "-")}.example`,
  shown: true,
  environment: initialEnvironment({ record: null }),
  container: initialContainer(),
  ...overrides,
});

/** The adapter's reading of each Mate, in the order it read them. */
const read = (state: AccountState, values: ReadonlyArray<MateLinkValue>, from = 1): AccountState =>
  values.reduce(
    (current, next, at) =>
      reduceAccount(current, {
        kind: "rows",
        scope: mateLinkScope(next.projectId),
        generation: 0,
        method: "read",
        via: "mate-direct",
        rows: [
          {
            family: "mateLink",
            id: next.key,
            value: next,
            revision: { kind: "mate-link", sequence: from + at },
          },
        ],
      }).state,
    state,
  );

describe("mateLinks", () => {
  it.each<{
    readonly name: string;
    readonly values: ReadonlyArray<MateLinkValue>;
    readonly keys: ReadonlyArray<string>;
  }>([
    { name: "nothing read: no Mate", values: [], keys: [] },
    {
      name: "every Mate shown, in key order",
      values: [value("p2:s2"), value("p1:s1")],
      keys: ["p1:s1", "p2:s2"],
    },
    {
      name: "a Mate no longer shown is left out, its reading kept",
      values: [value("p1:s1"), value("p2:s2", { shown: false })],
      keys: ["p1:s1"],
    },
  ])("$name", ({ values, keys }) => {
    const links = mateLinks.derive(readsOfState(read(emptyAccount, values)), null);
    expect([...links.machines.keys()]).toEqual(keys);
    expect([...links.containers.keys()]).toEqual(keys);
  });

  it("is the same reading until a Mate's own changes", () => {
    const state = read(emptyAccount, [value("p1:s1"), value("p2:s2")]);
    const before = mateLinks.derive(readsOfState(state), null);
    const again = mateLinks.derive(readsOfState(state), null);
    expect(mateLinks.equals(before, again)).toBe(true);
    const moved = read(state, [value("p2:s2", { origin: "https://moved.example" })], 10);
    expect(mateLinks.equals(before, mateLinks.derive(readsOfState(moved), null))).toBe(false);
  });

  it("keeps a later reading over an earlier one, whichever arrives last", () => {
    const later = read(emptyAccount, [value("p1:s1", { origin: "https://later.example" })], 5);
    const both = read(later, [value("p1:s1", { origin: "https://earlier.example" })], 2);
    expect(mateLink.derive(readsOfState(both), "p1:s1")?.origin).toBe("https://later.example");
  });

  it("names no Mate it never read", () => {
    expect(mateLink.derive(readsOfState(emptyAccount), "p1:s1")).toBeNull();
  });
});
