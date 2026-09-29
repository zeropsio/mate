import {
  assignCandidateMateTints,
  readZeropsGroupTags,
  withZeropsChangedFace,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
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

function project(
  id: string,
  tagList: ReadonlyArray<string>,
  userRoles?: ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>,
): ZeropsCandidate["project"] {
  return {
    id,
    name: `Acme Docs - ${id}`,
    status: "ACTIVE",
    clientId: ORG,
    tagList,
    ...(userRoles === undefined ? {} : { userRoles }),
  };
}

function mate(id: string, tagList: ReadonlyArray<string>): ZeropsCandidate {
  return {
    key: `${id}:zcp`,
    group: "ready",
    project: project(id, tagList),
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
 * Changing a face writes the project's tags, so it is offered exactly where Rename is: effective
 * OWNER or ADMIN on the project (`resolveMateVerbs`), and only on a Mate.
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
      ...mate("fen", ["mate", "mate:bot:Fen"]),
      project: project(
        "fen",
        ["mate", "mate:bot:Fen"],
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
      project: project("stage", ["mate:role:stage"]),
    };
    expect(changeFaceOffered({ candidate: stage, mayRename: true })).toBe(false);
  });
});

describe("mateFaceOf — the face a Mate wears now, as every surface draws it", () => {
  const account = [
    mate("p-ada", ["mate", "mate:bot:Ada"]),
    mate("p-otto", ["mate", "mate:bot:Otto"]),
    mate("p-quinn", ["mate", "mate:bot:Quinn", "mate:face:coral:seal"]),
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

  it("is the face the dialog saved, once the write has landed", () => {
    const saved = { tint: "rose", shape: "gem" } as const;
    const after = account.map((entry) =>
      entry.project.id === "p-ada"
        ? mate("p-ada", withZeropsChangedFace(entry.project.tagList, saved))
        : entry,
    );
    const ada = after[0]!;
    expect(readZeropsGroupTags(ada.project.tagList).face).toMatchObject(saved);
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
