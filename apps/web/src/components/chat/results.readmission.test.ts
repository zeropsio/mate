import { describe, expect, it } from "vite-plus/test";
import {
  callItem,
  engineRun,
  engineRow,
  engineRunCardsOfRecords,
  engineThreadOfRecords,
  noteItem,
  personItem,
  type EngineRecords,
} from "@t3tools/client-runtime/data/fixtures";
import {
  makeAccountStore,
  makeMateEngineOperations,
  projectMateLimit,
  type EngineCommand,
} from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import * as Effect from "effect/Effect";
import { derivePhase, deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import type { ChatMessage } from "../../types";
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic";
import { crewMessageCommand } from "../zerops/crew/crewComposerSend";

const key = { environmentId: "env-Ada", conversationId: "thread-Ada" };

// Source records go through the same account projection and row derivation as the conversation.
const conversation = (records: EngineRecords, conversationId = key.conversationId) => {
  const selected = { ...key, conversationId };
  const thread = engineThreadOfRecords(selected, records)!;
  const working = derivePhase(thread.session) === "running";
  const rows = deriveMessagesTimelineRows({
    runCards: engineRunCardsOfRecords(selected, records)!,
    timelineEntries: deriveTimelineEntries(
      thread.messages as ReadonlyArray<ChatMessage>,
      [],
      deriveWorkLogEntries(thread.activities),
    ),
    latestTurn: thread.latestTurn,
    runningTurnId: working ? thread.latestTurn!.turnId : null,
    isWorking: working,
    activeTurnStartedAt: thread.latestTurn?.startedAt ?? null,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  });
  return { thread, rows };
};

describe("C: calls, results and crew actions", () => {
  it.each(["live settlement", "reload"] as const)(
    "J06: concurrent calls stay readable through settlement and reload",
    (delivery) => {
      const running = engineRun(key.conversationId, 1, {
        state: "running",
        end: null,
        endedAt: null,
        summary: { items: 2, calls: { command: 2 }, answerItemId: null, lastItemSeq: 3 },
      });
      const calls = [
        { ordinal: 2, command: "inspect orders", output: "Orders contain order_id" },
        { ordinal: 3, command: "inspect users", output: "Users contain user_id" },
      ];
      const items = calls.map(({ ordinal, command, output }) =>
        callItem(running.id, ordinal, {
          state: "running",
          input: command,
          shows: { toolName: "Bash", command, rawOutput: { content: output } },
        }),
      );
      const shown = conversation({ runs: [running], items });
      expect(
        shown.thread.activities
          .filter(({ kind }) => kind === "tool.started")
          .map(({ payload }) => (payload as { toolCallId: string }).toolCallId),
      ).toEqual([`${running.id}/i/2`, `${running.id}/i/3`]);
      const settled: EngineRecords = {
        runs: [
          engineRun(key.conversationId, 1, {
            summary: { items: 2, calls: { command: 2 }, answerItemId: null, lastItemSeq: 3 },
          }),
        ],
        items: items.map((item) => (item.kind === "call" ? { ...item, state: "done" } : item)),
      };
      const final = conversation(delivery === "reload" ? structuredClone(settled) : settled);
      const work = final.rows
        .flatMap((row) => (row.kind === "record" ? row.items : []))
        .flatMap((item) =>
          item.kind === "step" ? item.step.entries : item.kind === "call" ? [item.entry] : [],
        );
      for (const { ordinal, output } of calls) {
        const step = work.filter((item) => item.toolCallId === `${running.id}/i/${ordinal}`);
        expect(step).toHaveLength(1);
        expect(JSON.stringify(step)).toContain(output);
      }
      expect(final.thread.latestTurn?.state).toBe("completed");
    },
  );

  it.each(["new run running", "new run completed", "reload"] as const)(
    "J07: failure preserves partial work and the next prompt can recover",
    (stage) => {
      const failed = engineRun(key.conversationId, 1, {
        end: { kind: "failed", reason: "The agent process failed", next: null },
        summary: { items: 1, calls: { command: 1 }, answerItemId: null, lastItemSeq: 2 },
      });
      const partial = callItem(failed.id, 2, {
        shows: {
          toolName: "Bash",
          command: "inspect orders",
          rawOutput: {
            content: "The successful partial result remains",
          },
        },
      });
      const before = conversation({ runs: [failed], items: [partial] });
      expect(before.thread.latestTurn?.state).toBe("error");
      const next = engineRun(
        key.conversationId,
        2,
        stage === "new run running"
          ? {
              state: "running",
              end: null,
              endedAt: null,
            }
          : {},
      );
      const records: EngineRecords = {
        runs: [failed, next],
        items: [
          partial,
          personItem(next.id, 1, "Continue the inspection"),
          ...(stage === "new run running" ? [] : [noteItem(next.id, 2, "The recovery finished")]),
        ],
      };
      const final = conversation(stage === "reload" ? structuredClone(records) : records);
      const work = final.rows
        .flatMap((row) => (row.kind === "record" ? row.items : []))
        .flatMap((item) =>
          item.kind === "step" ? item.step.entries : item.kind === "call" ? [item.entry] : [],
        );
      expect(work.filter((item) => item.toolCallId === partial.id)).toHaveLength(1);
      expect(JSON.stringify(work)).toContain("The successful partial result remains");
      expect(
        final.thread.messages.filter(({ text }) => text === "Continue the inspection"),
      ).toHaveLength(1);
      expect(final.thread.latestTurn?.state).toBe(
        stage === "new run running" ? "running" : "completed",
      );
      expect(
        final.thread.messages.filter(({ text }) => text === "The recovery finished"),
      ).toHaveLength(stage === "new run running" ? 0 : 1);
    },
  );

  it.each(["scout", "backend"])(
    "J10: a crewmate keeps its own conversation, routing and runs-on identity",
    (handle) => {
      const id = `crew-${handle}`;
      const run = engineRun(id, 1);
      const crew = engineThreadOfRecords(
        { ...key, conversationId: id },
        {
          runs: [run],
          items: [noteItem(run.id, 2, `${handle} has its own conversation`)],
          header: {
            model: "gpt-5.4",
            agent: {
              instanceId: "codex",
              driver: "codex",
              model: "gpt-5.4",
              profile: { kind: "crewmate", id: handle, name: handle },
            },
          },
        },
      )!;
      expect(crew.id).toBe(id);
      expect(crew.session).toMatchObject({ providerName: "codex" });
      expect(crew.modelSelection).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
      expect(crewMessageCommand(crew, { text: "Inspect the order keys", attachments: [] })).toEqual(
        {
          _tag: "message",
          handle,
          text: "Inspect the order keys",
          attachments: [],
        },
      );
      const main = conversation({
        runs: [engineRun(key.conversationId, 1)],
        items: [
          noteItem(`${key.conversationId}/r/1`, 2, "The existing conversation is still here"),
        ],
      }).thread;
      expect(main.messages.map(({ text }) => text)).toEqual([
        "The existing conversation is still here",
      ]);
      expect(crewMessageCommand(main, { text: "Ordinary chat", attachments: [] })).toBeNull();
    },
  );
});

it.each(["before Codex's first turn", "after Codex answers"])(
  "a fresh Codex session on the same Mate can send while Claude's refusal remains in history",
  async (stage) => {
    const refused = engineRun(key.conversationId, 1, {
      end: {
        kind: "usage-limit",
        driver: "claudeAgent",
        resetsAt: 4_070_908_800_000,
        window: "7-day",
      },
    });
    const history = conversation({
      runs: [refused],
      items: [
        noteItem(refused.id, 2, "The existing conversation is still here", { answer: false }),
      ],
      header: {
        archived: true,
        agent: {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          model: "sonnet",
          profile: { kind: "mate" },
        },
      },
    });
    const fresh = "fresh-codex";
    const row = engineRow(key.environmentId, fresh, {
      agent: { instanceId: "codex", driver: "codex", model: "gpt-5.4", profile: { kind: "mate" } },
    });
    const thread = engineThreadOfRecords(
      { ...key, conversationId: fresh },
      {
        row,
        header: { agent: row.agent, model: "gpt-5.4" },
        runs: stage === "before Codex's first turn" ? [] : [engineRun(fresh, 1)],
        items:
          stage === "before Codex's first turn"
            ? []
            : [noteItem(`${fresh}/r/1`, 2, "Codex is ready")],
      },
    )!;
    expect(thread.id).toBe(fresh);
    expect(thread.session).toMatchObject({ providerName: "codex" });
    expect(thread.modelSelection).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
    expect(projectMateLimit({ ...thread, engineRow: row }, refused.startedAt!)).toEqual({
      kind: "none",
    });
    expect(history.thread.archivedAt).not.toBeNull();
    expect(history.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pause", provider: "Claude", window: "7-day" }),
      ]),
    );
    expect(history.thread.messages.map(({ text }) => text)).toContain(
      "The existing conversation is still here",
    );
    const atoms = AtomRegistry.make();
    const store = makeAccountStore(atoms);
    const commands: EngineCommand[] = [];
    const operations = makeMateEngineOperations({
      store,
      makeId: () => "fresh-send",
      wire: {
        call: (_environmentId, command) => {
          commands.push(command);
          return Effect.succeed({ _tag: "Accepted", seq: 1 });
        },
        receipt: () => Effect.succeed({ _tag: "None" }),
      },
    });
    try {
      await Effect.runPromise(
        operations.send({ ...key, conversationId: fresh, text: "Use Codex while Claude waits" }),
      );
      expect(commands).toEqual([
        {
          kind: "send",
          conversationId: fresh,
          commandId: "fresh-send",
          text: "Use Codex while Claude waits",
          attachments: [],
        },
      ]);
    } finally {
      operations.close();
      store.close();
      atoms.dispose();
    }
  },
);
