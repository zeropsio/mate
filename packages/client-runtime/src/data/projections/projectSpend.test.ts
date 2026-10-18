import { describe, expect, it } from "vite-plus/test";

import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectSpendScope, type ProjectSpendValue } from "../families/projectSpend.ts";
import { computeSpend } from "./projectSpend.ts";

const ORG = "acme";
const scope = projectSpendScope(ORG);
const spend = (value: Partial<ProjectSpendValue> = {}): AccountInput => ({
  kind: "baseline-commit",
  scope,
  generation: 0,
  via: "zerops-read",
  members: [ORG],
  rows: [
    {
      family: "projectSpend",
      id: ORG,
      value: {
        firstDay: "2026-09-19",
        lastDay: "2026-10-18",
        complete: true,
        byProject: {
          "tea-prod": { "2026-10-18": 1.5, "2026-09-19": 0.25 },
          "tea-stage": { "2026-10-18": 0.5 },
          "tea-raya": { "2026-10-10": 2 },
          watchlist: { "2026-10-18": 9 },
        },
        ...value,
      },
      revision: { kind: "zerops", version: null },
    },
  ],
});
const refused: AccountInput = {
  kind: "stream",
  key: scope,
  now: 0,
  event: {
    kind: "fault",
    fault: { outcome: "authoritative-denial", message: "Not allowed." },
    jitter: 0,
  },
};
const derive = (inputs: ReadonlyArray<AccountInput>, projectIds: ReadonlyArray<string>) =>
  computeSpend.derive(
    readsOfState(inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount)),
    { orgId: ORG, projectIds },
  );

describe("a project's compute spend", () => {
  it("sums the project's Zerops projects by day over 30 days, a day without a row costing nothing", () => {
    const read = derive([spend()], ["tea-prod", "tea-stage", "tea-raya"]);
    if (read.kind !== "read") throw new Error(`Expected a read, got ${read.kind}.`);
    expect(read.days).toHaveLength(30);
    expect(read.days[0]).toBe("2026-09-19");
    expect(read.days.at(-1)).toBe("2026-10-18");
    expect(read.usd[0]).toBe(0.25);
    expect(read.usd[read.days.indexOf("2026-10-10")]).toBe(2);
    expect(read.usd.at(-1)).toBe(2);
    expect(read.usd.reduce((sum, usd) => sum + usd, 0)).toBe(4.25);
  });

  it("another project's spend never counts", () => {
    const read = derive([spend()], ["tea-prod"]);
    expect(read.kind === "read" && read.usd.at(-1)).toBe(1.5);
  });

  it.each([
    { name: "while billing has not answered", inputs: [], kind: "reading" },
    { name: "when billing refuses the viewer", inputs: [refused], kind: "unknown" },
    { name: "after a refusal with a figure held", inputs: [spend(), refused], kind: "read" },
    {
      name: "for a project a partial answer leaves out",
      inputs: [spend({ complete: false })],
      kind: "unknown",
    },
  ])("is $kind $name", ({ inputs, kind }) => {
    expect(derive(inputs, ["tea-prod", "nextstore"]).kind).toBe(kind);
  });
});
