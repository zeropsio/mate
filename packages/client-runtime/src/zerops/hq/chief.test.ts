import { describe, expect, it } from "@effect/vitest";

import { makeHqApi, type OpenHqSocket } from "./client.ts";
import { PROPOSAL_IDS_PER_READ } from "./chief.ts";

const NO_SOCKET: OpenHqSocket = () => {
  throw new Error("no socket in this test");
};

const ADDRESS = "https://hq-30db-8080.prg1.zerops.app";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly ids: string | null;
  readonly body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An HQ whose door admits anybody, answering each Chief call with `answer`. */
function hqAnswering(answer: (seen: Seen) => Response) {
  const seen: Seen[] = [];
  const fetch = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/api/door")
      return json(200, { session: "s1", expiresAt: "2026-10-12T20:00:00.000Z" });
    const request: Seen = {
      method: init?.method ?? "GET",
      path: url.pathname,
      ids: url.searchParams.get("ids"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    seen.push(request);
    return answer(request);
  };
  const api = makeHqApi({
    address: ADDRESS,
    fetch,
    accessToken: async () => "access",
    orgId: "org-1",
    openSocket: NO_SOCKET,
  });
  return { api, seen };
}

const DECISION = {
  id: "p1",
  projectId: "chief-project",
  decision: "approved",
  outcome: null,
  words: null,
  by: "u1",
  at: "2026-10-12T10:00:00.000Z",
} as const;

describe("the Chief at HQ", () => {
  it("marks a project as the organisation's Chief and answers the mark HQ holds", async () => {
    const answer = { chief: { projectId: "p-chief", since: "2026-10-12T10:00:00.000Z" } };
    const { api, seen } = hqAnswering(() => json(200, answer));
    await expect(api.setChief("p-chief")).resolves.toEqual(answer);
    expect(seen).toEqual([
      { method: "PUT", path: "/api/chief", ids: null, body: { projectId: "p-chief" } },
    ]);
  });

  it.each([
    [403, "forbidden"],
    [409, "conflict"],
  ])("says HQ refused a Chief (%i)", async (status, code) => {
    const { api } = hqAnswering(() => json(status, { code }));
    await expect(api.setChief("p-chief")).rejects.toMatchObject({ kind: "refused", status });
  });

  it("refuses an answer without the mark rather than report a Chief HQ did not set", async () => {
    const { api } = hqAnswering(() => json(200, {}));
    await expect(api.setChief("p-chief")).rejects.toMatchObject({ code: "unreadable" });
  });
});

describe("decisions on proposals at HQ", () => {
  it("reads every card's decision in one call", async () => {
    const { api, seen } = hqAnswering(() => json(200, { decisions: [DECISION] }));
    await expect(api.proposalDecisions(["p1", "p2", "p1"])).resolves.toEqual([DECISION]);
    expect(seen).toEqual([
      { method: "GET", path: "/api/proposals", ids: "p1,p2", body: undefined },
    ]);
  });

  it("reads more cards than HQ takes at once in as few calls as it takes", async () => {
    const ids = Array.from({ length: PROPOSAL_IDS_PER_READ + 1 }, (_, index) => `p${index}`);
    const { api, seen } = hqAnswering(() => json(200, { decisions: [] }));
    await api.proposalDecisions(ids);
    expect(seen.map((each) => each.ids?.split(",").length)).toEqual([PROPOSAL_IDS_PER_READ, 1]);
  });

  it("writes a decision under the project of the conversation its card is in", async () => {
    const stored = { ...DECISION, outcome: "failed", words: "Zerops said no." };
    const { api, seen } = hqAnswering(() => json(200, stored));
    const write = {
      projectId: "chief-project",
      decision: "approved",
      outcome: "failed",
      words: "Zerops said no.",
    } as const;
    await expect(api.decideProposal("p/1", write)).resolves.toEqual(stored);
    expect(seen).toEqual([{ method: "PUT", path: "/api/proposals/p%2F1", ids: null, body: write }]);
  });

  it("says a decision HQ already holds otherwise is refused", async () => {
    const { api } = hqAnswering(() => json(409, { code: "conflict" }));
    await expect(
      api.decideProposal("p1", { projectId: "x", decision: "declined" }),
    ).rejects.toMatchObject({ kind: "refused", status: 409 });
  });
});
