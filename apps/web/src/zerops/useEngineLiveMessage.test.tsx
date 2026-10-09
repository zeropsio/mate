import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { vi } from "vite-plus/test";
import { engineRun, personItem } from "@t3tools/client-runtime/data/fixtures";
import { ItemId, ConversationId, RunId, type Item } from "@t3tools/contracts";
import {
  cardAccount,
  CARD_KEY,
  CARD_RUN,
  CARD_THREAD,
  CARD_RECORDS,
  useCardTimelineInput,
} from "../components/chat/engineCard.test-fixtures";
import { useEngineCardSnapshots } from "./useEngineCardPaging";
import { RunChat } from "../components/chat/RunChat";
import {
  createMessagesTimelineRowsCache,
  deriveMessagesTimelineRows,
  computeStableMessagesTimelineRows,
  type StableMessagesTimelineRowsState,
} from "../components/chat/MessagesTimeline.logic";
import { TimelineRowActivityCtx } from "../components/chat/timelineContext";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import { EnvironmentId } from "@t3tools/contracts";
import { RegistryContext } from "@effect/atom-react";
import {
  ENGINE_LIVE_POLICY,
  makeEngineLiveText,
  mateEngineHostAtom,
  type MateEngineHost,
} from "@t3tools/client-runtime/data";
import type { MessageId, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TimelineRowCtx, type TimelineRowSharedState } from "../components/chat/timelineContext";
import type { ChatMessage } from "../types";
import {
  useEngineLiveMessage,
  useEngineLiveMessages,
  useEngineLiveNow,
  useEngineLiveStructure,
} from "./useEngineLiveMessage";

const ENV = "env-ada";
const conversation = { environmentId: ENV, conversationId: "thread-ada" };

const message = (patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "thread-ada/r/1/i/2" as MessageId,
  role: "assistant",
  text: "",
  turnId: "thread-ada/r/1" as TurnId,
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
  streaming: true,
  ...patch,
});

function Words({ message }: { readonly message: ChatMessage }) {
  return <p>{useEngineLiveMessage(message).text}</p>;
}

