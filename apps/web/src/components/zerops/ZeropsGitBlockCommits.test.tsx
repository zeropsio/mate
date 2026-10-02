/**
 * The commits under a Git tab block: the Mate's change's own, as HQ's detail of it reads them —
 * the same read its review makes — and nothing drawn while there is nothing to say.
 */
import type { ChangeReadout } from "@t3tools/client-runtime/zerops";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ReadoutPart, ZeropsChangeDetailRequest } from "~/zerops/useZeropsChangeDetail";

import { ZeropsGitBlockCommits } from "./ZeropsGitBlockCommits";

const NOW = Date.parse("2026-10-02T12:00:00Z");

/** What the detail answers, and what it was last asked for. */
const detail = vi.hoisted(() => ({
  readout: { kind: "reading" } as unknown,
  asked: [] as Array<unknown>,
}));
vi.mock("~/zerops/useZeropsChangeDetail", () => ({
  useZeropsChangeDetail: (request: ZeropsChangeDetailRequest | null) => {
    detail.asked.push(request);
    return { readout: request === null ? { kind: "none" } : detail.readout, retry: () => {} };
  },
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => NOW }));

const read = (commits: ChangeReadout["commits"]): ReadoutPart<ChangeReadout> => ({
  kind: "read",
  value: { commits } as ChangeReadout,
});

const html = (change: { readonly number: number; readonly head: string } | undefined) =>
  renderToStaticMarkup(
    <ZeropsGitBlockCommits appId="g1" change={change} main="m1" repository="api" />,
  );

afterEach(() => {
  detail.readout = { kind: "reading" };
  detail.asked = [];
});

describe("ZeropsGitBlockCommits", () => {
  it("draws the commits of the Mate's change, as HQ's detail reads them", () => {
    detail.readout = read([
      { sha: "a".repeat(40), subject: "Answer /status", at: "2026-10-02T11:00:00Z" },
    ]);
    const markup = html({ number: 12, head: "c".repeat(40) });
    expect(markup).toContain("Commits · 1");
    expect(markup).toContain("aaaaaaa");
    expect(markup).toContain("Answer /status");
    expect(detail.asked).toEqual([
      { link: { appId: "g1", repo: "api", number: 12 }, head: "c".repeat(40), main: "m1" },
    ]);
  });

  it.each([
    ["while they are read", { kind: "reading" }],
    ["where they could not be read", { kind: "failed", reason: "HQ is not answering right now." }],
    ["where there are none", read([])],
  ])("draws nothing %s", (_name, readout) => {
    detail.readout = readout;
    expect(html({ number: 12, head: "c".repeat(40) })).toBe("");
  });

  it("asks for nothing where the Mate has no change in the repository", () => {
    expect(html(undefined)).toBe("");
    expect(detail.asked).toEqual([null]);
  });
});
