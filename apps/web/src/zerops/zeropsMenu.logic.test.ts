import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { describe, expect, it } from "vite-plus/test";

import { menuRows } from "./zeropsMenu.logic";

const row = (id: string, hq?: { readonly appId: string }): CandidateRow =>
  ({
    key: id,
    group: "ready",
    presence: "known",
    project: { id, name: id, status: "ACTIVE", ...(hq === undefined ? {} : { hq }) },
  }) as CandidateRow;

const ids = (rows: ReadonlyArray<CandidateRow>) => rows.map((candidate) => candidate.project.id);

describe("menuRows", () => {
  it.each<{
    readonly name: string;
    readonly placed: ReadonlyArray<CandidateRow>;
    readonly candidates: ReadonlyArray<CandidateRow>;
    readonly gone?: ReadonlyArray<string>;
    readonly expected: ReadonlyArray<string>;
  }>([
    {
      name: "HQ's rows first, then a project only Zerops lists, ungrouped, without waiting on HQ",
      placed: [row("ada", { appId: "shop" })],
      candidates: [row("ada"), row("bea")],
      expected: ["ada", "bea"],
    },
    {
      name: "before HQ answers, the listing's own rows",
      placed: [],
      candidates: [row("ada"), row("bea")],
      expected: ["ada", "bea"],
    },
    {
      name: "a project HQ places is drawn once, as HQ places it",
      placed: [row("ada", { appId: "shop" })],
      candidates: [row("ada")],
      expected: ["ada"],
    },
    {
      name: "a project proven deleted is drawn no more, placed or not",
      placed: [],
      candidates: [row("ada"), row("bea")],
      gone: ["bea"],
      expected: ["ada"],
    },
  ])("$name", ({ placed, candidates, gone = [], expected }) => {
    const rows = menuRows({ placed, candidates, gone: new Set(gone) });
    expect(ids(rows)).toEqual(expected);
    expect(rows[0]).toBe(placed[0] ?? candidates[0]);
  });
});