function Thought({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  return (
    <p>
      {useEngineLiveMessages(messages)
        .map((said) => said.text)
        .join(" | ")}
    </p>
  );
}

function Now({ messages }: { readonly messages: ReadonlyArray<ChatMessage> }) {
  const now = useEngineLiveNow({ kind: "thinking", key: null, messages });
  return <p>{now?.messages?.map((said) => said.text).join(" | ")}</p>;
}

function drawn(node: React.ReactNode, streamed: (live: MateEngineHost["live"]) => void) {
  const live = makeEngineLiveText({
    policy: ENGINE_LIVE_POLICY,
    setTimer: () => null,
    clearTimer: () => undefined,
  });
  streamed(live);
  const registry = AtomRegistry.make();
  registry.set(mateEngineHostAtom, { live } as MateEngineHost);
  const row = { threadRef: { environmentId: ENV, threadId: "thread-ada" } };
  const html = renderToStaticMarkup(
    <RegistryContext value={registry}>
      <TimelineRowCtx value={row as unknown as TimelineRowSharedState}>{node}</TimelineRowCtx>
    </RegistryContext>,
  );
  registry.dispose();
  return html.replace(/<[^>]+>/gu, "");
}

describe("an engine Mate's words as it writes them", () => {
  it("shows a note's words as they stream, before its record holds any", () => {
    expect(
      drawn(<Words message={message()} />, (live) =>
        live.open(conversation, "thread-ada/r/1/i/2", "text", "Deploying the api"),
      ),
    ).toBe("Deploying the api");
  });

  it("shows the record's words once it settles, whatever live text is still held", () => {
    expect(
      drawn(<Words message={message({ text: "Deploying the api.", streaming: false })} />, (live) =>
        live.open(conversation, "thread-ada/r/1/i/2", "text", "Deploying the api. Then"),
      ),
    ).toBe("Deploying the api.");
  });

  it("shows a thought's reasoning as it streams, beside the thoughts before it", () => {
    expect(
      drawn(
        <Thought
          messages={[
            message({ id: "a" as MessageId, role: "reasoning", text: "Read", streaming: false }),
            message({ role: "reasoning" }),
          ]}
        />,
        (live) => live.open(conversation, "thread-ada/r/1/i/2", "reasoning", "Check the logs"),
      ),
    ).toBe("Read | Check the logs");
  });

  it("draws a message whose live text is not held as its record says", () => {
    expect(drawn(<Words message={message({ text: "Deploy" })} />, () => undefined)).toBe("Deploy");
  });

  it("names the thought it is having on the run's line as it streams", () => {
    expect(
      drawn(<Now messages={[message({ role: "reasoning" })]} />, (live) =>
        live.open(conversation, "thread-ada/r/1/i/2", "reasoning", "Check the logs"),
      ),
    ).toBe("Check the logs");
  });

  it("puts the note it is writing in the run's slot with its words so far", () => {
    function Writing() {
      const now = useEngineLiveNow({
        kind: "writing",
        note: { key: "note:a", message: message() },
      });
      return <p>{now?.note?.message.text}</p>;
    }
    expect(
      drawn(<Writing />, (live) =>
        live.open(conversation, "thread-ada/r/1/i/2", "text", "Deploying the api"),
      ),
    ).toBe("Deploying the api");
  });
});

it("shows an empty streaming thought when its words arrive, without rebuilding settled cards for each delta", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem() {} });
  const account = cardAccount(vi.fn());
  const liveRun = `${CARD_KEY.conversationId}/r/2`;
  const thought: Extract<Item, { kind: "thought" }> = {
    id: ItemId.make(`${liveRun}/i/2`),
    conversationId: ConversationId.make(CARD_KEY.conversationId),
    runId: RunId.make(liveRun),
    seq: 2,
    rev: 2,
    at: 1_760_000_002_002,
    by: { kind: "mate" },
    kind: "thought",
    preview: " ",
    length: 1,
    streaming: true,
  };
  const running = engineRun(CARD_KEY.conversationId, 2, {
    state: "running",
    end: null,
    endedAt: null,
    startedAt: 1_760_000_002_000,
  });
  const records = {
    runs: [CARD_RECORDS.runs[0]!, running],
    items: [
      ...CARD_RECORDS.items,
      personItem(liveRun, 1, "Check the logs", { at: 1_760_000_002_001 }),
      thought,
    ],
  };
  account.publish(records);
  account.live.open(CARD_KEY, thought.id, "reasoning", " ");
  account.flush();
  const cache = createMessagesTimelineRowsCache();
  let state: StableMessagesTimelineRowsState = { byId: new Map(), result: [] };
  let assemblies = 0;
  function Card() {
    const input = useCardTimelineInput(account);
    const cardPaging = useEngineCardSnapshots(CARD_THREAD);
    const liveLines = useEngineLiveStructure(CARD_THREAD, input.timelineEntries);
    assemblies += 1;
    state = computeStableMessagesTimelineRows(
      deriveMessagesTimelineRows({ ...input, cardPaging, liveLines, cache }),
      state,
    );
    const row = state.result.find((row) => row.kind === "record" && row.turnId === liveRun);
    if (row?.kind !== "record") throw new Error("live card missing");
    return <RunChat row={row} />;
  }
  const shared: TimelineRowSharedState = {
    timestampFormat: "24-hour",
    routeThreadKey: `${CARD_KEY.environmentId}:${CARD_KEY.conversationId}`,
    threadRef: CARD_THREAD,
    markdownCwd: undefined,
    resolvedTheme: "light",
    workspaceRoot: undefined,
    skills: [],
    activeThreadEnvironmentId: EnvironmentId.make(CARD_KEY.environmentId),
    onRevertToTurnCount() {},
    onRunShellCommand: undefined,
    onImageExpand() {},
    onOpenTurnDiff() {},
    speaker: { name: "Ada", tint: "sky" },
    standUpAsk: null,
    livePauseId: null,
    usagePause: null,
    onUsageAutoResumeChange: null,
    agentPanelModel: emptyAgentPanelModel(),
    onOpenAgents() {},
    onStopBackgroundWork() {},
    onSteerQueuedMessage() {},
    steerQueuedMessageShortcutLabel: null,
    onRemoveQueuedMessage() {},
    arrivedAfter: null,
    syncing: true,
    onHoldReading() {},
  };
  let renderer: ReactTestRenderer | null = null;
  try {
    await act(async () => {
      renderer = create(
        <RegistryContext value={account.registry}>
          <TimelineRowCtx value={shared}>
            <TimelineRowActivityCtx
              value={{
                isWorking: true,
                isCompacting: false,
                isRevertingCheckpoint: false,
                latestTurnId: null,
                workingStepLabel: null,
                stoppingBackgroundWork: false,
              }}
            >
              <Card />
            </TimelineRowActivityCtx>
          </TimelineRowCtx>
        </RegistryContext>,
      );
    });
    const bubbles = () =>
      renderer!.root.findAll(
        (node) => node.type === "div" && node.props["data-chat-kind"] === "thought",
      );
    expect(bubbles()).toHaveLength(0);
    const settled = state.result.find((row) => row.kind === "record" && row.turnId === CARD_RUN);
    expect(settled).toBeDefined();
    await act(async () => {
      account.live.append(CARD_KEY, thought.id, "reasoning", 1, "Check the logs");
      account.flush();
    });
    expect(bubbles()).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).toContain("Check the logs");
    expect(state.result.find((row) => row.id === settled!.id)).toBe(settled);
    const before = assemblies;
    await act(async () => {
      account.live.append(CARD_KEY, thought.id, "reasoning", 15, " then inspect the API");
      account.flush();
    });
    expect(JSON.stringify(renderer!.toJSON())).toContain("then inspect the API");
    expect(assemblies).toBe(before);
    expect(bubbles()).toHaveLength(1);
    await act(async () =>
      account.publish({
        ...records,
        runs: [
          records.runs[0]!,
          {
            ...running,
            state: "ended",
            turnState: "completed",
            end: { kind: "completed" },
            endedAt: thought.at + 1_000,
          },
        ],
        items: [
          ...records.items.slice(0, -1),
          {
            ...thought,
            streaming: false,
            preview: "Check the logs then inspect the API",
            length: 34,
          },
        ],
      }),
    );
    expect(bubbles()).toHaveLength(0);
    const opener = renderer!.root
      .findAllByType("button")
      .find((node) => node.children.includes("Show work"));
    expect(opener).toBeDefined();
    await act(async () => opener!.props.onClick());
    expect(bubbles()).toHaveLength(1);
  } finally {
    if (renderer !== null) await act(async () => renderer!.unmount());
    account.close();
    vi.unstubAllGlobals();
  }
});
