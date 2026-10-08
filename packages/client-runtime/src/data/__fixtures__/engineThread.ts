/** An engine conversation's records held in an account, drawn as the thread the view reads. */
import type { Item, OrchestrationThread, RunRecord } from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  type EngineConversationKey,
} from "../families/mateEngine.ts";
import { emptyAccount } from "../model.ts";
import { engineThread } from "../projections/mateEngine.ts";
import { reduceAccount, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { engineHeader } from "./mateEngine.ts";

const revision = (environmentId: string, seq: number) => ({
  kind: "mate-conversation" as const,
  environmentId,
  epoch: 1,
  seq,
});

/** The thread a conversation's runs and items draw as, once an account holds them. */
export function engineThreadOfRecords(
  key: EngineConversationKey,
  records: { readonly runs: ReadonlyArray<RunRecord>; readonly items: ReadonlyArray<Item> },
): OrchestrationThread | null {
  const environmentId = key.environmentId;
  const rows: Row[] = [
    {
      family: "mateEngineConversation",
      id: engineConversationId(key),
      value: {
        environmentId,
        header: engineHeader(key.conversationId),
        window: { oldestOrdinal: 1, earlier: false },
      },
      revision: revision(environmentId, 1_000_000),
    },
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
  ];
  const { state } = reduceAccount(emptyAccount, {
    kind: "delivery",
    via: "mate-direct",
    scopes: Object.values(engineConversationScopes(key)).map((scope) => ({
      scope,
      generation: 0,
    })),
    reset: true,
    partial: true,
    rows,
    removals: [],
  });
  return Option.getOrNull(engineThread.derive(readsOfState(state), key).data);
}
