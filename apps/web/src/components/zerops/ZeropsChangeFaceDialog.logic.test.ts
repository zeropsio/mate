import {
  assignCandidateMateTints,
  changedMateFace,
  readZeropsMembership,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { resolveMateVerbs } from "@t3tools/client-runtime/zerops/mateAccess";
import { describe, expect, it } from "vite-plus/test";

import {
  CHANGE_FACE_VERB,
  changeFaceOffered,
  changeFaceWords,
  mateFaceOf,
  sameFace,
} from "./ZeropsChangeFaceDialog.logic";

const ORG = "org-acme";

/** Where HQ places a project of Acme Docs, as `kind`; a Mate by its name and face. */
function inAcme(kind: HqPlacement["kind"], mate?: { name: string; face?: string }): HqPlacement {
  return {
    appId: "acme",
    appName: "Acme Docs",
    kind,
    mate: mate === undefined ? null : { name: mate.name, face: mate.face ?? "" },
  };
}

function project(
  id: string,
  tagList: ReadonlyArray<string>,
  hq: HqPlacement,
  userRoles?: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>,
): ZeropsCandidate["project"] {
  return {
    id,
    name: `Acme Docs - ${id}`,
    status: "ACTIVE",
    clientId: ORG,
    tagList,
    hq,
    ...(userRoles === undefined ? {} : { userRoles }),
  };
}

/** A Mate of Acme Docs, named and faced as HQ records it. */
function mate(id: string, name: string, face?: string): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    group: "ready",
    project: project(id, ["mate"], inAcme("mate", face === undefined ? { name } : { name, face })),
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  };
}

describe("changeFaceWords — what the dialog says", () => {
  it("asks about the Mate by its name, and says the face is for everyone", () => {
    expect(changeFaceWords("Fen")).toEqual({
      title: "Change Fen's face",
      description: "Everyone sees Fen with this face.",
      submit: "Save",
      pending: "Saving…",
    });
  });

  it("names the verb in a menu by the dialog it opens", () => {
    expect(CHANGE_FACE_VERB).toBe("Change face…");
  });
});

/**
 * Changing a face is a write to HQ's record of the Mate, as a rename is, so it is offered exactly
 * where Rename is: effective OWNER or ADMIN on the project (`resolveMateVerbs`), and only on a
 * Mate.
 */
describe("changeFaceOffered — where a Mate's menus offer Change face…", () => {
  const viewer = (roleCode: string) => ({ id: ORG, membershipId: "member-ada", roleCode });

  it.each([
    { who: "an org owner", role: "OWNER", override: undefined, offered: true },
    { who: "an org admin", role: "ADMIN", override: undefined, offered: true },
    {
      who: "a member, on the Mate they made",
      role: "BASIC_USER",
      override: "OWNER",
      offered: true,
    },
    {
      who: "a member, on a colleague's Mate",
      role: "BASIC_USER",
      override: undefined,
      offered: false,
    },
    { who: "a read-only member", role: "READ_ONLY", override: undefined, offered: false },
    {
      who: "an owner lowered on this project",
      role: "OWNER",
      override: "READ_ONLY",
      offered: false,
    },
  ])("$who: $offered, as Rename is", ({ role, override, offered }) => {
    const candidate: ZeropsCandidate = {
      ...mate("fen", "Fen"),
      project: project(
        "fen",
        ["mate"],
        inAcme("mate", { name: "Fen" }),
        override === undefined ? undefined : [{ clientUserId: "member-ada", roleCode: override }],
      ),
    };
    const verbs = resolveMateVerbs({ project: candidate.project, viewer: viewer(role) });
    expect(changeFaceOffered({ candidate, mayRename: verbs.rename })).toBe(offered);
    expect(verbs.rename).toBe(offered);
  });

  it("is never offered where no Mate lives: a stage has no face to change", () => {
    const stage: ZeropsCandidate = {
      key: "stage:app",
      group: "unavailable",
      reason: "no container",
      missingContainer: true,
      project: project("stage", [], inAcme("stage")),
    };
    expect(changeFaceOffered({ candidate: stage, mayRename: true })).toBe(false);
  });
});

describe("mateFaceOf — the face a Mate wears now, as every surface draws it", () => {
  const account = [
    mate("p-ada", "Ada"),
    mate("p-otto", "Otto"),
    mate("p-quinn", "Quinn", "coral:seal"),
  ];
  const tints = assignCandidateMateTints(account);

  it.each([
    {
      who: "a Mate wearing its name's tint and that tint's shape",
      id: "p-ada",
      face: { tint: "sky", shape: "pick" },
    },
    {
      who: "a Mate its name walked on to the next tint",
      id: "p-otto",
      face: { tint: "violet", shape: "gem" },
    },
    { who: "a Mate whose face was picked", id: "p-quinn", face: { tint: "coral", shape: "seal" } },
  ])("$who", ({ id, face }) => {
    const candidate = account.find((entry) => entry.project.id === id)!;
    expect(mateFaceOf(tints, candidate.project)).toEqual(face);
  });

  it("is the face the dialog saved, once HQ's structure carries it", () => {
    const saved = { tint: "rose", shape: "gem" } as const;
    const after = account.map((entry) =>
      entry.project.id === "p-ada"
        ? mate("p-ada", "Ada", changedMateFace(readZeropsMembership(entry.project).face, saved))
        : entry,
    );
    const ada = after[0]!;
    expect(readZeropsMembership(ada.project).face).toMatchObject(saved);
    expect(mateFaceOf(assignCandidateMateTints(after), ada.project)).toEqual(saved);
  });
});

describe("sameFace", () => {
  it.each([
    { a: { tint: "sky", shape: "gem" }, b: { tint: "sky", shape: "gem" }, same: true },
    { a: { tint: "sky", shape: "gem" }, b: { tint: "rose", shape: "gem" }, same: false },
    { a: { tint: "sky", shape: "gem" }, b: { tint: "sky", shape: "seal" }, same: false },
  ] as const)("$a / $b → $same", ({ a, b, same }) => {
    expect(sameFace(a, b)).toBe(same);
  });
});
