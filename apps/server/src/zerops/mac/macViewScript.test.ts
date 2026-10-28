// @effect-diagnostics nodeBuiltinImport:off globalTimers:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as JpegJs from "jpeg-js";
import { PNG } from "pngjs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { MAC_VIEW_SCRIPT } from "./macViewScript.ts";
import { MAC_VIEW_STREAM_SOURCE } from "./macViewStreamScript.ts";
import { makeMacViewParser, type MacViewMessage } from "./macViewWire.ts";

interface ViewModule {
  readonly pickWindow: (windows: unknown) => { readonly number: number } | undefined;
  readonly imageSize: (
    bytes: Buffer,
  ) => { readonly width: number; readonly height: number; readonly mimeType: string } | undefined;
  readonly idleSeconds: (ioreg: string) => number | undefined;
  readonly userWorking: (idle: number | undefined, now: number, lastDrive: number) => boolean;
}

const scratch: string[] = [];
const tempDir = (prefix: string) => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

/** The helper as the pairing leaves it on the Mac: `$ROOT/bin/view.mjs`. */
const installed = () => {
  const root = tempDir("mac-view-root-");
  NodeFS.mkdirSync(NodePath.join(root, "bin"));
  const file = NodePath.join(root, "bin", "view.mjs");
  NodeFS.writeFileSync(file, MAC_VIEW_SCRIPT);
  return { root, file };
};

