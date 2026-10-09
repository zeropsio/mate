/** An engine conversation's records held in an account, drawn as the thread the view reads. */
import type { ConversationRow, Item, OrchestrationThread, RunRecord } from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  engineRowsScope,
  type EngineConversationKey,
  type EngineSpanValue,
} from "../families/mateEngine.ts";
import { emptyAccount } from "../model.ts";
import {
  engineCardPagingOf,
  engineRunCards,
  engineThread,
  type EngineCardPaging,
} from "../projections/mateEngine.ts";
import { reduceAccount, type Row } from "../reducer.ts";
import { readsOfState, type ProjectionReads } from "../store.ts";
import { engineHeader } from "./mateEngine.ts";

const revision = (environmentId: string, seq: number) => ({
  kind: "mate-conversation" as const,
  environmentId,
  epoch: 1,
  seq,
});

/** A conversation's records as an account holds them. */
export interface EngineRecords {
  readonly runs: ReadonlyArray<RunRecord>;
  readonly row?: ConversationRow;
  readonly items: ReadonlyArray<Item>;
  /** The stretches held of runs not read whole. */
  readonly spans?: ReadonlyArray<Omit<EngineSpanValue, "environmentId" | "conversationId">>;
}

/** The thread a conversation's runs and items draw as, once an account holds them. */
export function engineThreadOfRecords(
  key: EngineConversationKey,
  records: EngineRecords,
): OrchestrationThread | null {
  return Option.getOrNull(engineThread.derive(engineReadsOfRecords(key, records), key).data);
}

/** What the cards of a conversation's records not held whole count and hold. */
export function engineCardPagingOfRecords(
  key: EngineConversationKey,
  records: EngineRecords,
): Readonly<Record<string, EngineCardPaging>> {
  return engineCardPagingOf(engineReadsOfRecords(key, records), key);
}

export function engineRunCardsOfRecords(key: EngineConversationKey, records: EngineRecords) {
  return engineRunCards.derive(engineReadsOfRecords(key, records), key);
}

function engineReadsOfRecords(key: EngineConversationKey, records: EngineRecords): ProjectionReads {
  const environmentId = key.environmentId;
  const active = records.runs.findLast((run) => run.turnState === "running");
  const latest = active ?? records.runs.findLast((run) => run.state === "ended");
  const rows: Row[] = [
    {
      family: "mateEngineConversation",
      id: engineConversationId(key),
      value: {
        environmentId,
        header: engineHeader(key.conversationId, {
          activeRunId: active?.id ?? null,
          latestRunId: latest?.id ?? null,
          runStatus:
            active !== undefined ? "running" : latest?.turnState === "error" ? "error" : "ready",
        }),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(environmentId, 1_000_000),
    },
    ...(records.row === undefined
      ? []
      : [
          {
            family: "mateEngineRow" as const,
            id: engineFactId(environmentId, key.conversationId),
            value: { ...records.row, environmentId },
            revision: revision(environmentId, records.row.revision.seq),
          },
        ]),
    ...records.runs.map((run): Row => ({
      family: "mateEngineRun",
      id: engineFactId(environmentId, run.id),
      value: { ...run, environmentId },
      revision: revision(environmentId, run.rev),
    })),
    ...records.items.map((item): Row => ({
      family: "mateEngineItem",
      id: engineFactId(environmentId, item.id),
      value: { ...item, environmentId },
      revision: revision(environmentId, item.rev),
    })),
    ...(records.spans ?? []).map((span, n): Row => ({
      family: "mateEngineSpan",
      id: engineFactId(environmentId, span.runId),
      value: { ...span, environmentId, conversationId: key.conversationId },
      revision: { kind: "mate-link", sequence: n + 1 },
    })),
  ];
  const { state } = reduceAccount(emptyAccount, {
    kind: "delivery",
    via: "mate-direct",
    scopes: [
      ...Object.values(engineConversationScopes(key)),
      ...(records.row === undefined ? [] : [engineRowsScope(environmentId)]),
    ].map((scope) => ({
      scope,
      generation: 0,
    })),
    reset: true,
    partial: true,
    rows,
    removals: [],
  });
  return readsOfState(state);
}
