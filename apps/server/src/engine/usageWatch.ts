/**
 * The engine's watch on what the providers report of their accounts' usage: a report that changed
 * goes to every conversation a usage limit pauses whose agent runs on that instance
 * (`ProviderUsage`), and the conversation decides whether its limit is gone. The reports the feed
 * holds at boot are the first, so a pause the provider no longer reports lifts with the restart.
 *
 * @module engine/usageWatch
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ConversationAgent, ConversationId } from "@t3tools/contracts";

import { Conversations } from "./Conversations.ts";
import type { InstanceUsage, ProviderUsageFeed } from "./ports.ts";

const ENGINE = { kind: "engine" } as const;
const decodeAgent = Schema.decodeUnknownEffect(Schema.fromJsonString(ConversationAgent));

const keyOf = (report: InstanceUsage): string =>
  [
    report.usage.checkedAt,
    ...report.usage.windows.map((window) => `${window.usedPercent}@${window.resetsAt}`),
  ].join(" ");

export const watchProviderUsage = (feed: ProviderUsageFeed["Service"]) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const sql = yield* SqlClient.SqlClient;
    const told = new Map<string, string>();

    const tellPaused = (reports: ReadonlyArray<InstanceUsage>) =>
      Effect.gen(function* () {
        // A report seen before has nothing new to say: a pause newer than it was not read by it.
        const changed = reports.filter((report) => told.get(report.instanceId) !== keyOf(report));
        if (changed.length === 0) return;
        for (const report of changed) told.set(report.instanceId, keyOf(report));
        const paused = yield* sql<{
          readonly conversation_id: string;
          readonly agent_json: string;
        }>`
          SELECT DISTINCT c.conversation_id, c.agent_json
          FROM engine_wake w JOIN engine_conversation c
            ON c.conversation_id = w.owner_conversation_id
          WHERE w.state = 'armed' AND w.kind IN ('usage-resume', 'usage-probe')
            AND c.owner_kind = 'conversation' AND c.agent_json IS NOT NULL
        `;
        for (const row of paused) {
          const agent = yield* decodeAgent(row.agent_json).pipe(Effect.option);
          if (agent._tag === "None") continue;
          const report = changed.find((each) => each.instanceId === agent.value.instanceId);
          if (report === undefined) continue;
          const conversation = ConversationId.make(row.conversation_id);
          yield* conversations
            .tell({
              commandId: CommandId.make(
                `usage:${conversation}:${report.instanceId}:${report.usage.checkedAt}`,
              ),
              conversationId: conversation,
              principal: ENGINE,
              command: { _tag: "ProviderUsage", usage: report.usage },
            })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Mate engine: a usage report could not be told", cause),
              ),
            );
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Mate engine: the paused conversations could not be read", cause),
        ),
      );

    yield* feed.reports.pipe(Stream.runForEach(tellPaused));
  });
