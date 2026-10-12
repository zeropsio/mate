/**
 * What the person decided of each proposal, as HQ keeps it (`GET` and `PUT /api/proposals`): a
 * reload draws each card as it was left, and no card offers Approve twice, in any browser.
 *
 * This tab holds HQ's answers and its own writes in memory. Its own decision is drawn at once and
 * carried out only once HQ took it; one HQ did not take is taken back, with why — and where HQ
 * holds another decision already, that one is drawn. A read that answers after this tab's own
 * write takes nothing back (`furtherDecision`). Until HQ answered for a card, it offers no Approve.
 *
 * Which approvals this tab carries out now is memory only: an approval a reload interrupted is not
 * running here, and its card says its end was not seen.
 */
import type { HqApi } from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  decisionFromHq,
  furtherDecision,
  hqWriteOf,
  recordDecision,
  type ProposalDecision,
  type ProposalDecisions,
} from "../components/zerops/proposal/proposal.logic";
import { onAccountLifetimeClose } from "./accountLifetime";
import { useOfficialHq } from "./accountHq";

type DecisionsApi = Pick<HqApi, "proposalDecisions" | "decideProposal">;

/** One card's record: its decision, whether HQ answered for it, and whether it runs here. */
export interface ProposalRecordEntry {
  readonly decision: ProposalDecision | undefined;
  /** HQ answered what was decided of it: until then it offers no Approve. */
  readonly known: boolean;
  readonly runningHere: boolean;
}

const HQ_DID_NOT_KEEP = "HQ could not keep your decision, so nothing ran. Try again.";
const DECIDED_ELSEWHERE = "It was decided elsewhere.";

export function makeProposalRecord() {
  let decisions: ProposalDecisions = {};
  const answered = new Set<string>();
  const asking = new Set<string>();
  /** Asked for in this task: read together, in one call, once it ends. */
  let pending: { api: DecisionsApi; ids: Set<string> } | null = null;
  const runningHere = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const adopt = (records: Awaited<ReturnType<DecisionsApi["proposalDecisions"]>>) => {
    const next: Record<string, ProposalDecision> = { ...decisions };
    for (const record of records) {
      next[record.id] = furtherDecision(next[record.id], decisionFromHq(record));
    }
    decisions = next;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
    entry(id: string): ProposalRecordEntry {
      return {
        decision: decisions[id],
        known: answered.has(id),
        runningHere: runningHere.has(id),
      };
    },
    /**
     * Asks HQ what it holds of `ids`: every id asked for in one task — a conversation's cards as
     * they mount — read in one call once it ends, none read or being read already.
     */
    read(api: DecisionsApi, ids: ReadonlyArray<string>): Promise<void> {
      const unread = ids.filter((id) => !answered.has(id) && !asking.has(id));
      if (unread.length === 0) return Promise.resolve();
      if (pending === null || pending.api !== api) pending = { api, ids: new Set() };
      for (const id of unread) pending.ids.add(id);
      const batch = pending;
      return Promise.resolve().then(async () => {
        if (pending === batch) pending = null;
        const asked = [...batch.ids].filter((id) => !answered.has(id) && !asking.has(id));
        if (asked.length === 0) return;
        for (const id of asked) asking.add(id);
        try {
          adopt(await batch.api.proposalDecisions(asked));
          for (const id of asked) answered.add(id);
        } catch {
          // HQ did not answer: the cards wait, and the next read asks again.
        } finally {
          for (const id of asked) asking.delete(id);
          changed();
        }
      });
    },
    /**
     * Records `next` for `id`, drawn at once, and writes it to HQ under `projectId`. Answers null
     * once HQ took a decision, or why not — then the card is as it was, or as HQ holds it. An
     * approval's end HQ did not take stays drawn here: its card says on a reload that its end was
     * not seen.
     */
    async record(
      api: DecisionsApi,
      id: string,
      projectId: string,
      next: ProposalDecision,
    ): Promise<string | null> {
      const before = decisions[id];
      const after = recordDecision(decisions, id, next);
      if (after === decisions) return DECIDED_ELSEWHERE;
      decisions = after;
      if (next.state === "running") runningHere.add(id);
      else runningHere.delete(id);
      changed();
      const deciding = before === undefined;
      try {
        adopt([await api.decideProposal(id, hqWriteOf(next, projectId))]);
        changed();
        return null;
      } catch (cause) {
        if (!deciding) return null;
        const { [id]: _taken, ...rest } = decisions;
        decisions = rest;
        runningHere.delete(id);
        // HQ holds another decision of it already: that one is drawn.
        const conflict = (cause as { readonly status?: unknown } | null)?.status === 409;
        if (conflict) {
          try {
            adopt(await api.proposalDecisions([id]));
          } catch {
            // Unread: the card offers its decision again, and HQ refuses a second one.
          }
        }
        changed();
        return conflict ? DECIDED_ELSEWHERE : HQ_DID_NOT_KEEP;
      }
    },
    forget() {
      decisions = {};
      pending = null;
      answered.clear();
      asking.clear();
      runningHere.clear();
      changed();
    },
  };
}

const record = makeProposalRecord();
onAccountLifetimeClose(() => record.forget());

/** Reads what HQ holds of every card in the open conversation, in one call. */
export function useProposalDecisionsRead(ids: ReadonlyArray<string>): void {
  const api = useOfficialHq()?.api ?? null;
  const key = ids.join(",");
  useEffect(() => {
    if (api === null || key === "") return;
    void record.read(api, key.split(","));
  }, [api, key]);
}

export interface ProposalDecisionHandle extends ProposalRecordEntry {
  /** HQ is not open here yet: nothing can be decided. */
  readonly unreachable: boolean;
  /** Records `next`; null once HQ took it, else why not (`makeProposalRecord`'s `record`). */
  readonly record: (next: ProposalDecision) => Promise<string | null>;
}

/** One card's decision, under the project of the conversation it is in. */
export function useProposalDecision(
  id: string,
  projectId: string | undefined,
): ProposalDecisionHandle {
  const api = useOfficialHq()?.api ?? null;
  useSyncExternalStore(record.subscribe, record.version, record.version);
  useEffect(() => {
    if (api !== null) void record.read(api, [id]);
  }, [api, id]);
  const write = useCallback(
    async (next: ProposalDecision) =>
      api === null || projectId === undefined
        ? HQ_DID_NOT_KEEP
        : record.record(api, id, projectId, next),
    [api, id, projectId],
  );
  return {
    ...record.entry(id),
    unreachable: api === null || projectId === undefined,
    record: write,
  };
}
