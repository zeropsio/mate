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
  afterEach(() => {
    for (const child of running.splice(0)) child.kill();
  });

  /** Runs the helper as its LaunchAgent would, with macOS's tools replaced by stubs. */
  const startHelper = (tools: Record<string, string>) => {
    const { root, file } = installed();
    const bin = tempDir("mac-view-tools-");
    for (const [name, body] of Object.entries(tools)) {
      NodeFS.writeFileSync(NodePath.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const child = NodeChildProcess.spawn(process.execPath, [file], {
      env: { PATH: "/usr/bin:/bin", ZEROPS_MATE_VIEW_TOOLS: bin },
      stdio: "ignore",
    });
    running.push(child);
    return { root, socket: NodePath.join(root, "view.sock") };
  };

  /** Reads messages off the stream until `enough` says so, then hangs up. */
  const read = async (
    socket: string,
    enough: (messages: ReadonlyArray<MacViewMessage>) => boolean,
  ): Promise<ReadonlyArray<MacViewMessage>> => {
    for (let attempt = 0; attempt < 100 && !NodeFS.existsSync(socket); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return new Promise((resolve, reject) => {
      const parser = makeMacViewParser();
      const messages: MacViewMessage[] = [];
      const request = NodeHttp.get(
        { socketPath: socket, path: "/stream?app=com.example.Counter&fps=5" },
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
