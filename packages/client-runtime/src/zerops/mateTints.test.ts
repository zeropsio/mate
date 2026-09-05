import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import { assignCandidateMateTints, assignMateTints, preferredMateTint } from "./mateTints.ts";

describe("assignMateTints", () => {
  it("gives every name a tint from the palette", () => {
    const tints = assignMateTints(["Fen", "Otto", "Juno", "Milo", "Dara", "Nova"]);
    expect(tints.size).toBe(6);
    for (const tint of tints.values()) expect(MATE_TINT_IDS).toContain(tint);
  });

  it("tells up to eight Mates apart", () => {
    const names = ["Ada", "Bruno", "Cleo", "Dara", "Enzo", "Fen", "Gita", "Hugo"];
    const tints = assignMateTints(names);
    expect(new Set(tints.values()).size).toBe(8);
  });

  it("does not depend on the order the names arrive in", () => {
    const forward = assignMateTints(["Fen", "Otto", "Juno", "Milo"]);
    const backward = assignMateTints(["Milo", "Juno", "Otto", "Fen"]);
    expect([...forward.entries()].sort()).toEqual([...backward.entries()].sort());
  });

  it("keeps a name's own tint when nothing clashes with it", () => {
    const alone = assignMateTints(["Fen"]).get("Fen");
    expect(alone).toBe(preferredMateTint("Fen"));
    expect(preferredMateTint("fen ")).toBe(preferredMateTint("Fen"));
  });

  it("treats one name in two cases as one Mate and skips blank names", () => {
    const tints = assignMateTints(["Fen", "fen", " ", ""]);
    expect([...tints.keys()]).toEqual(["Fen"]);
  });

  it("repeats tints past eight rather than refusing", () => {
    const names = Array.from({ length: 12 }, (_, index) => `Mate ${index}`);
    expect(assignMateTints(names).size).toBe(12);
  });
});

describe("assignCandidateMateTints", () => {
  function candidate(id: string, tagList: ReadonlyArray<string>, withMate = true): ZeropsCandidate {
    const base = { key: `${id}:zcp`, project: { id, name: id, status: "ACTIVE", tagList } };
    return withMate
      ? { ...base, group: "ready", service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
      : { ...base, group: "unavailable", reason: "no container", missingContainer: true };
  }

  it("keys tints by project and names a Mate the way the menu does", () => {
    const tints = assignCandidateMateTints([
      candidate("crm-dev", ["mate:bot:Ada"]),
      candidate("crm-stage", []),
      candidate("crm-prod", ["mate:role:prod"], false),
    ]);
    expect([...tints.keys()].sort()).toEqual(["crm-dev", "crm-stage"]);
    expect(tints.get("crm-dev")).toBe(assignMateTints(["Ada", "crm-stage"]).get("Ada"));
  });

  it("gives a project with two containers one tint", () => {
    const tints = assignCandidateMateTints([
      candidate("crm-dev", ["mate:bot:Ada"]),
      { ...candidate("crm-dev", ["mate:bot:Ada"]), key: "crm-dev:zcp2" },
    ]);
    expect(tints.size).toBe(1);
  });
});
