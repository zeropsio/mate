import { it, expect } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { MateAttention, VcsStatusResult, WS_METHODS } from "@t3tools/contracts";
import { WebSocket } from "ws";
import { MateFake } from "./mate.ts";
import { serve, deadline } from "../harness/http.ts";

const decodeVcsStatus = Schema.decodeUnknownSync(VcsStatusResult);

it("publishes its attention: whole on subscribe, then each new revision, a message one too", async () => {
  const fake = new MateFake("Ada", "Ada");
  const server = await serve(fake.handle, fake.socket);
  const decode = Schema.decodeUnknownSync(MateAttention);
  try {
    const socket = new WebSocket(server.origin.replace("http:", "ws:") + "/ws");
    const frames: unknown[][] = [];
    let ready = () => {};
    socket.on("message", (raw) => {
      frames.push((JSON.parse(raw.toString()) as { values: unknown[] }).values);
      ready();
    });
    await deadline(new Promise((resolve) => socket.once("open", resolve)), "Mate socket open");
    const next = async () => {
      if (frames.length === 0)
        await deadline(new Promise<void>((resolve) => (ready = resolve)), "attention chunk");
      return decode(frames.shift()![0]);
    };
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "attention",
        tag: WS_METHODS.subscribeZeropsAttention,
        payload: {},
      }),
    );
    expect(await next()).toMatchObject({
      source: { epoch: 1, incarnation: "fake-Ada", revision: 0 },
      mainThreadId: "thread-Ada",
      working: 0,
    });
    fake.publishAttention({ working: 1 });
    expect(await next()).toMatchObject({ source: { revision: 1 }, working: 1 });
    fake.message("one", "Hello", "command-one");
    expect(await next()).toMatchObject({ source: { revision: 2 }, working: 1 });
    socket.close();
  } finally {
    await server.close();
  }
});

it("revises its attention for its link to HQ alone, and starts it over when it restarts", () => {
  const fake = new MateFake("Ada", "Ada");
  fake.publishAttention({ working: 1 });
  expect(fake.reviseAttention({ working: 0 })).toMatchObject({
    source: { epoch: 1, incarnation: "fake-Ada", revision: 2 },
    working: 0,
  });
  fake.restart();
  expect(fake.attention()).toMatchObject({
    source: { epoch: 2, incarnation: "fake-Ada:1", revision: 0 },
    working: 0,
  });
  expect(fake.publishAttention()).toMatchObject({
    source: { epoch: 2, incarnation: "fake-Ada:1", revision: 1 },
  });
  expect(fake.lateFromRunBefore({ working: 1 })).toMatchObject({
    source: { epoch: 1, incarnation: "fake-Ada", revision: 3 },
    working: 1,
  });
});

it("answers checkout refreshes with the non-repository status", async () => {
  const fake = new MateFake("Ada", "Ada");
  const server = await serve(fake.handle, fake.socket);
  const socket = new WebSocket(server.origin.replace("http:", "ws:") + "/ws");
  try {
    await deadline(new Promise((resolve) => socket.once("open", resolve)), "Mate socket open");
    const answer = new Promise<unknown>((resolve) =>
      socket.once("message", (raw) => resolve(JSON.parse(raw.toString()))),
    );
    socket.send(
      JSON.stringify({
        _tag: "Request",
        id: "refresh",
        tag: WS_METHODS.vcsRefreshStatus,
        payload: { cwd: "/workspace" },
      }),
    );
    const response = await deadline(answer, "checkout refresh");
    expect(response).toMatchObject({
      _tag: "Exit",
      requestId: "refresh",
      exit: {
        _tag: "Success",
        value: {
          isRepo: false,
          hasPrimaryRemote: false,
          isDefaultRef: true,
          refName: null,
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      },
    });
    const frame = response as { exit: { value: unknown } };
    expect(decodeVcsStatus(frame.exit.value).isRepo).toBe(false);
    expect([...fake.unknownMethods]).toEqual([]);
  } finally {
    socket.close();
    await server.close();
  }
});