let view: ViewModule;
beforeAll(async () => {
  view = (await import(NodeURL.pathToFileURL(installed().file).href)) as ViewModule;
});
afterAll(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const jpeg = (width: number, height: number) =>
  Buffer.from(
    JpegJs.encode({ data: Buffer.alloc(width * height * 4, 200), width, height }, 80).data,
  );

describe("the Mac's view helper", () => {
  it("is a script node runs as written", () => {
    const check = NodeChildProcess.spawnSync(process.execPath, ["--check", installed().file], {
      encoding: "utf8",
    });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  const window = (overrides: Record<string, unknown>) => ({
    number: 7,
    layer: 0,
    onscreen: true,
    alpha: 1,
    bounds: { x: 0, y: 0, width: 400, height: 300 },
    ...overrides,
  });

  it.each([
    ["the frontmost window on screen", [window({ number: 3 }), window({ number: 4 })], 3],
    [
      "an ordinary window over a menu or a panel",
      [window({ number: 1, layer: 25 }), window({ number: 2 })],
      2,
    ],
    [
      "a window on screen over one off it",
      [window({ number: 1, onscreen: false }), window({ number: 2 })],
      2,
    ],
    [
      "a window over a tiny or invisible helper",
      [
        window({ number: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }),
        window({ number: 2, alpha: 0 }),
        window({ number: 3 }),
      ],
      3,
    ],
    ["a window off screen when it has no other", [window({ number: 5, onscreen: false })], 5],
  ])("shows %s", (_, windows, number) => {
    expect(view.pickWindow(windows)?.number).toBe(number);
  });

  it("has no window to show for an app with only menus and helpers", () => {
    expect(view.pickWindow([window({ layer: 25 })])).toBeUndefined();
    expect(view.pickWindow([])).toBeUndefined();
  });

  it("reads a capture's pixel size from the image itself", () => {
    const png = new PNG({ width: 46, height: 81 });
    expect(view.imageSize(jpeg(46, 81))).toEqual({
      width: 46,
      height: 81,
      mimeType: "image/jpeg",
    });
    expect(view.imageSize(PNG.sync.write(png))).toEqual({
      width: 46,
      height: 81,
      mimeType: "image/png",
    });
    expect(view.imageSize(Buffer.from("not an image"))).toBeUndefined();
  });

  it.each([
    ["input 3 s ago", 3, 0, true],
    ["no input for two minutes", 120, 0, false],
    ["only the input of the Mate's own click a second ago", 1, 1, false],
    ["input after the Mate's own click 30 s ago", 3, 30, true],
    ["no idle time to read", undefined, 0, false],
  ] as const)("counts the Mac as in use with %s: %s", (_, idle, droveAgo, working) => {
    const now = 1_000_000;
    expect(view.userWorking(idle, now, droveAgo === 0 ? 0 : now - droveAgo)).toBe(working);
  });

  it("reads seconds since the last input from ioreg", () => {
    expect(view.idleSeconds('    |   "HIDIdleTime" = 4200000000\n')).toBe(4);
    expect(view.idleSeconds("")).toBeUndefined();
  });
});

describe("the view helper's stream", () => {
  const running: NodeChildProcess.ChildProcess[] = [];
  const watched: NodeFS.FSWatcher[] = [];
  afterEach(() => {
    for (const watcher of watched.splice(0)) watcher.close();
    for (const child of running.splice(0)) child.kill();
  });

  /** Observe a filesystem receipt; subscribe before starting its writer. */
  const written = (file: string, ready: (file: string) => boolean = () => true) =>
    new Promise<string>((resolve, reject) => {
      const changed = NodeFS.watch(NodePath.dirname(file), () => inspect());
      watched.push(changed);
      const inspect = () => {
        if (!NodeFS.existsSync(file) || !ready(file)) return;
        changed.close();
        resolve(file);
      };
      changed.once("error", (error) => {
        changed.close();
        reject(error);
      });
      inspect();
    });

  /**
   * Runs the helper as its LaunchAgent would, with macOS's tools replaced by stubs, and with the
   * smooth streamer the pairing builds when `streamer` gives a stub for it.
   */
  const startHelper = (tools: Record<string, string>, streamer?: string) => {
    const { root, file } = installed();
    if (streamer !== undefined) {
      NodeFS.writeFileSync(NodePath.join(root, "bin", "view-stream"), `#!/bin/sh\n${streamer}\n`, {
        mode: 0o755,
      });
    }
    const bin = tempDir("mac-view-tools-");
    for (const [name, body] of Object.entries(tools)) {
      NodeFS.writeFileSync(NodePath.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    // The socket starts at 0700 under this child's umask. The helper chmods it to 0600
    // only inside its listen callback, so a bound path alone cannot admit the request.
    const socket = written(
      NodePath.join(root, "view.sock"),
      (path) => (NodeFS.statSync(path).mode & 0o777) === 0o600,
    );
    const child = NodeChildProcess.spawn(
      process.execPath,
      ["--import", "data:text/javascript,process.umask(0o077)", file],
      {
        env: { PATH: "/usr/bin:/bin", ZEROPS_MATE_VIEW_TOOLS: bin },
        stdio: "ignore",
      },
    );
    running.push(child);
    return { root, socket };
  };

  /** Reads messages off the stream until `enough` says so, then hangs up. */
  const read = async (
    socket: Promise<string>,
    enough: (messages: ReadonlyArray<MacViewMessage>) => boolean,
    fps = 5,
  ): Promise<ReadonlyArray<MacViewMessage>> => {
    const socketPath = await socket;
    return new Promise((resolve, reject) => {
      const parser = makeMacViewParser();
      const messages: MacViewMessage[] = [];
      const request = NodeHttp.get(
        { socketPath, path: `/stream?app=com.example.Counter&fps=${fps}` },
        (response) => {
          response.on("data", (chunk: Buffer) => {
            messages.push(...parser.push(chunk));
            if (enough(messages)) {
              request.destroy();
              resolve(messages);
            }
          });
        },
      );
      request.on("error", reject);
    });
  };

  it("streams the app's window with its size and place on screen, and whether the Mac is in use", async () => {
    const image = tempDir("mac-view-image-");
    const capture = NodePath.join(image, "window.jpg");
    NodeFS.writeFileSync(capture, jpeg(460, 816));
    const { socket } = startHelper({
      osascript: `echo '{"running":true,"windows":[{"number":42,"layer":0,"onscreen":true,"alpha":1,"bounds":{"x":100,"y":50,"width":230,"height":408}}]}'`,
      // screencapture -x -o -l <window> -t jpg <file>
      screencapture: `[ "$4" = 42 ] && cp '${capture}' "$7"`,
      ioreg: `echo '    |   "HIDIdleTime" = 3000000000'`,
      sips: "exit 0",
    });

    const messages = await read(socket, (all) => all.some((m) => m.type === "frame"));

    const frame = messages.find((m) => m.type === "frame");
    expect(frame).toMatchObject({
      type: "frame",
      mimeType: "image/jpeg",
      width: 460,
      height: 816,
      bounds: { x: 100, y: 50, width: 230, height: 408 },
      inUse: true,
    });
    expect(Buffer.from(frame?.type === "frame" ? frame.bytes : []).equals(jpeg(460, 816))).toBe(
      true,
    );
  });

  /** The streamer's wire: a JSON header line, then the bytes it announces; no in-use flag. */
  const streamerSays = (header: object, file?: string) =>
    file === undefined
      ? `printf '%s\\n' '${JSON.stringify(header)}'`
      : `printf '%s\\n' '${JSON.stringify({ ...header, size: NodeFS.statSync(file).size })}'; cat '${file}'`;

  const counterWindow = {
    osascript: `echo '{"running":true,"windows":[{"number":42,"layer":0,"onscreen":true,"alpha":1,"bounds":{"x":100,"y":50,"width":230,"height":408}}]}'`,
    ioreg: `echo '    |   "HIDIdleTime" = 3000000000'`,
    sips: "exit 0",
  };

  it("streams the app's window through the smooth streamer when the pairing built one", async () => {
    const image = tempDir("mac-view-image-");
    const capture = NodePath.join(image, "window.jpg");
    NodeFS.writeFileSync(capture, jpeg(460, 816));
    const { socket } = startHelper(
      { ...counterWindow, screencapture: "exit 1" },
      [
        `echo "$@" > '${NodePath.join(image, "arguments")}'`,
        streamerSays({ type: "state", status: "no-window" }),
        streamerSays(
          {
            type: "frame",
            mimeType: "image/jpeg",
            width: 460,
            height: 816,
            bounds: { x: 100, y: 50, width: 230, height: 408 },
          },
          capture,
        ),
        `while :; do ${streamerSays({ type: "tick" })}; sleep 1; done`,
      ].join("\n"),
    );

    const messages = await read(socket, (all) => all.some((m) => m.type === "frame"), 12);

    expect(messages[0]).toEqual({ type: "state", status: "no-window", inUse: true });
    const frame = messages.find((m) => m.type === "frame");
    expect(frame).toMatchObject({
      type: "frame",
      mimeType: "image/jpeg",
      width: 460,
      height: 816,
      bounds: { x: 100, y: 50, width: 230, height: 408 },
      inUse: true,
    });
    expect(Buffer.from(frame?.type === "frame" ? frame.bytes : []).equals(jpeg(460, 816))).toBe(
      true,
    );
    expect(NodeFS.readFileSync(NodePath.join(image, "arguments"), "utf8")).toBe(
      "com.example.Counter 12 1600\n",
    );
  });

  it.each([
    ["macOS refuses the smooth streamer the capture", "exit 77"],
    ["the smooth streamer talks nonsense", "echo 'Segmentation fault'; sleep 5"],
  ])("falls back to its own capture when %s", async (_, streamer) => {
    const image = tempDir("mac-view-image-");
    const capture = NodePath.join(image, "window.jpg");
    NodeFS.writeFileSync(capture, jpeg(46, 81));
    const { socket } = startHelper(
      { ...counterWindow, screencapture: `[ "$4" = 42 ] && cp '${capture}' "$7"` },
      streamer,
    );

    const messages = await read(socket, (all) => all.some((m) => m.type === "frame"));

    expect(messages.find((m) => m.type === "frame")).toMatchObject({
      width: 46,
      height: 81,
      bounds: { x: 100, y: 50, width: 230, height: 408 },
    });
  });

  it("stops the smooth streamer when the Mate hangs up", async () => {
    const image = tempDir("mac-view-image-");
    const stoppedFile = NodePath.join(image, "stopped");
    // Rename makes the exit receipt visible only once its complete contents have been written.
    const stopped = written(stoppedFile);
    // An open message port keeps the stub alive until the helper's SIGTERM; no timer drives it.
    const streamer = `exec '${process.execPath}' -e '
      const { writeFileSync, renameSync } = require("node:fs");
      const { MessageChannel } = require("node:worker_threads");
      const { port1 } = new MessageChannel();
      port1.on("message", () => {});
      process.on("exit", () => {
        const stopped = ${JSON.stringify(stoppedFile)};
        writeFileSync(stopped + ".tmp", "stopped");
        renameSync(stopped + ".tmp", stopped);
      });
      process.on("SIGTERM", () => process.exit(0));
      process.stdout.write(${JSON.stringify(JSON.stringify({ type: "tick" }) + "\n")});
    '`;
    const { socket } = startHelper({ ...counterWindow, screencapture: "exit 1" }, streamer);

    await read(socket, (all) => all.length > 0);
    await stopped;
    expect(NodeFS.readFileSync(stoppedFile, "utf8")).toBe("stopped");
  });

  it("says when the app is not running", async () => {
    const { socket } = startHelper({
      osascript: `echo '{"running":false,"windows":[]}'`,
      screencapture: "exit 1",
      ioreg: `echo '    |   "HIDIdleTime" = 300000000000'`,
      sips: "exit 0",
    });

    const messages = await read(socket, (all) => all.length > 0);

    expect(messages[0]).toEqual({ type: "state", status: "no-app", inUse: false });
  });
});

/** Apple's Swift compiler, without offering to install it on a Mac that lacks it; Linux has neither tool. */
const hasSwiftCompiler =
  NodeChildProcess.spawnSync("xcode-select", ["-p"]).status === 0 &&
  NodeChildProcess.spawnSync("xcrun", ["--find", "swiftc"]).status === 0;

describe("the Mac's smooth streamer", () => {
  it.runIf(hasSwiftCompiler)(
    "compiles as the pairing writes it (a Mac with Apple's command line tools only; skipped on Linux CI)",
    () => {
      const dir = tempDir("mac-view-stream-");
      const source = NodePath.join(dir, "view-stream.swift");
      NodeFS.writeFileSync(source, MAC_VIEW_STREAM_SOURCE);
      const build = NodeChildProcess.spawnSync(
        "xcrun",
        ["swiftc", "-O", "-o", NodePath.join(dir, "view-stream"), source],
        { encoding: "utf8" },
      );
      expect(build.stderr).toBe("");
      expect(build.status).toBe(0);
    },
    120_000,
  );
});

describe("reading the view helper's stream", () => {
  const encode = (header: object, bytes?: Uint8Array) => {
    const line = new TextEncoder().encode(
      `${JSON.stringify(bytes ? { ...header, size: bytes.length } : header)}\n`,
    );
    const out = new Uint8Array(line.length + (bytes?.length ?? 0));
    out.set(line);
    if (bytes) out.set(bytes, line.length);
    return out;
  };
  const frameHeader = {
    type: "frame",
    mimeType: "image/jpeg",
    width: 4,
    height: 2,
    bounds: { x: 1, y: 2, width: 2, height: 1 },
    inUse: false,
  };

  it("takes whole messages out of chunks split anywhere", () => {
    const wire = new Uint8Array([
      ...encode({ type: "state", status: "no-window", inUse: true }),
      ...encode(frameHeader, new Uint8Array([1, 2, 3])),
      ...encode({ type: "tick", inUse: false }),
    ]);
    for (let cut = 1; cut < wire.length; cut += 7) {
      const parser = makeMacViewParser();
      const messages = [...parser.push(wire.slice(0, cut)), ...parser.push(wire.slice(cut))];
      expect(messages).toEqual([
        { type: "state", status: "no-window", inUse: true },
        { ...frameHeader, size: 3, bytes: new Uint8Array([1, 2, 3]) },
        { type: "tick", inUse: false },
      ]);
    }
  });

  it.each([
    ["an error page", "<html>502 Bad Gateway</html>\n"],
    ["a header it does not know", '{"type":"party"}\n'],
    ["a frame without bytes", `${JSON.stringify({ ...frameHeader, size: 0 })}\n`],
  ])("stops reading at %s", (_, text) => {
    const parser = makeMacViewParser();
    expect(parser.push(new TextEncoder().encode(text))).toEqual([]);
    expect(parser.broken).toBe(true);
  });
});
