import type { VaultChange } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import {
  heldWrites,
  vaultChangeIdOf,
  vaultChipLabel,
  vaultChipsOnlyText,
  vaultTurnChanges,
} from "./vaultTurnNotes.logic";

const NO_IMPACT = { restart: [], unread: true, literal: [] };

const change = (
  key: string,
  kind: VaultChange["kind"],
  at: string,
  scope: VaultChange["scope"] = { kind: "shared" },
): VaultChange => ({
  scope,
  hostname: scope.kind === "shared" ? null : "appdev",
  key,
  kind,
  sensitive: false,
  at,
  impact: NO_IMPACT,
});

describe("vaultTurnChanges", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly own: ReadonlyArray<VaultChange>;
    readonly since: ReadonlyArray<VaultChange>;
    readonly hidden?: ReadonlyArray<VaultChange>;
    readonly told: ReadonlyArray<string>;
  }> = [
    { name: "nothing changed", own: [], since: [], told: [] },
    {
      name: "a write made during the agent's turn is told though it is older than its last word",
      own: [change("LOG_LEVEL", "changed", "2026-10-07T10:00:00.000Z")],
      since: [],
      told: ["LOG_LEVEL changed"],
    },
    {
      name: "a change made elsewhere is told",
      own: [],
      since: [change("API_URL", "changed", "2026-10-07T10:05:00Z")],
      told: ["API_URL changed"],
    },
    {
      name: "one value is told once, by the platform's word",
      own: [change("STRIPE_KEY", "added", "2026-10-07T10:00:00.400Z")],
      since: [change("STRIPE_KEY", "added", "2026-10-07T10:00:01Z")],
      told: ["STRIPE_KEY added"],
    },
    {
      name: "the same key in two scopes is two values",
      own: [change("PORT", "changed", "2026-10-07T10:00:00Z")],
      since: [
        change("PORT", "changed", "2026-10-07T10:01:00Z", { kind: "service", serviceId: "s1" }),
      ],
      told: ["PORT changed", "PORT changed"],
    },
    {
      name: "a removal only the client knows is told",
      own: [change("OLD_TOKEN", "removed", "2026-10-07T10:00:00Z")],
      since: [],
      told: ["OLD_TOKEN removed"],
    },
    {
      name: "a change set aside or sent is not told again",
      own: [],
      since: [
        change("A", "changed", "2026-10-07T10:00:00Z"),
        change("B", "added", "2026-10-07T10:02:00Z"),
      ],
      hidden: [change("A", "changed", "2026-10-07T10:00:00Z")],
      told: ["B added"],
    },
    {
      name: "a value changed again after it was set aside is told",
      own: [],
      since: [change("A", "changed", "2026-10-07T10:09:00Z")],
      hidden: [change("A", "changed", "2026-10-07T10:00:00Z")],
      told: ["A changed"],
    },
    {
      name: "oldest first",
      own: [change("Z", "added", "2026-10-07T10:00:00Z")],
      since: [change("A", "changed", "2026-10-07T10:03:00Z")],
      told: ["Z added", "A changed"],
    },
  ];
  for (const { name, own, since, hidden, told } of cases)
    it(name, () => {
      const changes = vaultTurnChanges({
        own,
        since,
        hidden: new Set((hidden ?? []).map(vaultChangeIdOf)),
      });
      expect(changes.map(vaultChipLabel)).toEqual(told);
    });
});

describe("vaultChipsOnlyText", () => {
  it("names each key once and no value", () => {
    expect(
      vaultChipsOnlyText([
        change("STRIPE_KEY", "added", "2026-10-07T10:00:00Z"),
        change("LOG_LEVEL", "changed", "2026-10-07T10:01:00Z"),
        change("LOG_LEVEL", "changed", "2026-10-07T10:02:00Z", {
          kind: "service",
          serviceId: "s1",
        }),
      ]),
    ).toBe("I updated the vault: STRIPE_KEY, LOG_LEVEL.");
  });
});

describe("heldWrites", () => {
  const held = (...changes: ReadonlyArray<VaultChange>) =>
    changes.reduce<ReadonlyArray<VaultChange>>(heldWrites, []).map(vaultChipLabel);
  it.each([
    {
      name: "a value added and removed before it is told is no news",
      changes: [
        change("TMP", "added", "2026-10-07T10:00:00Z"),
        change("TMP", "removed", "2026-10-07T10:01:00Z"),
      ],
      told: [],
    },
    {
      name: "a value changed then removed is told as removed",
      changes: [
        change("OLD", "changed", "2026-10-07T10:00:00Z"),
        change("OLD", "removed", "2026-10-07T10:01:00Z"),
      ],
      told: ["OLD removed"],
    },
    {
      name: "a value added then changed is told as added",
      changes: [
        change("NEW", "added", "2026-10-07T10:00:00Z"),
        change("NEW", "changed", "2026-10-07T10:01:00Z"),
      ],
      told: ["NEW added"],
    },
    {
      name: "other values stay",
      changes: [
        change("A", "added", "2026-10-07T10:00:00Z"),
        change("B", "changed", "2026-10-07T10:01:00Z"),
      ],
      told: ["A added", "B changed"],
    },
  ])("$name", ({ changes, told }) => {
    expect(held(...changes)).toEqual(told);
  });
});
