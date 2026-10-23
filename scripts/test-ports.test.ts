// @effect-diagnostics nodeBuiltinImport:off -- host-only test of port reservations.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import { expect, it } from "vite-plus/test";
import { RESERVED, reservePort } from "./test-ports.ts";

const helper = new URL("./test-ports.ts", import.meta.url).href;

/** `port` first, then every reservable port in order. */
const startingAt = function* (port: number) {
  yield port;
  for (let candidate = RESERVED.first; candidate <= RESERVED.last; candidate++) yield candidate;
};

const execFile = (file: string, args: ReadonlyArray<string>) =>
  new Promise<string>((resolve, reject) =>
    NodeChildProcess.execFile(file, args, (error, stdout) =>
      error === null ? resolve(stdout) : reject(error),
    ),
  );

/** The lowest port the kernel hands out for port 0 and outgoing connections. */
const ephemeralFirst = async () =>
  Number(
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Host-only test reads the host kernel it runs on.
    process.platform === "darwin"
      ? await execFile("sysctl", ["-n", "net.inet.ip.portrange.first"])
      : NodeFS.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8")
          .trim()
          .split(/\s+/u)[0],
  );

it("Reserved ports lie below this host's ephemeral range, so neither port 0 nor an outgoing connection is handed one", async () => {
  expect(RESERVED.last).toBeLessThan(await ephemeralFirst());
});

it("Two reservations held at once never share a port, even when both try the same port first", async () => {
  const first = await reservePort();
  try {
    const second = await reservePort(startingAt(first.port));
    try {
      expect(second.port).not.toBe(first.port);
    } finally {
      await second.release();
    }
  } finally {
    await first.release();
  }
});

it.each([
  { title: "every address", host: undefined },
  { title: "127.0.0.1", host: "127.0.0.1" },
])(
  "A reservation passes over a port a live server without a reservation listens on at $title",
  async ({ host }) => {
    const taken = await reservePort();
    const server = NodeNet.createServer();
    await new Promise<void>((resolve) => server.listen(taken.port, host, resolve));
    await taken.release();
    try {
      const next = await reservePort(startingAt(taken.port));
      try {
        expect(next.port).not.toBe(taken.port);
      } finally {
        await next.release();
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.each([
  {
    title: "its reservation is released",
    end: async () => {
      const reservation = await reservePort();
      await reservation.release();
      return reservation.port;
    },
  },
  {
    title: "the process that held it ends without releasing it",
    end: async () =>
      Number(
        await execFile(process.execPath, [
          "--input-type=module",
          "-e",
          `import { reservePort } from ${JSON.stringify(helper)};
           console.log((await reservePort()).port);
           process.exit(0);`,
        ]),
      ),
  },
])("A port can be reserved again once $title", async ({ end }) => {
  const port = await end();
  const again = await reservePort([port]);
  expect(again.port).toBe(port);
  await again.release();
});
