/**
 * What the person decided of each proposal, as HQ keeps it (`GET` and `PUT /api/proposals`): a
 * reload draws each card as it was left, and no card offers Approve twice, in any browser. HQ is
 * reached through the data layer: its read (`readProposalDecisions`), and each decision written as
 * the account's `decide-proposal` operation.
 *
 * This tab holds HQ's answers and its own writes in memory. Its own decision is drawn at once and
 * carried out only once HQ took it; one HQ did not take is taken back, with why — and where HQ
 * holds another decision already, that one is drawn. A read that answers after this tab's own
 * write takes nothing back (`furtherDecision`). Until HQ answered for a card, it offers no Approve.
 *
 * Which approvals this tab carries out now is memory only: an approval a reload interrupted is not
 * running here, and its card says its end was not seen.
 */
import { PROPOSAL_DECIDED_ELSEWHERE, readProposalDecisions } from "@t3tools/client-runtime/data";
import type {
  HqProposalDecision,
  HqProposalDecisionWrite,
} from "@t3tools/client-runtime/zerops/hq";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

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
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** HQ's decisions as the data layer reaches them. */
export interface ProposalDecisionsAt {
  /** What HQ holds of `ids`; rejects where HQ did not answer. */
  readonly read: (ids: ReadonlyArray<string>) => Promise<ReadonlyArray<HqProposalDecision>>;
  /**
   * HQ's record of one decision written; rejects where HQ did not keep it — with the code
   * {@link PROPOSAL_DECIDED_ELSEWHERE} where HQ holds another decision of it.
   */
  readonly decide: (id: string, write: HqProposalDecisionWrite) => Promise<HqProposalDecision>;
}

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
  let pending: { at: ProposalDecisionsAt; ids: Set<string> } | null = null;
  const runningHere = new Set<string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  const adopt = (records: ReadonlyArray<HqProposalDecision>) => {
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
    read(at: ProposalDecisionsAt, ids: ReadonlyArray<string>): Promise<void> {
      const unread = ids.filter((id) => !answered.has(id) && !asking.has(id));
      if (unread.length === 0) return Promise.resolve();
      if (pending === null || pending.at !== at) pending = { at, ids: new Set() };
      for (const id of unread) pending.ids.add(id);
      const batch = pending;
      return Promise.resolve().then(async () => {
        if (pending === batch) pending = null;
        const asked = [...batch.ids].filter((id) => !answered.has(id) && !asking.has(id));
        if (asked.length === 0) return;
        for (const id of asked) asking.add(id);
        try {
          adopt(await batch.at.read(asked));
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
      at: ProposalDecisionsAt,
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
        adopt([await at.decide(id, hqWriteOf(next, projectId))]);
        changed();
        return null;
      } catch (cause) {
        if (!deciding) return null;
        const { [id]: _taken, ...rest } = decisions;
        decisions = rest;
        runningHere.delete(id);
        // HQ holds another decision of it already: that one is drawn.
        const conflict =
          (cause as { readonly code?: unknown } | null)?.code === PROPOSAL_DECIDED_ELSEWHERE;
        if (conflict) {
          try {
            adopt(await at.read([id]));
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

/**
 * HQ's decisions where the organization's official HQ is open and the account's operations are
 * held; `null` otherwise.
 */
function useDecisionsAt(): ProposalDecisionsAt | null {
  const api = useOfficialHq()?.api ?? null;
  const operations = useAccountOperationsOptional();
  const orgId = useZeropsSessionOptional()?.activeOrganization?.id ?? null;
  return useMemo(
    () =>
      api === null || operations === null || orgId === null
        ? null
        : {
            read: readProposalDecisions(api),
            decide: async (proposalId, write) =>
              (
                await operations.run(
                  { kind: "decide-proposal", orgId, proposalId, write },
                  { orgId, unobserved: HQ_UNFOLLOWED },
                )
              ).decision,
          },
    [api, operations, orgId],
  );
}

/** Reads what HQ holds of every card in the open conversation, in one call. */
export function useProposalDecisionsRead(ids: ReadonlyArray<string>): void {
  const at = useDecisionsAt();
  const key = ids.join(",");
  useEffect(() => {
    if (at === null || key === "") return;
    void record.read(at, key.split(","));
  }, [at, key]);
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
  const at = useDecisionsAt();
  useSyncExternalStore(record.subscribe, record.version, record.version);
  useEffect(() => {
    if (at !== null) void record.read(at, [id]);
  }, [at, id]);
  const write = useCallback(
    async (next: ProposalDecision) =>
      at === null || projectId === undefined
        ? HQ_DID_NOT_KEEP
        : record.record(at, id, projectId, next),
    [at, id, projectId],
  );
  return {
    ...record.entry(id),
    unreachable: at === null || projectId === undefined,
    record: write,
  };
}
