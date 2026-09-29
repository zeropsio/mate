import { MATE_SHAPE_OF_TINT, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import {
  assignCandidateMateTints,
  assignMateTints,
  mateShapeOf,
  newMateTint,
  preferredMateTint,
} from "./mateTints.ts";

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

describe("a Mate's own face", () => {
  function mate(id: string, tagList: ReadonlyArray<string>): ZeropsCandidate {
    return {
      key: `${id}:zcp`,
      group: "ready",
      project: { id, name: id, status: "ACTIVE", tagList },
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    };
  }

  /**
   * A Mate nobody picked a face for wears the one it wore before faces could
   * be picked: these are the tints this account's names were given then.
   */
  it("leaves an account where nobody picked a face exactly as it was", () => {
    const tints = assignCandidateMateTints([
      mate("p-ada", ["mate:bot:Ada"]),
      mate("p-fen", ["mate:bot:Fen"]),
      mate("p-nova", ["mate:bot:Nova"]),
      mate("p-otto", ["mate:bot:Otto"]),
      mate("p-juno", ["mate:bot:Juno"]),
      mate("crm-stage", []),
    ]);
    expect(Object.fromEntries(tints)).toEqual({
      "p-ada": "sky",
      "p-fen": "sand",
      "p-nova": "amber",
      "p-otto": "violet",
      "p-juno": "slate",
      "crm-stage": "coral",
    });
  });

  it.each([
    {
      case: "a picked tint is the Mate's, and a name that hashes to it walks on",
      mates: [
        mate("p-ada", ["mate:bot:Ada"]),
        mate("p-otto", ["mate:bot:Otto", "mate:face:sky:gem"]),
      ],
      tints: { "p-ada": "violet", "p-otto": "sky" },
    },
    {
      case: "two Mates may pick one tint",
      mates: [
        mate("p-ada", ["mate:bot:Ada", "mate:face:coral:gem"]),
        mate("p-fen", ["mate:bot:Fen", "mate:face:coral:seal"]),
      ],
      tints: { "p-ada": "coral", "p-fen": "coral" },
    },
    {
      case: "a face whose tint this client does not know is derived from the name",
      mates: [mate("p-ada", ["mate:bot:Ada", "mate:face:teal:gem"])],
      tints: { "p-ada": "sky" },
    },
    {
      case: "past eight picked tints the rest take their own again",
      mates: [
        ...MATE_TINT_IDS.map((tint) =>
          mate(`p-${tint}`, [`mate:bot:${tint}`, `mate:face:${tint}:gem`]),
        ),
        mate("p-ada", ["mate:bot:Ada"]),
      ],
      tints: {
        ...Object.fromEntries(MATE_TINT_IDS.map((tint) => [`p-${tint}`, tint])),
        "p-ada": "sky",
      },
    },
  ])("$case", ({ mates, tints }) => {
    expect(Object.fromEntries(assignCandidateMateTints(mates))).toEqual(tints);
  });

  it.each([
    { case: "its own tint, when nobody wears it", mates: [], name: "Quinn", tint: "olive" },
    {
      case: "the next free tint when another Mate wears its own",
      mates: [mate("p-milo", ["mate:bot:Milo"])],
      name: "Cleo",
      tint: "slate",
    },
    {
      case: "its own tint again once all eight are worn",
      mates: MATE_TINT_IDS.map((tint) => mate(`p-${tint}`, [`mate:face:${tint}:gem`])),
      name: "Quinn",
      tint: "olive",
    },
  ] as const)("proposes a new Mate $case", ({ mates, name, tint }) => {
    expect(newMateTint(mates, name)).toBe(tint);
  });

  /**
   * Cleo sorts before Milo and asks for Milo's sand: by name alone Cleo would
   * take it and Milo would change colour. Proposed a free tint and created
   * with it, Cleo leaves every Mate already on the account as it was.
   */
  it("never recolours a Mate already on the account", () => {
    const milo = mate("p-milo", ["mate:bot:Milo"]);
    expect(assignCandidateMateTints([milo]).get("p-milo")).toBe("sand");
    expect(preferredMateTint("Cleo")).toBe("sand");
    const tint = newMateTint([milo], "Cleo");
    const cleo = mate("p-cleo", ["mate:bot:Cleo", `mate:face:${tint}:${MATE_SHAPE_OF_TINT[tint]}`]);
    expect(Object.fromEntries(assignCandidateMateTints([milo, cleo]))).toEqual({
      "p-milo": "sand",
      "p-cleo": tint,
    });
  });

  it.each([
    { case: "the one it picked", tagList: ["mate:face:coral:seal"], tint: "coral", shape: "seal" },
    { case: "its tint's own when it picked none", tagList: [], tint: "coral", shape: "pentagon" },
    {
      case: "its tint's own when this client does not know the one it picked",
      tagList: ["mate:face:coral:blob"],
      tint: "sky",
      shape: "pick",
    },
    {
      case: "the one it picked, whatever tint it ends up wearing",
      tagList: ["mate:face:teal:gem"],
      tint: "rose",
      shape: "gem",
    },
  ] as const)("shapes a Mate as $case", ({ tagList, tint, shape }) => {
    expect(mateShapeOf(tagList, tint)).toBe(shape);
  });
});
