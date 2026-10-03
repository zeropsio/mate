import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import {
  deleteMateConfirmed,
  deleteMateOffered,
  deleteMateServiceCount,
  deleteMateVerb,
  deleteMateWords,
  landingAfterDelete,
} from "./ZeropsDeleteMateDialog.logic";

const WORDS = { name: "Quinn", environment: "Acme Docs - Quinn", owner: undefined };

describe("deleteMateWords — what the dialog says", () => {
  it("asks about the Mate by its name, and names what the field and the button do", () => {
    const words = deleteMateWords({ ...WORDS, services: 3 });
    expect(words.title).toBe("Delete Quinn?");
    expect(words.label).toBe("Type Quinn to confirm");
    expect(words.submit).toBe("Delete Quinn");
    expect(words.pending).toBe("Deleting…");
  });

  it.each([
    {
      case: "three services",
      services: 3,
      body: "The environment Acme Docs - Quinn goes from Zerops with its 3 services and everything in them, and Quinn's conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.",
    },
    {
      case: "one service",
      services: 1,
      body: "The environment Acme Docs - Quinn goes from Zerops with its 1 service and everything in it, and Quinn's conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.",
    },
    {
      case: "no service at all",
      services: 0,
      body: "The environment Acme Docs - Quinn goes from Zerops with everything in it, and Quinn's conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.",
    },
    {
      case: "services not read yet: no count it cannot back",
      services: undefined,
      body: "The environment Acme Docs - Quinn goes from Zerops with its services and everything in them, and Quinn's conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.",
    },
  ])("counts what goes with it: $case", ({ services, body }) => {
    expect(deleteMateWords({ ...WORDS, services }).body).toBe(body);
  });

  it("says whose it is first when it is a colleague's Mate, in the words the menu uses", () => {
    expect(deleteMateWords({ ...WORDS, services: 2, owner: "Ada" }).body).toBe(
      "Quinn is Ada's Mate. The environment Acme Docs - Quinn goes from Zerops with its 2 services and everything in them, and Quinn's conversations go with it. Anything Quinn hasn't pushed is lost. This can't be undone.",
    );
  });

  it("names the verb in a menu with the Mate's name and the dialog it opens", () => {
    expect(deleteMateVerb("Quinn")).toBe("Delete Quinn…");
  });
});

// e2e 2026-10-03: Cyd's project held zcp, appdev and appstage, and its dialog said "its 2 services":
// the Mate's own container goes from Zerops too.
describe("deleteMateServiceCount — every service the deletion takes", () => {
  const CONTAINER = { id: "zcp-1", name: "zcp", status: "ACTIVE" };
  it.each([
    {
      case: "the developer's services and the Mate's container",
      over: { service: CONTAINER, services: { hostnames: ["appdev", "appstage"] } },
      count: 3,
    },
    {
      case: "the Mate's container alone",
      over: { service: CONTAINER, services: { hostnames: [] } },
      count: 1,
    },
    {
      case: "no container came",
      over: { services: { hostnames: ["appdev"] } },
      count: 1,
    },
    { case: "services not read yet", over: { service: CONTAINER }, count: undefined },
  ])("$case → $count", ({ over, count }) => {
    expect(deleteMateServiceCount(over)).toBe(count);
  });
});

describe("deleteMateConfirmed — the name, typed", () => {
  it.each([
    { typed: "Quinn", confirmed: true },
    { typed: "  Quinn ", confirmed: true },
    { typed: "quinn", confirmed: false },
    { typed: "QUINN", confirmed: false },
    { typed: "Quin", confirmed: false },
    { typed: "Quinn.", confirmed: false },
    { typed: "", confirmed: false },
    { typed: "   ", confirmed: false },
  ])("'$typed' → $confirmed", ({ typed, confirmed }) => {
    expect(deleteMateConfirmed(typed, "Quinn")).toBe(confirmed);
  });

  it("asks for a name with a space in it as it is spelled", () => {
    expect(deleteMateConfirmed("Mary Jane", "Mary Jane")).toBe(true);
    expect(deleteMateConfirmed("Mary  Jane", "Mary Jane")).toBe(false);
  });
});

