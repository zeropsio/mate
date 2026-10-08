import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { OrchestrationThreadStreamItem, ORCHESTRATION_WS_METHODS } from "@t3tools/contracts";
import { WebSocket } from "ws";
const decodeItem = Schema.decodeUnknownSync(OrchestrationThreadStreamItem);

import { MateFake } from "../mate.ts";
import { ChatDriver } from "../../areas/c-mate/fake.ts";
import { deadline, serve } from "../../harness/http.ts";

// Catches a fake treating personal credentials as a shared project token and making read-only scenarios meaningless.
it("distinguishes project token, colleague OAuth and unrecorded OAuth facts", () => {
  const chat = new ChatDriver(new MateFake("Ada", "Ada"));
  expect(chat.auth().agents[0]).toMatchObject({ flagToken: true, flagOAuth: false });
  chat.ownership = "colleague";
  expect(chat.auth().agents[0]).toMatchObject({
    flagToken: false,
    flagOAuth: true,
    authorizedBy: { subject: "colleague" },
  });
  chat.ownership = "unrecorded";
  expect(chat.auth().agents[0]?.authorizedBy).toBeUndefined();
});

// Catches provider fixtures sending an invalid stream or forgetting the resolved question in reconnect history.
it("publishes typed requests and response receipts on the real wire and retains them in snapshots", async () => {
  const mate = new MateFake("Ada", "Ada");
  const chat = new ChatDriver(mate);
  chat.approval();
  chat.question();
  const server = await serve(mate.handle, mate.socket);
  const socket = new WebSocket(server.origin.replace("http:", "ws:") + "/ws");
  const frames: { _tag: string; requestId: string; values?: unknown[] }[] = [];
  let notify = () => {};
  socket.on("message", (raw) => {
    frames.push(JSON.parse(String(raw)));
    notify();
  });
  const until = async (predicate: () => boolean) => {
    while (!predicate())
      await deadline(
        new Promise<void>((resolve) => {
          notify = resolve;
        }),
        "chat wire receipt",
        5000,
      );
  };
  try {
    await deadline(
      new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      }),
      "chat socket",
    );
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "detail",
        tag: ORCHESTRATION_WS_METHODS.subscribeThread,
        payload: { threadId: mate.thread.id },
      }),
    );
    await until(() => frames.some((frame) => frame.requestId === "detail"));
    const items = frames[0]!.values!.map((value) => decodeItem(value));
    expect(items[0]).toMatchObject({
      kind: "snapshot",
      snapshot: {
        thread: { activities: [{ kind: "approval.requested" }, { kind: "user-input.requested" }] },
      },
    });
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "answer",
        tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
        payload: {
          type: "thread.user-input.respond",
          commandId: "answer-target",
          threadId: mate.thread.id,
          requestId: "question-target",
          answers: { target: "stage" },
          createdAt: "2026-10-05T12:00:00.000Z",
        },
      }),
    );
    await until(() =>
      frames.some((frame) => frame._tag === "Exit" && frame.requestId === "answer"),
    );
    const events = frames.flatMap((frame) => frame.values ?? []).map((value) => decodeItem(value));
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "event",
        event: expect.objectContaining({
          type: "thread.activity-appended",
          payload: expect.objectContaining({
            activity: expect.objectContaining({ kind: "user-input.resolved" }),
          }),
        }),
      }),
    );
    expect(mate.snapshot().thread.activities.at(-1)?.kind).toBe("user-input.resolved");
    expect(chat.wire.intents()).toMatchObject([
      { kind: "answer", ask: "question", answers: { target: "stage" } },
    ]);
  } finally {
    socket.terminate();
    await server.close();
  }
});
