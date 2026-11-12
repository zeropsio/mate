import {
  ZEROPS_SESSION_STORAGE_KEY,
  saveZeropsSelection,
  type ZeropsStorageAdapter,
} from "@t3tools/client-runtime/zerops";
import { ZEROPS_SESSION_OWNER_STORAGE_KEY } from "@t3tools/client-runtime/zerops/account";
import { sharedHq } from "@t3tools/client-runtime/zerops/hq";
import { HQ_SESSIONS, makeKeptSessions } from "@t3tools/client-runtime/zerops/keptSessions";
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { accountHqApi, keptHqKey } from "./accountHq";
import { accountStorageKeyOf, closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  keptHqStream,
  makeHqStreamAhead,
  type HqStreamAhead,
  type StreamAheadHost,
} from "@t3tools/client-runtime/data/hqStreamAhead";

const ADDRESS = "https://hq.example.test";
const NOW = Date.parse("2026-11-12T08:00:00Z");
const HOUR_MS = 3_600_000;

/** A browser's storage as the sign-in's own owners wrote it for `userId` showing `orgId`. */
async function signedIn(
  options: {
    readonly userId?: string;
    readonly orgId?: string;
    readonly session?: string;
    readonly endsInMs?: number;
    readonly address?: string;
    /** The instant it was kept at: the wall clock's, where the app itself reads it back. */
    readonly now?: number;
  } = {},
) {
  const { userId = "person-1", orgId = "org-1", session = "hq-session-1", now = NOW } = options;
  const held = new Map<string, string>();
  const storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    removeItem: (key: string) => void held.delete(key),
  };
  const adapter: ZeropsStorageAdapter = {
    get: async (key) => storage.getItem(key),
    set: async (key, value) => storage.setItem(key, value),
    remove: async (key) => storage.removeItem(key),
  };
  storage.setItem(ZEROPS_SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "zerops-access" }));
  storage.setItem(
    ZEROPS_SESSION_OWNER_STORAGE_KEY,
    JSON.stringify({ userId, loginGeneration: "g1" }),
  );
  await saveZeropsSelection(adapter, {
    userId,
    clientUserId: "membership-1",
    clientId: orgId,
    projectId: null,
  });
  const scoped = {
    getItem: (key: string) => storage.getItem(accountStorageKeyOf(userId, key)),
    setItem: (key: string, value: string) =>
      storage.setItem(accountStorageKeyOf(userId, key), value),
    removeItem: (key: string) => storage.removeItem(accountStorageKeyOf(userId, key)),
  };
  const hq = sharedHq(options.address ?? ADDRESS);
  makeKeptSessions(scoped, () => now, HQ_SESSIONS).keep(keptHqKey(orgId, hq), {
    address: hq.address,
    token: session,
    expiresAtEpochMs: now + (options.endsInMs ?? 12 * HOUR_MS),
  });
  return storage;
}

