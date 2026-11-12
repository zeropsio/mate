// @effect-diagnostics globalFetch:off globalDate:off globalTimers:off -- The page's boot entry runs before Effect is loaded: the browser's own fetch, clock and timer.
/**
 * HQ's stream, opened while the app's code still loads: the first step of the HQ adapter's own
 * opening (a ticket, then the socket), begun early. A signed-in reload knows, from what its browser
 * keeps of the sign-in, which organization it shows and the session that organization's HQ issued:
 * the web page's boot entry (`apps/web/src/boot.ts`) asks HQ for a stream ticket with it and opens
 * the socket, some 150 ms before the app could, under the name the page gives its socket for this
 * load (the tab's, which HQ ties a held press to). Nothing is asked on that socket here. HQ's
 * client takes it in place of its own ticket and socket (`HqApi.openScopeSocket`, `openedAhead`),
 * and from then on it is the data layer's socket like any other: the adapter subscribes, reads
 * and retries.
 *
 * It is taken only by the session it was opened with and under the name it was opened under, so
 * an account, organization or HQ other than the one the boot guessed opens its own as before. Whatever goes wrong here — nothing kept, HQ
 * refusing or not answering, the socket closing, nobody taking it — ends in the client opening its
 * own stream, when it would have without this, and saying what went wrong there.
 *
 * Imports nothing: the boot entry is these few lines, run ahead of the app's bundle. The keys and
 * shapes it reads are their owners' (`zerops/session.ts`, `zerops/account/session.ts`,
 * `zerops/keptSessions.ts`, and the web's `accountLifetime.ts` and `accountHq.ts`); the web's test
 * writes through those owners and reads through this.
 *
 * @module data/adapters/hqStreamAhead
 */

/** A socket as HQ's client holds one. */
interface StreamSocket {
  readonly send: (data: string) => void;
  readonly close: () => void;
}

/** What HQ's client hears of a socket. */
interface StreamHandlers {
  readonly open: () => void;
  readonly message: (data: string) => void;
  readonly close: (code: number) => void;
}

/** The stream opened ahead for one organization's HQ. */
export interface HqStreamAhead {
  /**
   * The name its socket gave HQ, which its page decided for this load. Its client takes it only
   * under the same name: the one HQ ties that client's presses to.
   */
  readonly socketName: string;
  /**
   * Hands the socket over, once, to the client holding `session`: `null` when it was opened with
   * another session, was taken already, never came to be, or HQ has not answered its ticket in
   * time ({@link TICKET_WAIT_MS}) — the client then opens its own.
   */
  readonly take: (session: string, on: StreamHandlers) => Promise<StreamSocket | null>;
  /**
   * Closes it untaken, at once: its client will not take it (it keeps no session, its account
   * changed, its door failed), and a signed-in socket nobody owns is not left open. Does nothing
   * once it was asked for: a take closes what it does not hand over.
   */
  readonly release: () => void;
}

/** A kept session with less than this left is not presented (`KEPT_SESSION_LEAD_MS`). */
const SESSION_LEAD_MS = 15 * 60_000;
/** How long a stream nobody took stays open: an app that shows no organization never takes it. */
const UNTAKEN_MS = 15_000;
/**
 * How long HQ has to mint the ticket, from when it was asked for, before a client that asks stops
 * waiting and opens its own stream; the request is then given up. The client must never start
 * later than it would have without a stream ahead, whatever HQ does: its own ticket takes 33 ms
 * at the median and 139 ms at the ninetieth percentile (133 loads, 2026-11-12), and it asks some
 * 300 ms after the page began, so it finds an answered ticket, or does not wait at all. Only an
 * app that starts within this time waits, for what is left of it.
 */
const TICKET_WAIT_MS = 250;

const OWNER_KEY = "zerops-mate.zerops-session-owner.v1";
const SESSION_KEY = "zerops-mate.zerops-session.v1";
const SELECTION_KEY = "zerops-mate.zerops-selection.v1";
const HQ_SESSIONS_KEY = "hq-sessions.v1";
/** The door every organization's shared HQ is named by (`sharedHq`). */
const SHARED_HQ_DOOR = "hq";

const record = (raw: string | null): Record<string, unknown> | null => {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
};

/**
 * The organization the stored sign-in last showed and the session its HQ at `address` issued, as
 * the browser keeps them; `null` when any of it is missing, unreadable or about to end.
 */
export function keptHqStream(
  storage: Pick<Storage, "getItem">,
  address: string,
  nowEpochMs: number,
): { readonly orgId: string; readonly session: string } | null {
  try {
    if (storage.getItem(SESSION_KEY) === null) return null;
    const userId = record(storage.getItem(OWNER_KEY))?.userId;
    if (typeof userId !== "string" || userId === "") return null;
    const owner = encodeURIComponent(userId);
    const selection = record(storage.getItem(`${SELECTION_KEY}:${owner}`));
    const orgId = selection?.userId === userId ? selection.clientId : null;
    if (typeof orgId !== "string" || orgId === "") return null;
    const kept = record(storage.getItem(`mate:account:${owner}:${HQ_SESSIONS_KEY}`));
    const held = kept?.[`${orgId}:${SHARED_HQ_DOOR}:${address}`];
    if (typeof held !== "object" || held === null) return null;
    const { token, expiresAtEpochMs } = held as Record<string, unknown>;
    if (typeof token !== "string" || token === "") return null;
    if (typeof expiresAtEpochMs !== "number" || nowEpochMs + SESSION_LEAD_MS >= expiresAtEpochMs)
      return null;
    return { orgId, session: token };
  } catch {
    return null;
  }
}

