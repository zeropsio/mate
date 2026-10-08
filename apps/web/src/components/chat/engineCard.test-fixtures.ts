/** Account deliveries used by the card's real timeline and renderer witnesses. */
import { useAtomValue } from "@effect/atom-react";
import {
  ENGINE_LIVE_POLICY,
  engineConversationId,
  engineConversationScopes,
  engineFactId,
  engineThread,
  makeAccountStore,
  makeEngineLiveText,
  mateEngineHostAtom,
  type MateEngineHost,
} from "@t3tools/client-runtime/data";
import {
  engineRun,
  personItem,
  callItem,
  type EngineRecords,
} from "@t3tools/client-runtime/data/fixtures";
import { EnvironmentId, ThreadId, ConversationId } from "@t3tools/contracts";

import { AtomRegistry } from "effect/reactivity";
import * as Option from "effect/Option";
import { useMemo } from "react";
import type { ChatMessage } from "../../types";
import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";

type Row = Extract<
  Parameters<ReturnType<typeof makeAccountStore>["dispatch"]>[0],
  { kind: "delivery" }
>["rows"][number];

export const CARD_KEY = { environmentId: "env-card", conversationId: "thread-card" };
export const CARD_RUN = `${CARD_KEY.conversationId}/r/1`;
export const CARD_THREAD = {
  environmentId: EnvironmentId.make(CARD_KEY.environmentId),
  threadId: ThreadId.make(CARD_KEY.conversationId),
};
export const CARD_RECORDS: EngineRecords = {
  runs: [
    engineRun(CARD_KEY.conversationId, 1, {
      summary: { items: 302, calls: { command: 300 }, answerItemId: null, lastItemSeq: 302 },
    }),
  ],
  items: [
    personItem(CARD_RUN, 1, "Inspect the service"),
    callItem(CARD_RUN, 2, {
      at: 1_760_000_000_502,
      step: "command",
      tool: { name: "Bash" },
      input: "Bash: inspect-service",
      shows: { toolName: "Bash", command: "inspect-service" },
    }),
  ],
  spans: [{ runId: CARD_RUN, from: null, to: 0, reading: null }],
};

export function cardAccount(readRunPage: MateEngineHost["conversations"]["readRunPage"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let notify: (() => void) | null = null;
  const live = makeEngineLiveText({
    policy: ENGINE_LIVE_POLICY,
    setTimer: (callback) => {
      notify = callback;
      return callback;
    },
    clearTimer: () => {
      notify = null;
    },
  });
  registry.set(mateEngineHostAtom, {
    store,
    live,
    conversations: { readRunPage },
  } as MateEngineHost);
  let sequence = 0;
  const publish = (records: EngineRecords) => {
    sequence += 1;
    const revision = {
      kind: "mate-conversation" as const,
      environmentId: CARD_KEY.environmentId,
      epoch: 1,
      seq: sequence,
    };
    const active = records.runs.findLast((run) => run.turnState === "running");
    const latest = active ?? records.runs.findLast((run) => run.state === "ended");
    const rows: Row[] = [
      {
        family: "mateEngineConversation",
        id: engineConversationId(CARD_KEY),
        value: {
          environmentId: CARD_KEY.environmentId,
          header: {
            conversationId: ConversationId.make(CARD_KEY.conversationId),
            agent: {
              instanceId: "claudeAgent",
              driver: "claudeAgent",
              model: "claude-sonnet-4-5",
              profile: { kind: "mate" },
            },
            archived: false,
            activeRunId: active?.id ?? null,
            latestRunId: latest?.id ?? null,
            runStatus:
              active !== undefined ? "running" : latest?.turnState === "error" ? "error" : "ready",
            model: "claude-sonnet-4-5",
            session: null,
            pausedUntil: null,
            queued: 0,
          },
          window: { oldestOrdinal: 1, earlier: false },
        },
        revision,
      },
      ...records.runs.map((run): Row => ({
        family: "mateEngineRun",
        id: engineFactId(CARD_KEY.environmentId, run.id),
        value: { ...run, environmentId: CARD_KEY.environmentId },
        revision,
      })),
      ...records.items.map((item): Row => ({
        family: "mateEngineItem",
        id: engineFactId(CARD_KEY.environmentId, item.id),
        value: { ...item, environmentId: CARD_KEY.environmentId },
        revision,
      })),
      ...(records.spans ?? []).map((span): Row => ({
        family: "mateEngineSpan",
        id: engineFactId(CARD_KEY.environmentId, span.runId),
        value: { ...span, ...CARD_KEY },
        revision: { kind: "mate-link", sequence },
      })),
    ];
    store.dispatch({
      kind: "delivery",
      via: "mate-direct",
      scopes: Object.values(engineConversationScopes(CARD_KEY)).map((scope) => ({
        scope,
        generation: 0,
      })),
      reset: true,
      partial: true,
      rows,
      removals: [],
    });
  };
  return {
    registry,
    store,
    live,
    publish,
    flush: () => {
      const callback = notify;
      notify = null;
      callback?.();
    },
    close: () => {
      live.close();
      store.close();
      registry.dispose();
    },
  };
}

export function useCardTimelineInput(account: ReturnType<typeof cardAccount>) {
  const projected = useAtomValue(account.store.data.project(engineThread, CARD_KEY));
  const thread = Option.getOrThrow(projected.data);
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(
        thread.messages as ReadonlyArray<ChatMessage>,
        [],
        deriveWorkLogEntries(thread.activities),
      ),
    [thread],
  );
  return {
    timelineEntries,
    latestTurn: thread.latestTurn,
    runningTurnId: thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null,
    isWorking: thread.latestTurn?.state === "running",
    activeTurnStartedAt: thread.latestTurn?.startedAt ?? null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  };
}
