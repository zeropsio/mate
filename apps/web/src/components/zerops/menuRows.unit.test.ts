import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";
import { expect, it } from "vite-plus/test";

import { hqOutage } from "../../zerops/hqNavigation.tsx";
import { menuRows } from "../../zerops/zeropsMenu.logic.ts";

const row = (id: string): CandidateRow => ({
  key: id,
  project: { id, name: id, status: "ACTIVE" },
  group: "connected",
  presence: "known",
});

const NOTHING: ReadonlySet<string> = new Set();
const EVERY_MATE = () => true;

// witness: apps/web/src/zerops/zeropsMenu.logic.ts | ...input.placed, → ...input.placed.filter((row) => candidates.some((listed) => listed.project.id === row.project.id)),
it("MN+1: The menu draws HQ's members at HQ's first navigation answer while the roster is still unread; breaks: the menu waits on Zerops' slowest read", () => {
  const rows = menuRows({
    state: "known",
    placed: [row("ada"), row("bea")],
    candidates: [],
    platform: NOTHING,
    listedMate: EVERY_MATE,
    gone: NOTHING,
  });
  expect(rows?.map((drawn) => drawn.project.id)).toEqual(["ada", "bea"]);
});

// witness: apps/web/src/zerops/zeropsMenu.logic.ts | return []; → return candidates;
it("MN+2: On a cold load with HQ unreachable the menu draws no project rows and says HQ is unreachable; breaks: Platform projects are drawn as if they were the person's whole menu", () => {
  const roster = [row("ada"), row("plain")];
  const rows = menuRows({
    state: "unreachable",
    placed: [],
    candidates: roster,
    platform: new Set(["plain"]),
    listedMate: EVERY_MATE,
    gone: NOTHING,
  });
  expect(rows).toEqual([]);
  const said = hqOutage(
    {
      link: { kind: "unreachable", since: null },
      refusal: null,
      retrying: true,
      capped: false,
      slow: false,
      structure: null,
    },
    "unreachable",
    "locale",
    Date.parse("2026-11-21T10:00:00.000Z"),
  );
  expect(said?.kind).toBe("unavailable");
});