/** What the page offers a stream opened ahead; the browser's own outside tests. */
export interface StreamAheadHost {
  readonly storage: Pick<Storage, "getItem">;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly openSocket: (url: string) => WebSocket;
  readonly nowEpochMs: () => number;
  /**
   * The name this page load gives its HQ stream socket: the page's one decision, which the app's
   * HQ client reads too. Asked only when a stream is opened.
   */
  readonly socketName: () => string;
  readonly setTimeout: (run: () => void, ms: number) => unknown;
}

/** A stream opened ahead, and whose it is. */
interface OpenedAhead {
  readonly address: string;
  readonly orgId: string;
  readonly stream: HqStreamAhead;
}

/**
 * The stream of the HQ at `hqOrigin` for the organization the stored sign-in last showed, asked
 * for now; `null` when the browser keeps no session for it.
 */
export function makeHqStreamAhead(hqOrigin: string, host: StreamAheadHost): OpenedAhead | null {
  const address = hqOrigin.trim().replace(/\/+$/u, "");
  if (address === "") return null;
  const kept = keptHqStream(host.storage, address, host.nowEpochMs());
  if (kept === null) return null;
  const socketName = host.socketName();
  /** What the socket did before anyone listened, in order. */
  const before: Array<(on: StreamHandlers) => void> = [];
  let listener: StreamHandlers | null = null;
  const tell = (event: (on: StreamHandlers) => void) => {
    if (listener === null) before.push(event);
    else event(listener);
  };
  let closed = false;
  let taken = false;
  /** Gives the ticket's request up: nobody waits for its answer any more. */
  const asking = new AbortController();
  /**
   * The socket, once HQ minted its ticket. Without a ticket there is none to take: the client
   * asks for its own, and what HQ answers that one is what is said.
   */
  const ticketed = async (): Promise<WebSocket | "no-ticket"> => {
    let ticket: unknown;
    try {
      const response = await host.fetch(`${address}/api/stream-ticket`, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${kept.session}` },
        signal: asking.signal,
      });
      if (!response.ok) return "no-ticket";
      ({ ticket } = (await response.json()) as { readonly ticket?: unknown });
    } catch {
      return "no-ticket";
    }
    // An answer nobody waits for opens nothing.
    if (asking.signal.aborted) return "no-ticket";
    if (typeof ticket !== "string" || ticket === "") return "no-ticket";
    const made = host.openSocket(
      `${address.replace(/^http/u, "ws")}/api/structure/ws?ticket=${encodeURIComponent(ticket)}&socket=${encodeURIComponent(socketName)}`,
    );
    made.addEventListener("open", () => tell((on) => on.open()));
    made.addEventListener("message", (event: MessageEvent) => {
      const { data } = event;
      if (typeof data === "string") tell((on) => on.message(data));
    });
    made.addEventListener("close", (event: CloseEvent) => {
      closed = true;
      const { code } = event;
      tell((on) => on.close(code));
    });
    return made;
  };
  const socket = ticketed();
  /** Settles when HQ has had its time to mint the ticket. */
  const overdue = new Promise<"overdue">((resolve) => {
    host.setTimeout(() => resolve("overdue"), TICKET_WAIT_MS);
  });
  /** Given up: the ticket's request ends unanswered, and a socket already made is closed. */
  const drop = () => {
    asking.abort();
    void socket.then((made) => (made === "no-ticket" ? undefined : made.close()));
  };
  const release = () => {
    if (taken) return;
    taken = true;
    drop();
  };
  // A stream nobody took holds nothing: it is closed, and HQ forgets it.
  host.setTimeout(release, UNTAKEN_MS);
  return {
    address,
    orgId: kept.orgId,
    stream: {
      socketName,
      release,
      take: async (session, on) => {
        if (taken) return null;
        taken = true;
        // An answered ticket is taken however late the client asks; one HQ has not answered in
        // its time is not waited for, and the client asks for its own as it would have.
        const made = await Promise.race([socket, overdue]);
        if (made === "overdue") {
          drop();
          return null;
        }
        if (made === "no-ticket") return null;
        // Another session's, or one that already ended: closed here, and the client opens its own.
        if (session !== kept.session || closed) {
          made.close();
          return null;
        }
        listener = on;
        for (const event of before.splice(0)) event(on);
        return {
          send: (data) => {
            if (made.readyState === 1) made.send(data);
          },
          close: () => made.close(),
        };
      },
    },
  };
}

/**
 * Where the page keeps its one stream ahead. The boot entry is a script of its own, built apart
 * from the app's bundle it runs ahead of: the two share the page, not a module.
 */
const page = globalThis as { __mateHqStreamAhead?: OpenedAhead | null };

/**
 * Opens the page's one stream ahead ({@link makeHqStreamAhead}) over the browser's own transport,
 * with the sign-in `storage` keeps, under the name the page gives its socket for this load
 * (`socketName`, the web's `tabHqSocketName`). Called once, by the page's boot entry.
 */
export function openHqStreamAhead(
  hqOrigin: string,
  storage: Pick<Storage, "getItem">,
  socketName: () => string,
): void {
  page.__mateHqStreamAhead ??= makeHqStreamAhead(hqOrigin, {
    storage,
    fetch: (url, init) => fetch(url, init),
    openSocket: (url) => new WebSocket(url),
    nowEpochMs: () => Date.now(),
    socketName,
    setTimeout: (run, ms) => setTimeout(run, ms),
  });
}

/** The stream opened ahead for `orgId`'s HQ at `address`, if the boot entry opened one. */
export function hqStreamAhead(address: string, orgId: string): HqStreamAhead | null {
  const opened = page.__mateHqStreamAhead ?? null;
  return opened !== null && opened.address === address && opened.orgId === orgId
    ? opened.stream
    : null;
}