/** A socket the test drives as the browser would. */
function fakeSocket(url: string) {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  const socket = {
    url,
    readyState: 0,
    sent: [] as Array<string>,
    closed: false,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      void listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    send: (data: string) => void socket.sent.push(data),
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

/** The page as a stream opened ahead sees it: HQ's answer to the ticket, the sockets made, a timer. */
function page(
  storage: Pick<Storage, "getItem">,
  ticket: () => Promise<Response> = async () => Response.json({ ticket: "t-1", expiresIn: 60 }),
) {
  const asked: Array<{ readonly url: string; readonly authorization: string | undefined }> = [];
  const sockets: Array<ReturnType<typeof fakeSocket>> = [];
  const waits: Array<{ readonly run: () => void; readonly ms: number }> = [];
  /** Whether the page gave up each request it made. */
  const givenUp: Array<() => boolean> = [];
  const host: StreamAheadHost = {
    storage,
    fetch: (url, init) => {
      asked.push({
        url,
        authorization: (init.headers as Record<string, string> | undefined)?.Authorization,
      });
      givenUp.push(() => init.signal?.aborted === true);
      return ticket();
    },
    openSocket: (url) => {
      const socket = fakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    nowEpochMs: () => NOW,
    socketName: () => "the-tabs-socket",
    setTimeout: (run, ms) => void waits.push({ run, ms }),
  };
  const byLength = () => waits.toSorted((a, b) => a.ms - b.ms);
  return {
    host,
    asked,
    sockets,
    givenUp,
    /** The time HQ has to answer the ticket runs out: the shorter of the page's two waits. */
    ticketOverdue: () => byLength()[0]!.run(),
    /** The time anyone has to take the stream runs out: the longer. */
    nobodyCame: () => byLength().at(-1)!.run(),
  };
}

/** HQ's answer to the ticket has been read, and the socket made. */
const answered = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const hearing = () => {
  const heard: Array<string> = [];
  return {
    heard,
    on: {
      open: () => void heard.push("open"),
      message: (data: string) => void heard.push(`message ${data}`),
      close: (code: number) => void heard.push(`close ${String(code)}`),
    },
  };
};

describe("HQ's stream, opened while the app's code still loads", () => {
  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | const SHARED_HQ_DOOR = "hq"; → const SHARED_HQ_DOOR = "door";
  it("is opened for the organization the kept sign-in last showed, with the session its HQ issued", async () => {
    const storage = await signedIn();
    expect(keptHqStream(storage, ADDRESS, NOW)).toEqual({
      orgId: "org-1",
      session: "hq-session-1",
    });
    const { host, asked, sockets } = page(storage);
    const opened = makeHqStreamAhead(`${ADDRESS}/`, host);
    expect(opened).toMatchObject({ address: ADDRESS, orgId: "org-1" });
    expect(asked).toEqual([
      { url: `${ADDRESS}/api/stream-ticket`, authorization: "Bearer hq-session-1" },
    ]);
    const { heard, on } = hearing();
    const socket = await opened!.stream.take("hq-session-1", on);
    expect(sockets.map(({ url }) => url)).toEqual([
      "wss://hq.example.test/api/structure/ws?ticket=t-1&socket=the-tabs-socket",
    ]);
    expect(opened!.stream.socketName).toBe("the-tabs-socket");
    expect(socket).not.toBeNull();
    expect(heard).toEqual([]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | nowEpochMs + SESSION_LEAD_MS >= expiresAtEpochMs → false
  it.each([
    {
      when: "nobody is signed in",
      change: (s: Storage) => s.removeItem(ZEROPS_SESSION_STORAGE_KEY),
    },
    {
      when: "the sign-in's owner is not recorded",
      change: (s: Storage) => s.removeItem(ZEROPS_SESSION_OWNER_STORAGE_KEY),
    },
    {
      when: "another person's organization is the one remembered",
      change: (s: Storage) =>
        s.setItem(
          ZEROPS_SESSION_OWNER_STORAGE_KEY,
          JSON.stringify({ userId: "person-2", loginGeneration: "g2" }),
        ),
    },
    {
      when: "HQ's session is not kept",
      change: (s: Storage) => s.removeItem(accountStorageKeyOf("person-1", HQ_SESSIONS.storageKey)),
    },
    { when: "HQ's session is about to end", endsInMs: 10 * 60_000 },
    { when: "the session kept is another HQ's", address: "https://other-hq.example.test" },
  ])("asks HQ nothing when $when", async ({ change, endsInMs, address }) => {
    const storage = await signedIn({
      ...(endsInMs === undefined ? {} : { endsInMs }),
      ...(address === undefined ? {} : { address }),
    });
    change?.(storage as unknown as Storage);
    const { host, asked } = page(storage);
    expect(makeHqStreamAhead(ADDRESS, host)).toBeNull();
    expect(asked).toEqual([]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | for (const event of before.splice(0)) event(on); →
  it("hands its socket to the client holding that session, with everything the socket did meanwhile, in order", async () => {
    const { host, sockets } = page(await signedIn());
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    await answered();
    sockets[0]!.emit("open");
    sockets[0]!.emit("message", { data: '{"type":"ping"}' });
    const { heard, on } = hearing();
    const socket = await stream.take("hq-session-1", on);
    expect(heard).toEqual(["open", 'message {"type":"ping"}']);
    sockets[0]!.emit("message", { data: "later" });
    sockets[0]!.emit("close", { code: 4410 });
    expect(heard).toEqual(["open", 'message {"type":"ping"}', "message later", "close 4410"]);
    socket!.send("subscribe");
    expect(sockets[0]!.sent).toEqual(["subscribe"]);
    // Taken once: the client's next socket is its own.
    expect(await stream.take("hq-session-1", on)).toBeNull();
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | if (session !== kept.session || closed) { → if (closed) {
  it("hands nothing to a client holding another session, and closes the socket", async () => {
    const { host, sockets } = page(await signedIn());
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    const { heard, on } = hearing();
    expect(await stream.take("another-session", on)).toBeNull();
    expect(sockets[0]!.closed).toBe(true);
    sockets[0]!.emit("open");
    expect(heard).toEqual([]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | if (session !== kept.session || closed) { → if (session !== kept.session) {
  it("hands nothing over once the socket closed before anyone took it", async () => {
    const { host, sockets } = page(await signedIn());
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    await answered();
    sockets[0]!.emit("close", { code: 1006 });
    const { heard, on } = hearing();
    expect(await stream.take("hq-session-1", on)).toBeNull();
    expect(heard).toEqual([]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | void socket.then((made) => (made === "no-ticket" ? undefined : made.close())); →
  it.each([
    {
      when: "nobody took it",
      close: (_stream: HqStreamAhead, nobodyCame: () => void) => nobodyCame(),
    },
    {
      when: "its client says it will not take it, at once",
      close: (stream: HqStreamAhead) => stream.release(),
    },
  ])("is closed when $when, and then hands nothing over", async ({ close }) => {
    const { host, sockets, nobodyCame } = page(await signedIn());
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    await answered();
    close(stream, nobodyCame);
    await answered();
    expect(sockets[0]!.closed).toBe(true);
    expect(await stream.take("hq-session-1", hearing().on)).toBeNull();
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | const made = await Promise.race([socket, overdue]); → const made = await socket;
  it("keeps its client waiting no longer than HQ has to answer the ticket: the client is handed nothing and asks for its own, and the ticket's request is given up", async () => {
    let answer: (response: Response) => void = () => {};
    const { host, sockets, givenUp, ticketOverdue } = page(
      await signedIn(),
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    let handed: unknown = "still waiting";
    void stream.take("hq-session-1", hearing().on).then((socket) => (handed = socket));
    await answered();
    expect(handed).toBe("still waiting");
    ticketOverdue();
    await answered();
    expect(handed).toBeNull();
    expect(givenUp.map((gone) => gone())).toEqual([true]);
    // HQ answering after all opens nothing.
    answer(Response.json({ ticket: "t-late", expiresIn: 60 }));
    await answered();
    expect(sockets).toEqual([]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | const made = await Promise.race([socket, overdue]); → const made = await Promise.race([overdue, socket]);
  it("hands over a socket whose ticket HQ answered, however late its client asks", async () => {
    const { host, sockets, givenUp, ticketOverdue } = page(await signedIn());
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    await answered();
    ticketOverdue();
    await answered();
    expect(await stream.take("hq-session-1", hearing().on)).not.toBeNull();
    expect(sockets.map(({ closed }) => closed)).toEqual([false]);
    expect(givenUp.map((gone) => gone())).toEqual([false]);
  });

  // witness: packages/client-runtime/src/data/adapters/hqStreamAhead.ts | if (made === "no-ticket") return null; →
  it.each([
    {
      when: "HQ cannot be reached",
      ticket: () => Promise.reject(new TypeError("Failed to fetch")),
    },
    {
      when: "HQ no longer takes the session",
      ticket: async () => Response.json({ code: "session_required" }, { status: 401 }),
    },
  ])("opens no socket and hands nothing over when $when", async ({ ticket }) => {
    const { host, sockets } = page(await signedIn(), ticket);
    const { stream } = makeHqStreamAhead(ADDRESS, host)!;
    expect(await stream.take("hq-session-1", hearing().on)).toBeNull();
    expect(sockets).toEqual([]);
  });
});

// The tab owns its socket's name, which HQ ties a held press to (`tabHqSocketName.ts`): a reload
// keeps it. The boot entry opens the stream before the app exists, each with its own copy of
// every module, so the two agree on the name through the page or not at all.
describe("The page's boot entry and the app use one socket name, the tab's", () => {
  const SOCKET_NAME_KEY = "mate:hq-socket-name";
  const FRESH = /^[0-9a-f]{32}$/u;

  afterEach(() => {
    closeAccountLifetime();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis, "__mateHqStreamAhead");
  });

  /**
   * One load of a signed-in tab, as the browser runs it: the boot entry first, then the app's HQ
   * client opening its stream and holding a press. `tab` is what the tab's `sessionStorage` held
   * when the load began, `reached` how the page was reached.
   */
  async function load(tab: {
    readonly held: string | null;
    readonly reached: "reload" | "navigate";
    readonly storageRefused?: boolean;
  }) {
    const sessionStorage = new Map<string, string>(
      tab.held === null ? [] : [[SOCKET_NAME_KEY, tab.held]],
    );
    const named: Array<string> = [];
    const localStorage = await signedIn({ now: Date.now() });
    vi.stubGlobal("window", {
      localStorage,
      get sessionStorage() {
        if (tab.storageRefused === true) throw new DOMException("refused", "SecurityError");
        return {
          getItem: (key: string) => sessionStorage.get(key) ?? null,
          setItem: (key: string, value: string) => {
            named.push(value);
            sessionStorage.set(key, value);
          },
        };
      },
    });
    class NavigationTiming {
      readonly type = tab.reached;
    }
    vi.stubGlobal("PerformanceNavigationTiming", NavigationTiming);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      new NavigationTiming() as unknown as PerformanceEntry,
    ]);
    const tickets: Array<string | null> = [];
    const presses: Array<string | undefined> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/api/stream-ticket") {
        tickets.push(new Headers(init?.headers).get("authorization"));
        return Response.json({ ticket: `t-${String(tickets.length)}`, expiresIn: 60 });
      }
      if (pathname.startsWith("/api/presses/")) {
        presses.push((JSON.parse(String(init?.body)) as { readonly socket?: string }).socket);
        return Response.json({});
      }
      return new Response(null, { status: 204 });
    });
    const sockets: Array<string | null> = [];
    vi.stubGlobal(
      "WebSocket",
      class {
        readonly readyState = 1;
        constructor(url: string) {
          sockets.push(new URL(url).searchParams.get("socket"));
        }
        addEventListener() {}
        send() {}
        close() {}
      },
    );
    // The boot entry is a script of its own: it runs its own copy of every module it bundles.
    vi.stubEnv("VITE_HQ_ORIGIN", ADDRESS);
    vi.resetModules();
    await import("../boot");
    const afterBoot = { tickets: tickets.length, named: [...named] };
    openAccountLifetime("person-1");
    const client = {
      accountEpoch: 1,
      accessToken: async () => ({ token: "access" }),
    } as unknown as ZeropsApiClient;
    const api = accountHqApi(client, "org-1", sharedHq(ADDRESS));
    await api.openScopeSocket(
      { open: () => {}, message: () => {}, close: () => {} },
      new AbortController().signal,
    );
    await api.holdPress("project-1", { owner: "press-1", kind: "mate" });
    return {
      /** The name of each socket opened, the bearer of each ticket asked for, each press's name. */
      sockets,
      tickets,
      presses,
      afterBoot,
      /** Each name the load stored for the tab's next reload. */
      named,
      stored: () => sessionStorage.get(SOCKET_NAME_KEY) ?? null,
    };
  }

  /** The boot entry's stream was the app's: one ticket, one socket, and the press under its name. */
  const oneStream = (page: Awaited<ReturnType<typeof load>>) => {
    expect(page.afterBoot.tickets).toBe(1);
    expect(page.tickets).toEqual(["Bearer hq-session-1"]);
    expect(page.sockets).toHaveLength(1);
    expect(page.presses).toEqual(page.sockets);
    return page.sockets[0]!;
  };

  // witness: apps/web/src/zerops/tabHqSocketName.ts | if (kept !== null && kept !== "") return kept; →
  it("a reload: the stream the boot entry opens carries the name the tab kept, the app takes it over, and a press held before the reload is held under that name still", async () => {
    const page = await load({ held: "the-name-before-the-reload", reached: "reload" });
    expect(oneStream(page)).toBe("the-name-before-the-reload");
    expect(page.named).toEqual([]);
    expect(page.stored()).toBe("the-name-before-the-reload");
  });

  // witness: apps/web/src/zerops/tabHqSocketName.ts | if (typeof held === "string") return held; → if (typeof held === "number") return String(held);
  it("a fresh navigation: the name the boot entry gives its stream is the one the app then uses, stored once for the next reload", async () => {
    const page = await load({ held: null, reached: "navigate" });
    const name = oneStream(page);
    expect(name).toMatch(FRESH);
    expect(page.afterBoot.named).toEqual([name]);
    expect(page.named).toEqual([name]);
    expect(page.stored()).toBe(name);
  });

  // witness: apps/web/src/zerops/tabHqSocketName.ts | navigation.type === "reload" → navigation.type === "navigate"
  it("a duplicated tab, which copies the first tab's storage: a name of its own for the boot entry's stream and the app alike, stored in place of the copy", async () => {
    const page = await load({ held: "the-first-tabs-name", reached: "navigate" });
    const name = oneStream(page);
    expect(name).toMatch(FRESH);
    expect(page.named).toEqual([name]);
    expect(page.stored()).toBe(name);
  });

  // witness: apps/web/src/zerops/tabHqSocketName.ts | return freshHqSocketName(); → return "";
  it("a tab whose storage is refused: a fresh name, the boot entry's and the app's alike, and the boot entry's stream is still the app's", async () => {
    const page = await load({ held: null, reached: "reload", storageRefused: true });
    expect(oneStream(page)).toMatch(FRESH);
    expect(page.named).toEqual([]);
  });
});
