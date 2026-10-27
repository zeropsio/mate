/**
 * The commits under a Git tab block: the Mate's change's own, as HQ's detail of it reads them —
 * the same read its review makes — and nothing drawn while there is nothing to say.
 */
import type { ChangeReadout } from "@t3tools/client-runtime/zerops";
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ReadoutPart, ZeropsChangeDetailRequest } from "~/zerops/useZeropsChangeDetail";

import { ZeropsGitBlockCommits } from "./ZeropsGitBlockCommits";

const NOW = Date.parse("2026-10-02T12:00:00Z");

/** What the detail answers, and what it was last asked for. */
const detail = vi.hoisted(() => ({
  readout: { kind: "reading" } as unknown,
  asked: [] as Array<unknown>,
  fullReads: 0,
}));
vi.mock("~/zerops/useZeropsChangeDetail", () => ({
  useZeropsChangeDetail: (request: ZeropsChangeDetailRequest | null) => {
    detail.asked.push(request);
    if (request !== null) detail.fullReads += 1;
    return { readout: request === null ? { kind: "none" } : detail.readout, retry: () => {} };
  },
}));
vi.mock("~/zerops/useZeropsChangeCommits", () => ({
  useZeropsChangeCommits: (request: ZeropsChangeDetailRequest | null) => {
    detail.asked.push(request);
    return { readout: request === null ? { kind: "none" } : detail.readout, retry: () => {} };
  },
}));
vi.mock("~/zerops/useNowMs", () => ({ useNowMs: () => NOW }));

const read = (commits: ChangeReadout["commits"]): ReadoutPart<ChangeReadout> => ({
  kind: "read",
  value: { commits } as ChangeReadout,
});

const html = async (
  change: { readonly number: number; readonly head: string } | undefined,
  onOpenCommit?: ComponentProps<typeof ZeropsGitBlockCommits>["onOpenCommit"],
) => {
  const window = new Window();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ZeropsGitBlockCommits
        appId="g1"
        change={change}
        main="m1"
        repository="api"
        onOpenCommit={onOpenCommit}
      />,
    );
  });
  expect(detail.asked).toEqual([null]);
  const history = container.querySelector("button");
  if (history !== null) {
    expect(history.textContent).toBe("History");
    detail.asked = [];
    await act(async () => history.click());
  }
  const result = container.innerHTML;
  await act(async () => root.unmount());
  return result;
};

afterEach(() => {
  detail.readout = { kind: "reading" };
  detail.asked = [];
  detail.fullReads = 0;
  vi.unstubAllGlobals();
});

describe("ZeropsGitBlockCommits", () => {
  it("Showing a change's commit list does not load file patches.", async () => {
    detail.readout = read([
      { sha: "a".repeat(40), subject: "Answer /status", at: "2026-10-02T11:00:00Z" },
    ]);
    expect(await html({ number: 12, head: "c".repeat(40) })).toContain("Answer /status");
    expect(detail.fullReads).toBe(0);
  });

  it("draws the commits of the Mate's change, as HQ's detail reads them", async () => {
    detail.readout = read([
      { sha: "a".repeat(40), subject: "Answer /status", at: "2026-10-02T11:00:00Z" },
    ]);
    const markup = await html({ number: 12, head: "c".repeat(40) });
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
  ])("draws nothing %s", async (_name, readout) => {
    detail.readout = readout;
    expect(await html({ number: 12, head: "c".repeat(40) })).toBe("");
  });

  it("asks for nothing where the Mate has no change in the repository", async () => {
    expect(await html(undefined)).toBe("");
    expect(detail.asked).toEqual([null]);
  });

  it("offers each commit to open only where its changes have somewhere to open", async () => {
    detail.readout = read([
      { sha: "a".repeat(40), subject: "Answer /status", at: "2026-10-02T11:00:00Z" },
    ]);
    const change = { number: 12, head: "c".repeat(40) };
    const openable = await html(change, () => {});
    detail.asked = [];
    expect(openable).toMatch(/<button[^>]*>.*Answer \/status.*<\/button>/);
    expect(await html(change)).not.toContain("<button");
  });
});
