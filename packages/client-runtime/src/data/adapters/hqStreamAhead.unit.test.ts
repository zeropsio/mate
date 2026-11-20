import { expect, it } from "vite-plus/test";

import { makeHqStreamAhead, type StreamAheadHost } from "./hqStreamAhead.ts";

const ADDRESS = "https://v1.test";
const NOW = Date.parse("2026-01-01T00:00:00Z");
const SESSION = "v2";

/** The browser's storage as the sign-in keeps it: person v3 shows organization v4, whose HQ issued `SESSION`. */
const signedIn: Pick<Storage, "getItem"> = {
  getItem: (key) =>
    ({
      "zerops-mate.zerops-session.v1": JSON.stringify({ accessToken: "v5" }),
      "zerops-mate.zerops-session-owner.v1": JSON.stringify({ userId: "v3" }),
      "zerops-mate.zerops-selection.v1:v3": JSON.stringify({ userId: "v3", clientId: "v4" }),
      "mate:account:v3:hq-sessions.v1": JSON.stringify({
        [`v4:hq:${ADDRESS}`]: { token: SESSION, expiresAtEpochMs: NOW + 3_600_000 },
      }),
    })[key] ?? null,
};

/** A socket driven as the browser would. */
function browserSocket() {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const socket = {
    readyState: 0,
    closed: false,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    send: () => {},
    close: () => {
      socket.closed = true;
    },
    emit: (type: string, event: unknown = {}) => {
      if (type === "open") socket.readyState = 1;
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
  return socket;
}

/** A stream opened ahead, and its socket once HQ's ticket made it. */
function openedAhead() {
  let made: (socket: ReturnType<typeof browserSocket>) => void = () => {};
  const socket = new Promise<ReturnType<typeof browserSocket>>((resolve) => {
    made = resolve;
  });
  const host: StreamAheadHost = {
    storage: signedIn,
    fetch: async () => Response.json({ ticket: "v6", expiresIn: 60 }),
    openSocket: () => {
      const opened = browserSocket();
      made(opened);
      return opened as unknown as WebSocket;
    },
    nowEpochMs: () => NOW,
    socketName: () => "v7",
    setTimeout: () => undefined,
  };
  const { stream } = makeHqStreamAhead(ADDRESS, host)!;
  return { stream, socket };
}

/** What a client hears of the socket it took, in order. */
function client() {
  const heard: Array<string> = [];
  return {
    heard,
    on: {
      open: () => void heard.push("open"),
      message: (data: string) => void heard.push(`message ${data}`),
      close: (code: number) => void heard.push(`close ${code}`),
    },
  };
}

// witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | if (session !== kept.session || closed) { → if (closed) {
it("AD+12: HQ's stream opened while the app loads is handed only to the client holding the session it was opened with, with everything received meanwhile in order; another session gets nothing and the socket closes", async () => {
  const held = openedAhead();
  const heldSocket = await held.socket;
  heldSocket.emit("open");
  heldSocket.emit("message", { data: "v8" });
  heldSocket.emit("message", { data: "v9" });
  const holder = client();
  expect(await held.stream.take(SESSION, holder.on)).not.toBeNull();
  heldSocket.emit("message", { data: "v10" });
  expect(holder.heard).toEqual(["open", "message v8", "message v9", "message v10"]);

  const other = openedAhead();
  const otherSocket = await other.socket;
  otherSocket.emit("open");
  const stranger = client();
  expect(await other.stream.take("v11", stranger.on)).toBeNull();
  expect(otherSocket.closed).toBe(true);
  expect(stranger.heard).toEqual([]);
});
