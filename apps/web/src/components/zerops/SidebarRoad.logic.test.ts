import { describe, expect, it } from "vite-plus/test";

import type { ChipState, ProductionChip } from "./SidebarProductionChip.logic";
import { projectRoad, type RoadInput } from "./SidebarRoad.logic";

const prod = (state: ChipState, facts: Partial<ProductionChip> = {}): ProductionChip => ({
  label: "prod",
  state,
  ...facts,
});
const stage = (state: ChipState, facts: Partial<ProductionChip> = {}): ProductionChip => ({
  label: "stage",
  state,
  ...facts,
});

const road = (over: Partial<RoadInput>) =>
  projectRoad({
    stage: stage("ok", { version: "main" }),
    prod: prod("ok", { version: "v2.3.1" }),
    stageNames: ["stage"],
    productionName: "prod",
    waiting: 0,
    waitingAtLeast: false,
    releaseOffered: false,
    ...over,
  });

/** The road as words: its places with their tones, the way between them and what rides on it. */
const drawn = (over: Partial<RoadInput>) => {
  const r = road(over);
  if (r === undefined) return null;
  const place = (
    p: { word: string; tone: string | undefined; none: boolean; unread: boolean } | undefined,
  ) =>
    p === undefined
      ? ""
      : `${p.word}${p.tone === undefined ? "" : `:${p.tone}`}${p.none ? ":none" : ""}${p.unread ? ":unread" : ""}`;
  const mid =
    r.mid === undefined
      ? ""
      : r.mid.kind === "releasing"
        ? `releasing ${r.mid.label ?? ""}`.trim()
        : r.mid.label;
  return [place(r.stage), r.way, mid, place(r.prod)];
};

describe("projectRoad — a project's stage ─▸ prod after its name", () => {
  it.each([
    {
      case: "all is well: grey places, a bare way",
      over: {},
      road: ["stage", "solid", "", "prod"],
    },
    {
      case: "changes wait and the release is offered: N ready, white, on the way",
      over: {
        waiting: 3,
        releaseOffered: true,
        prod: prod("waiting", { version: "v2.3.1", waiting: 3 }),
      },
      road: ["stage", "solid", "3 ready", "prod"],
    },
    {
      case: "more than HQ counts",
      over: { waiting: 10000, waitingAtLeast: true, releaseOffered: true },
      road: ["stage", "solid", "10000+ ready", "prod"],
    },
    {
      case: "changes wait and the release is not offered: N waiting, grey",
      over: { waiting: 2, prod: prod("failed", { version: "v1.8.2" }) },
      road: ["stage", "solid", "2 waiting", "prod:amber"],
    },
    {
      case: "a failed release beside a release offered: ready, prod amber (D28: the fix mends it)",
      over: { waiting: 2, releaseOffered: true, prod: prod("failed", { version: "v1.8.2" }) },
      road: ["stage", "solid", "2 ready", "prod:amber"],
    },
    {
      case: "a release on its way: blue, its version on the way",
      over: {
        waiting: 3,
        releaseOffered: true,
        prod: prod("releasing", { version: "v2.3.1", next: "v2.4.0" }),
      },
      road: ["stage", "solid", "releasing v2.4.0", "prod:blue"],
    },
    {
      case: "production deploying with no tag: the blue dot alone",
      over: { prod: prod("releasing", { version: "v2.3.1" }) },
      road: ["stage", "solid", "releasing", "prod:blue"],
    },
    {
      case: "production down: red",
      over: { prod: prod("down", { version: "v2.3.1" }) },
      road: ["stage", "solid", "", "prod:red"],
    },
    {
      case: "a stage down: red stage",
      over: { stage: stage("down") },
      road: ["stage:red", "solid", "", "prod"],
    },
    {
      case: "a stage's failed deploy: amber stage",
      over: { stage: stage("failed") },
      road: ["stage:amber", "solid", "", "prod"],
    },
    {
      case: "production stopped on purpose: dim",
      over: { prod: prod("stopped") },
      road: ["stage", "solid", "", "prod:off"],
    },
    {
      case: "nothing released yet: dim, and the release still offered",
      over: { prod: prod("empty"), waiting: 4, releaseOffered: true },
      road: ["stage", "solid", "4 ready", "prod:off"],
    },
    {
      case: "no production: a dashed way and prod dimmed",
      over: { prod: undefined, productionName: undefined, waiting: 3, releaseOffered: true },
      road: ["stage", "dashed", "", "prod:none"],
    },
    {
      case: "no stage: prod alone",
      over: { stage: undefined, stageNames: [] },
      road: ["", "none", "", "prod"],
    },
    {
      case: "unread places keep their words, and nothing rides between them",
      over: { stage: "unread" as const, prod: "unread" as const, waiting: 3, releaseOffered: true },
      road: ["stage:unread", "solid", "", "prod:unread"],
    },
    {
      case: "neither: no road",
      over: { stage: undefined, stageNames: [], prod: undefined, productionName: undefined },
      road: null,
    },
  ])("$case", ({ over, road: expected }) => {
    expect(drawn(over)).toEqual(expected);
  });

  it.each([
    {
      case: "production's tooltip names it and says its state in words",
      over: { prod: prod("ok", { version: "v2.3.1" }), productionName: "prod-eu" },
      tip: { title: "Production", lines: ["prod-eu: Running · v2.3.1"] },
    },
    {
      case: "a failed release while the old one serves",
      over: { prod: prod("failed", { version: "v1.8.2" }) },
      tip: { title: "Production", lines: ["prod: Release failed · still runs v1.8.2"] },
    },
    {
      case: "down",
      over: { prod: prod("down", { version: "v1.8.2" }) },
      tip: { title: "Production", lines: ["prod: Down"] },
    },
    {
      case: "nothing released yet",
      over: { prod: prod("empty") },
      tip: { title: "Production", lines: ["prod: Nothing released yet"] },
    },
    {
      case: "what HQ last said while it is not reachable",
      over: { prod: prod("ok", { version: "v2.3.1", lastKnown: true }) },
      tip: { title: "Production", lines: ["prod: Last known: Running · v2.3.1"] },
    },
    {
      case: "no production",
      over: { prod: undefined, productionName: undefined },
      tip: { title: "Production", lines: ["Nothing is released yet"] },
    },
  ])("$case", ({ over, tip }) => {
    expect(road(over)?.prod.tip).toEqual(tip);
  });

  it("the stages' tooltip lists each stage by name with its state", () => {
    expect(
      road({
        stageNames: ["qa", "demo"],
        stage: stage("down", {
          stages: [
            { name: "qa", state: "ok" },
            { name: "demo", state: "down" },
          ],
        }),
      })?.stage?.tip,
    ).toEqual({ title: "Stages", lines: ["qa: Running", "demo: Down"] });
  });

  it.each([
    {
      case: "ready says what goes out and what production runs",
      over: { waiting: 3, releaseOffered: true },
      tip: {
        title: "Review release",
        lines: ["3 changes on stage, not in production yet. Production runs v2.3.1."],
      },
    },
    {
      case: "waiting says the release is not offered",
      over: { waiting: 1 },
      tip: { title: "1 waiting", lines: ["The release isn't offered right now"] },
    },
  ])("$case", ({ over, tip }) => {
    expect(road(over)?.mid?.tip).toEqual(tip);
  });
});
