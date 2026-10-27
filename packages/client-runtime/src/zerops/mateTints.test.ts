import { MATE_SHAPE_OF_TINT, MATE_TINT_IDS } from "@t3tools/shared/brand";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCandidate } from "./candidates.ts";
import { changedMateFace, readZeropsMembership } from "./groups.ts";
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

/**
 * A Mate's project named `name` in Zerops — its name (D3) — and its record in HQ, its face, in the
 * application it is placed in.
 */
function recorded(name: string, face = ""): Pick<ZeropsCandidate["project"], "name" | "hq"> {
  return { name, hq: { appId: "app-acme", appName: "Acme", kind: "mate", mate: { face } } };
}

describe("assignCandidateMateTints", () => {
  function candidate(
    id: string,
    over: Partial<ZeropsCandidate["project"]> = {},
    withMate = true,
  ): ZeropsCandidate {
    const base = { key: `${id}:zcp`, project: { id, name: id, status: "ACTIVE", ...over } };
    return withMate
      ? { ...base, group: "ready", service: { id: "zcp", name: "zcp", status: "ACTIVE" } }
      : { ...base, group: "unavailable", reason: "no container", missingContainer: true };
  }

  it("keys tints by project and names a Mate the way the menu does", () => {
    const tints = assignCandidateMateTints([
      candidate("crm-dev", recorded("Ada")),
      candidate("crm-stage"),
      candidate(
        "crm-prod",
        { hq: { appId: "app-acme", appName: "Acme", kind: "production", mate: null } },
        false,
      ),
    ]);
    expect([...tints.keys()].sort()).toEqual(["crm-dev", "crm-stage"]);
    expect(tints.get("crm-dev")).toBe(assignMateTints(["Ada", "crm-stage"]).get("Ada"));
  });

  it("deals a Mate named in full under its application the tint its own name gives", () => {
    const tints = assignCandidateMateTints([candidate("crm-dev", recorded("Acme - Ada"))]);
    expect(tints.get("crm-dev")).toBe(newMateTint([], "Ada"));
  });

  it("gives a project with two containers one tint", () => {
    const tints = assignCandidateMateTints([
      candidate("crm-dev", recorded("Ada")),
      { ...candidate("crm-dev", recorded("Ada")), key: "crm-dev:zcp2" },
    ]);
    expect(tints.size).toBe(1);
  });
});

