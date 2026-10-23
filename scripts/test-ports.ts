// @effect-diagnostics nodeBuiltinImport:off globalRandom:off -- host-only port reservations for test servers.
/**
 * A TCP port for a test server that no other test on this host is handed while the reservation
 * lasts.
 *
 * Binding port 0 and closing it to learn a number leaves the port free until the server binds it.
 * Meanwhile the kernel may hand it to another test's server, or to any outgoing connection as its
 * local port; and on macOS a `127.0.0.1` bind succeeds while another server listens on every
 * address. A reservation instead:
 *
 * - takes its port from `RESERVED`, below the kernel's ephemeral range (macOS 49152–65535, Linux
 *   32768–60999 by default; `test-ports.test.ts` checks this host's), so neither port 0 nor an
 *   outgoing connection lands on it;
 * - holds a UDP socket on the same number until released. UDP and TCP ports are separate, so the hold
 *   leaves the TCP port to the server and refuses every other reserver. The kernel drops the hold
 *   when its process ends, so a test that dies leaks nothing.
 */
import * as NodeDgram from "node:dgram";
import * as NodeNet from "node:net";

export const RESERVED = { first: 20_000, last: 32_767 } as const;

export interface PortReservation {
  readonly port: number;
  /** Lets another reserver have the port; the caller's server has ended. */
  readonly release: () => Promise<void>;
}

/** Every reservable port once, from a random one onwards. */
const everyPort = function* () {
  const size = RESERVED.last - RESERVED.first + 1;
  const start = Math.floor(Math.random() * size);
  for (let step = 0; step < size; step++) yield RESERVED.first + ((start + step) % size);
};

/** The UDP hold on `port`, or `undefined` when another reserver has it. */
const hold = (port: number) =>
  new Promise<NodeDgram.Socket | undefined>((resolve, reject) => {
    const socket = NodeDgram.createSocket("udp4");
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.close();
      if (error.code === "EADDRINUSE") resolve(undefined);
      else reject(error);
    });
    socket.bind(port, "127.0.0.1", () => resolve(socket));
  });

/** Whether a TCP server can listen on `port` at `host` (every address when undefined). */
const listenable = (port: number, host: string | undefined) =>
  new Promise<boolean>((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.listen(port, host, () => server.close(() => resolve(true)));
  });

/**
 * Reserves the first of `candidates` that no other reservation holds and no server listens on.
 * `candidates` defaults to every port of `RESERVED`.
 */
export const reservePort = async (
  candidates: Iterable<number> = everyPort(),
): Promise<PortReservation> => {
  for (const port of candidates) {
    const socket = await hold(port);
    if (socket === undefined) continue;
    // A server that takes no reservation, such as a developer's, may listen there. On macOS a bind
    // to every address and one to 127.0.0.1 each succeed while the other is held, so probe both.
    if (!(await listenable(port, undefined)) || !(await listenable(port, "127.0.0.1"))) {
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      continue;
    }
    let released: Promise<void> | undefined;
    return {
      port,
      release: () => (released ??= new Promise<void>((resolve) => socket.close(() => resolve()))),
    };
  }
  throw new Error(
    `No port in ${String(RESERVED.first)}–${String(RESERVED.last)} is free to reserve`,
  );
};
