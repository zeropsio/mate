/**
 * A Mate engine conversation, as the account holds it: its header, runs, items and requests, each
 * the engine's own record ready to draw, keyed by environment and record id; and the Mate's
 * conversation rows (its menu). One link per conversation subscription, one per Mate's rows. Live
 * text is never a fact (`engineLive.ts`).
 *
 * @module data/families/mateEngine
 */
import type {
  ConversationHeader,
  ConversationRow,
  EngineWindow,
  Item,
  Request,
  RunRecord,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";

import type { LinkKey, ScopeKey } from "../model.ts";
import type { FamilySpec } from "./spec.ts";

/** A record of one environment's engine: ids are unique per environment, never across them. */
export type EngineFact<T> = T & { readonly environmentId: string };

export interface EngineConversationKey {
  readonly environmentId: string;
  readonly conversationId: string;
}

/**
 * What the engine says of a conversation live and never records: how full its agent's context
 * is, and each running call's latest progress (the stand-up's), by its item. Held while the
 * conversation is, ordered by the order this tab heard it in.
 */
export interface EngineGaugeValue {
  readonly environmentId: string;
  readonly usage: ThreadTokenUsageSnapshot | null;
  readonly progress: Readonly<Record<string, unknown>>;
}

/** The conversation's own facts: its header, and the window of run groups held. */
export interface EngineConversationValue {
  readonly environmentId: string;
  readonly header: ConversationHeader;
  readonly window: EngineWindow;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly mateEngineConversation: EngineConversationValue;
    readonly mateEngineGauge: EngineGaugeValue;
    readonly mateEngineRun: EngineFact<RunRecord>;
    readonly mateEngineItem: EngineFact<Item>;
    readonly mateEngineRequest: EngineFact<Request>;
    readonly mateEngineRow: EngineFact<ConversationRow>;
  }
}

const encode = (parts: ReadonlyArray<string>) => encodeURIComponent(JSON.stringify(parts));

/** A record's fact id: its environment and its own id. */
export const engineFactId = (environmentId: string, id: string) => encode([environmentId, id]);
export const engineConversationId = (key: EngineConversationKey) =>
  engineFactId(key.environmentId, key.conversationId);

/** One link per conversation subscription; its scopes are children of it. */
export const engineConversationLink = (key: EngineConversationKey): LinkKey =>
  `mate:engine-${encode([key.environmentId, key.conversationId])}`;
/** One link per Mate's rows. */
export const engineRowsLink = (environmentId: string): LinkKey =>
  `mate:engine-rows-${encode([environmentId])}`;

const engineSpec = <
  F extends
    | "mateEngineConversation"
    | "mateEngineGauge"
    | "mateEngineRun"
    | "mateEngineItem"
    | "mateEngineRequest"
    | "mateEngineRow",
>(
  family: F,
  suffix: string,
): FamilySpec<F> => ({
  family,
  authority: "mate",
  scope: { source: "mate", suffix, leaving: "removed", demand: "detail", mode: "realtime" },
});

export const mateEngineConversationFamily = engineSpec(
  "mateEngineConversation",
  "engine-conversation",
);

export const mateEngineGaugeFamily = engineSpec("mateEngineGauge", "engine-gauge");

export const mateEngineRunFamily: FamilySpec<"mateEngineRun"> = {
  ...engineSpec("mateEngineRun", "engine-run"),
  /**
   * A conversation's older run groups, read when the person asks: they arrive in its own scopes;
   * this listing's stream says only whether the read is in flight.
   */
  mateDetails: [{ suffix: "engine-earlier", leaving: "removed" }],
  indexes: [
    {
      name: "engineRunsIn",
      keyOf: (run) => engineFactId(run.environmentId, run.conversationId),
    },
  ],
};

export const mateEngineItemFamily: FamilySpec<"mateEngineItem"> = {
  ...engineSpec("mateEngineItem", "engine-item"),
  indexes: [
    {
      name: "engineItemsIn",
      keyOf: (item) => engineFactId(item.environmentId, item.conversationId),
    },
    {
      name: "engineItemsOfRun",
      keyOf: (item) => (item.runId === null ? null : engineFactId(item.environmentId, item.runId)),
    },
  ],
};

export const mateEngineRequestFamily: FamilySpec<"mateEngineRequest"> = {
  ...engineSpec("mateEngineRequest", "engine-request"),
  indexes: [
    {
      name: "engineRequestsIn",
      keyOf: (request) => engineFactId(request.environmentId, request.conversationId),
    },
  ],
};

export const mateEngineRowFamily: FamilySpec<"mateEngineRow"> = {
  ...engineSpec("mateEngineRow", "engine-row"),
  indexes: [{ name: "engineRowsOf", keyOf: (row) => encode([row.environmentId]) }],
};

/** The scopes one conversation's link serves, by family. */
export const engineConversationScopes = (key: EngineConversationKey) => {
  const link = engineConversationLink(key);
  return {
    conversation: `${link}:engine-conversation` as ScopeKey,
    run: `${link}:engine-run` as ScopeKey,
    item: `${link}:engine-item` as ScopeKey,
    request: `${link}:engine-request` as ScopeKey,
    gauge: `${link}:engine-gauge` as ScopeKey,
  };
};

/** Where reading a conversation's older run groups stands: in flight, done or refused. */
export const engineEarlierScope = (key: EngineConversationKey): ScopeKey =>
  `${engineConversationLink(key)}:engine-earlier:${engineConversationId(key)}`;

export const engineRowsScope = (environmentId: string): ScopeKey =>
  `${engineRowsLink(environmentId)}:engine-row`;
export const engineRowsKey = (environmentId: string) => encode([environmentId]);

export const MATE_ENGINE_FAMILIES = [
  mateEngineConversationFamily,
  mateEngineGaugeFamily,
  mateEngineRunFamily,
  mateEngineItemFamily,
  mateEngineRequestFamily,
  mateEngineRowFamily,
] as const;