describe("a Mate's own face", () => {
  /** A Mate on the account, with its record in HQ where it has one. */
  function mate(
    id: string,
    record?: Pick<ZeropsCandidate["project"], "name" | "hq">,
  ): ZeropsCandidate {
    return {
      key: `${id}:zcp`,
      group: "ready",
      project: { id, name: id, status: "ACTIVE", tagList: ["mate"], ...record },
      service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    };
  }

  /**
   * A Mate nobody picked a face for wears the one it wore before faces could
   * be picked: these are the tints this account's names were given then.
   */
  it("leaves an account where nobody picked a face exactly as it was", () => {
    const tints = assignCandidateMateTints([
      mate("p-ada", recorded("Ada")),
      mate("p-fen", recorded("Fen")),
      mate("p-nova", recorded("Nova")),
      mate("p-otto", recorded("Otto")),
      mate("p-juno", recorded("Juno")),
      mate("crm-stage"),
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
      case: "a picked tint is the Mate's, and a Mate whose name gives it that tint keeps it",
      mates: [mate("p-ada", recorded("Ada")), mate("p-otto", recorded("Otto", "sky:gem"))],
      tints: { "p-ada": "sky", "p-otto": "sky" },
    },
    {
      case: "two Mates may pick one tint",
      mates: [
        mate("p-ada", recorded("Ada", "coral:gem")),
        mate("p-fen", recorded("Fen", "coral:seal")),
      ],
      tints: { "p-ada": "coral", "p-fen": "coral" },
    },
    {
      case: "a face whose tint this client does not know is derived from the name",
      mates: [mate("p-ada", recorded("Ada", "teal:gem"))],
      tints: { "p-ada": "sky" },
    },
    {
      case: "past eight picked tints the rest take their own again",
      mates: [
        ...MATE_TINT_IDS.map((tint) => mate(`p-${tint}`, recorded(tint, `${tint}:gem`))),
        mate("p-ada", recorded("Ada")),
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
      mates: [mate("p-milo", recorded("Milo"))],
      name: "Cleo",
      tint: "slate",
    },
    {
      case: "its own tint again once all eight are worn",
      mates: MATE_TINT_IDS.map((tint) => mate(`p-${tint}`, recorded(`p-${tint}`, `${tint}:gem`))),
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
    const milo = mate("p-milo", recorded("Milo"));
    expect(assignCandidateMateTints([milo]).get("p-milo")).toBe("sand");
    expect(preferredMateTint("Cleo")).toBe("sand");
    const tint = newMateTint([milo], "Cleo");
    const cleo = mate("p-cleo", recorded("Cleo", `${tint}:${MATE_SHAPE_OF_TINT[tint]}`));
    expect(Object.fromEntries(assignCandidateMateTints([milo, cleo]))).toEqual({
      "p-milo": "sand",
      "p-cleo": tint,
    });
  });

  /**
   * A person may pick the tint a Mate already wears by its name. That Mate —
   * and every Mate its tint would have pushed along — keeps its colour: the
   * new one only joins it.
   */
  it("recolours nobody when a new Mate picks a tint another Mate wears", () => {
    const account = [
      mate("p-ada", recorded("Ada")),
      mate("p-fen", recorded("Fen")),
      mate("p-nova", recorded("Nova")),
      mate("p-otto", recorded("Otto")),
      mate("p-juno", recorded("Juno")),
      mate("crm-stage"),
    ];
    const before = Object.fromEntries(assignCandidateMateTints(account));
    const worn = before["crm-stage"]!;
    const quinn = mate("p-quinn", recorded("Quinn", `${worn}:gem`));
    expect(Object.fromEntries(assignCandidateMateTints([...account, quinn]))).toEqual({
      ...before,
      "p-quinn": worn,
    });
  });

  /** The face HQ records for `candidate` once `face` is saved over the one it wears. */
  function changed(candidate: ZeropsCandidate, face: Parameters<typeof changedMateFace>[1]) {
    const worn = readZeropsMembership(candidate.project).face;
    return mate(
      candidate.project.id,
      recorded(candidate.project.name, changedMateFace(worn, face)),
    );
  }

  /**
   * A face changed after its birth. Ada wore her name's sky, and Otto, whose
   * name asks for sky too, walked on to violet: were Ada's name to leave the
   * sharing when she picked, Otto would take sky back. Every Mate HQ records
   * here, its face changed in turn, leaves every other Mate as it was.
   */
  it.each(["p-ada", "p-fen", "p-nova", "p-otto", "p-juno"])(
    "recolours nobody when %s's face is changed",
    (id) => {
      const account = [
        mate("p-ada", recorded("Ada")),
        mate("p-fen", recorded("Fen")),
        mate("p-nova", recorded("Nova")),
        mate("p-otto", recorded("Otto")),
        mate("p-juno", recorded("Juno")),
        mate("crm-stage"),
      ];
      const before = Object.fromEntries(assignCandidateMateTints(account));
      const after = account.map((entry) =>
        entry.project.id === id ? changed(entry, { tint: "rose", shape: "clover" }) : entry,
      );
      expect(Object.fromEntries(assignCandidateMateTints(after))).toEqual({
        ...before,
        [id]: "rose",
      });
    },
  );

  it("recolours nobody when a Mate whose face was picked at its birth changes it", () => {
    const account = [
      mate("p-ada", recorded("Ada")),
      mate("p-otto", recorded("Otto")),
      mate("p-quinn", recorded("Quinn", "olive:gem")),
    ];
    const before = Object.fromEntries(assignCandidateMateTints(account));
    const quinn = changed(account[2]!, { tint: "sky", shape: "seal" });
    expect(Object.fromEntries(assignCandidateMateTints([account[0]!, account[1]!, quinn]))).toEqual(
      { ...before, "p-quinn": "sky" },
    );
  });

  it.each([
    { case: "the one it picked", face: "coral:seal", tint: "coral", shape: "seal" },
    {
      case: "its tint's own when it picked none",
      face: undefined,
      tint: "coral",
      shape: "pentagon",
    },
    {
      case: "its tint's own when this client does not know the one it picked",
      face: "coral:blob",
      tint: "sky",
      shape: "pick",
    },
    {
      case: "the one it picked, whatever tint it ends up wearing",
      face: "teal:gem",
      tint: "rose",
      shape: "gem",
    },
  ] as const)("shapes a Mate as $case", ({ face, tint, shape }) => {
    const project = face === undefined ? {} : recorded("Ada", face);
    expect(mateShapeOf(project, tint)).toBe(shape);
  });
});
