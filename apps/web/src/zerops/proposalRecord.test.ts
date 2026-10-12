import type {
  HqProposalDecision,
  HqProposalDecisionWrite,
} from "@t3tools/client-runtime/zerops/hq";
import { describe, expect, it } from "vite-plus/test";

import { makeProposalRecord } from "./proposalRecord";

const AT = "2026-10-12T10:00:00.000Z";

const stored = (id: string, write: HqProposalDecisionWrite): HqProposalDecision => ({
  id,
  projectId: write.projectId,
  decision: write.decision,
  outcome: write.outcome ?? null,
  words: write.words ?? null,
  by: "u1",
  at: AT,
});

/** HQ as the record reaches it: what it holds, every read and write it was asked, and its refusals. */
function fakeHq(held: Record<string, HqProposalDecision> = {}) {
  const reads: string[][] = [];
  const writes: Array<[string, HqProposalDecisionWrite]> = [];
  let refuse: { readonly status: number } | null = null;
  const api = {
    proposalDecisions: async (ids: ReadonlyArray<string>) => {
      reads.push([...ids]);
      return ids.flatMap((id) => (held[id] === undefined ? [] : [held[id]]));
    },
    decideProposal: async (id: string, write: HqProposalDecisionWrite) => {
      writes.push([id, write]);
      if (refuse !== null) throw Object.assign(new Error("refused"), refuse);
      held[id] = stored(id, write);
      return held[id];
    },
  };
  return {
    api,
    reads,
    writes,
    refuseWith: (status: number | null) => {
      refuse = status === null ? null : { status };
    },
  };
}

describe("the decisions HQ keeps, as a tab holds them", () => {
  it("reads every card of a conversation in one call, and none twice", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    const first = record.read(hq.api, ["a", "b"]);
    const second = record.read(hq.api, ["b", "c"]);
    await Promise.all([first, second]);
    await record.read(hq.api, ["a", "c"]);
    expect(hq.reads).toEqual([["a", "b", "c"]]);
  });

  it("offers no Approve on a card until HQ answered what was decided of it", async () => {
    const hq = fakeHq({ a: stored("a", { projectId: "p", decision: "declined" }) });
    const record = makeProposalRecord();
    expect(record.entry("a")).toEqual({ decision: undefined, known: false, runningHere: false });
    await record.read(hq.api, ["a"]);
    expect(record.entry("a")).toEqual({
      decision: { state: "declined", at: AT },
      known: true,
      runningHere: false,
    });
  });

  it("draws a decision at once and writes it under the conversation's project", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    const writing = record.record(hq.api, "a", "p-chief", { state: "running", at: AT });
    expect(record.entry("a")).toMatchObject({ decision: { state: "running" }, runningHere: true });
    await expect(writing).resolves.toBeNull();
    expect(hq.writes).toEqual([["a", { projectId: "p-chief", decision: "approved" }]]);
  });

  it("takes back a decision HQ did not keep, so nothing runs", async () => {
    const hq = fakeHq();
    hq.refuseWith(503);
    const record = makeProposalRecord();
    await expect(record.record(hq.api, "a", "p", { state: "running", at: AT })).resolves.toMatch(
      /nothing ran/u,
    );
    expect(record.entry("a")).toMatchObject({ decision: undefined, runningHere: false });
  });

  it("draws what HQ holds where it was decided elsewhere first", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    hq.refuseWith(409);
    const held = stored("a", { projectId: "p", decision: "declined" });
    hq.api.proposalDecisions = async (ids) => {
      hq.reads.push([...ids]);
      return [held];
    };
    await expect(record.record(hq.api, "a", "p", { state: "running", at: AT })).resolves.toBe(
      "It was decided elsewhere.",
    );
    expect(record.entry("a").decision).toEqual({ state: "declined", at: AT });
  });

  it("keeps an approval's end drawn where HQ did not take it", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    await record.record(hq.api, "a", "p", { state: "running", at: AT });
    hq.refuseWith(503);
    await record.record(hq.api, "a", "p", { state: "done", at: AT });
    expect(record.entry("a").decision).toEqual({ state: "done", at: AT });
  });

  it("an answer read before this tab's own approval landed takes nothing back", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    let answer: (records: HqProposalDecision[]) => void = () => undefined;
    hq.api.proposalDecisions = () =>
      new Promise<HqProposalDecision[]>((resolve) => {
        answer = resolve;
      });
    const reading = record.read(hq.api, ["a"]);
    await Promise.resolve();
    await record.record(hq.api, "a", "p", { state: "running", at: AT });
    answer([]);
    await reading;
    expect(record.entry("a").decision).toEqual({ state: "running", at: AT });
  });

  it("never records a second decision of one proposal", async () => {
    const hq = fakeHq();
    const record = makeProposalRecord();
    await record.record(hq.api, "a", "p", { state: "declined", at: AT });
    await expect(record.record(hq.api, "a", "p", { state: "running", at: AT })).resolves.toBe(
      "It was decided elsewhere.",
    );
    expect(hq.writes).toHaveLength(1);
  });
});