/** Where HQ places a project of Acme Docs, as `kind`; a Mate by its name. */
function inAcme(kind: HqPlacement["kind"], mate: string | null = null): HqPlacement {
  return {
    appId: "acme",
    appName: "Acme Docs",
    kind,
    mate: mate === null ? null : { name: mate, face: "" },
  };
}

function candidate(
  tagList: ReadonlyArray<string>,
  hq: HqPlacement | undefined,
  over: Partial<ZeropsCandidate> & { readonly status?: string } = {},
): ZeropsCandidate {
  const { status = "ACTIVE", ...rest } = over;
  return {
    key: "acme-docs-quinn:zcp",
    group: "ready",
    project: {
      id: "acme-docs-quinn",
      name: "Acme Docs - Quinn",
      status,
      tagList,
      ...(hq === undefined ? {} : { hq }),
    },
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    ...rest,
  };
}

const MATE = ["mate"];
const QUINN = inAcme("mate", "Quinn");

describe("deleteMateOffered — where a Mate's menu offers Delete", () => {
  it.each([
    {
      case: "a Mate the viewer may delete",
      item: candidate(MATE, QUINN),
      may: true,
      offered: true,
    },
    {
      case: "a Mate the viewer may not delete",
      item: candidate(MATE, QUINN),
      may: false,
      offered: false,
    },
    {
      case: "production, whoever looks",
      item: candidate([], inAcme("production")),
      may: true,
      offered: false,
    },
    {
      case: "a stage",
      item: candidate([], inAcme("stage")),
      may: true,
      offered: false,
    },
    {
      case: "the account's Gitea project",
      item: candidate(["mate:tool:gitea"], undefined),
      may: true,
      offered: false,
    },
    {
      case: "a creation the platform failed: its row's Remove does it",
      item: candidate(MATE, QUINN, {
        group: "unavailable",
        creationFailed: { message: undefined },
      }),
      may: true,
      offered: false,
    },
    {
      case: "a Mate the platform is deleting already",
      item: candidate(MATE, QUINN, { status: "DELETING", group: "unavailable" }),
      may: true,
      offered: false,
    },
  ])("$case → $offered", ({ item, may, offered }) => {
    expect(deleteMateOffered({ candidate: item, mayDelete: may, deleting: false })).toBe(offered);
  });

  it("is not offered again while this tab waits for the platform to let it go", () => {
    expect(
      deleteMateOffered({ candidate: candidate(MATE, QUINN), mayDelete: true, deleting: true }),
    ).toBe(false);
  });
});

describe("landingAfterDelete — where the viewer stands once it is gone", () => {
  const mate = (projectId: string, opens = true) => ({ projectId, opens });
  const group = [mate("fen"), mate("quinn"), mate("ada")];

  it.each([
    {
      case: "in another Mate's conversation: stays",
      viewing: "fen",
      siblings: group,
      landing: { kind: "stay" },
    },
    {
      case: "on no Mate's conversation: stays",
      viewing: undefined,
      siblings: group,
      landing: { kind: "stay" },
    },
    {
      case: "in its conversation: the next Mate of its project",
      viewing: "quinn",
      siblings: group,
      landing: { kind: "mate", projectId: "ada" },
    },
    {
      case: "the last of its project: the one before it",
      viewing: "quinn",
      siblings: [mate("fen"), mate("ada"), mate("quinn")],
      landing: { kind: "mate", projectId: "ada" },
    },
    {
      case: "the next one a colleague's the viewer cannot open: the one after it",
      viewing: "quinn",
      siblings: [mate("quinn"), mate("ada", false), mate("fen")],
      landing: { kind: "mate", projectId: "fen" },
    },
    {
      case: "the only Mate the viewer opens there: the projects",
      viewing: "quinn",
      siblings: [mate("ada", false), mate("quinn")],
      landing: { kind: "projects" },
    },
    {
      case: "the project's only Mate: the projects",
      viewing: "quinn",
      siblings: [mate("quinn")],
      landing: { kind: "projects" },
    },
    {
      case: "in no project: the projects",
      viewing: "quinn",
      siblings: [],
      landing: { kind: "projects" },
    },
  ])("$case", ({ viewing, siblings, landing }) => {
    expect(landingAfterDelete({ deleted: "quinn", viewing, siblings })).toEqual(landing);
  });
});
