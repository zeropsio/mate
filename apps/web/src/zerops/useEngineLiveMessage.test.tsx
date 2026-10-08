import { RegistryContext } from "@effect/atom-react";
import {
  ENGINE_LIVE_POLICY,
  makeEngineLiveText,
  mateEngineHostAtom,
  type MateEngineHost,
} from "@t3tools/client-runtime/data";
import type { MessageId, TurnId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { TimelineRowCtx, type TimelineRowSharedState } from "../components/chat/timelineContext";
import type { ChatMessage } from "../types";
import { useEngineLiveMessage, useEngineLiveMessages } from "./useEngineLiveMessage";

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
});
