import { EngineSendContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { agentContext, fitContextLine } from "./agentContext.ts";
import type { VaultChange } from "./vaultModel.ts";

const change = (key: string): VaultChange => ({
  scope: { kind: "shared" },
  hostname: null,
  key,
  kind: "added",
  sensitive: true,
  at: "2026-10-07T11:00:00Z",
  impact: { restart: [], unread: true, literal: [] },
});
const keys = (count: number) => Array.from({ length: count }, (_, n) => change(`KEY_${n + 1}`));
const fits = Schema.is(EngineSendContext);

describe("fitContextLine", () => {
  it.each<{ readonly title: string; readonly line: string; readonly fitted: string }>([
    { title: "a line that fits stays whole", line: "appdev #3 landed", fitted: "appdev #3 landed" },
    {
      title: "a long line is cut on a word boundary, with an ellipsis",
      line: `${"word ".repeat(60)}end`,
      fitted: `${"word ".repeat(48).trimEnd()}…`,
    },
    {
      title: "a long line without a space is cut at the limit",
      line: "x".repeat(300),
      fitted: `${"x".repeat(239)}…`,
    },
  ])("$title", ({ line, fitted }) => {
    expect(fitContextLine(line)).toBe(fitted);
    expect(fitContextLine(line).length).toBeLessThanOrEqual(240);
  });
});

describe("agentContext", () => {
  it("tells each vault change on a line of its own after what merged", () => {
    const context = agentContext(["appdev #3 landed: Add the order summary"], keys(2));
    expect(context.lines).toHaveLength(3);
    expect(context.lines[0]).toBe("appdev #3 landed: Add the order summary");
    expect(context.lines[1]).toContain("KEY_1");
    expect(context.lines[2]).toContain("KEY_2");
    expect(context.told.map((each) => each.key)).toEqual(["KEY_1", "KEY_2"]);
  });

  it.each<{
    readonly title: string;
    readonly landed: number;
    readonly vault: number;
    readonly last: string;
    readonly told: number;
  }>([
    {
      title: "vault changes past the room end in how many more there are",
      landed: 1,
      vault: 8,
      last: "and 5 more vault changes",
      told: 3,
    },
    {
      title: "five landings leave a line for the vault changes",
      landed: 5,
      vault: 2,
      last: "and 2 more vault changes",
      told: 0,
    },
  ])("$title", ({ landed, vault, last, told }) => {
    const context = agentContext(
      Array.from({ length: landed }, (_, n) => `appdev #${n + 1} landed`),
      keys(vault),
    );
    expect(fits(context.lines)).toBe(true);
    expect(context.lines.at(-1)).toBe(last);
    expect(context.told).toHaveLength(told);
  });

  it("is nothing when there is nothing to tell", () => {
    expect(agentContext([], [])).toEqual({ lines: [], told: [] });
  });
});
