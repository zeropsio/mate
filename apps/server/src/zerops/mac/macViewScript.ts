/**
 * The Mac's live view helper: the node script the pairing writes to
 * `$ROOT/bin/view.mjs` and runs as the `io.zerops.mate.<project>.view`
 * LaunchAgent (see `macHostScript.ts`).
 *
 * It captures one app's window silently - `screencapture -x -o -l <window>`
 * raises nothing and plays no sound - as node, which the user already allowed
 * Screen Recording for agent-device. A process under the pairing's sshd has no
 * such grant, so the Mate never captures over ssh itself: it reads this
 * helper's stream through `curl --unix-socket` on one ssh connection.
 *
 * The socket lives in `$ROOT` (mode 700), so only the pairing user reaches it;
 * nothing listens on a network port.
 *
 * ## Wire
 *
 * `GET /stream?app=<bundle id or name>&fps=<n>` answers with messages for as
 * long as the client stays: each a JSON header line, then `size` bytes when the
 * header has them.
 * - `{"type":"frame","size","mimeType","width","height","bounds","inUse"}` then
 *   the image: `width`/`height` are its pixels, `bounds` the window's rect on
 *   screen in points (what agent-device presses).
 * - `{"type":"state","status":"no-app"|"no-window"|"no-capture","inUse"}`.
 * - `{"type":"tick","inUse"}`: nothing changed since the last frame.
 *
 * The source is plain JavaScript without template literals, so it sits in this
 * module's raw string unchanged; the tests import it as written to a file.
 *
 * @module macViewScript
 */

export const MAC_VIEW_SCRIPT = String.raw`// Zerops Mate's live view of one app window on this Mac. Written by the Mate's pairing.
import { execFile } from "node:child_process";
import { chmodSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Seconds since the last keyboard or mouse input after which the Mac counts as free (MacHost's MAC_IDLE_SECONDS). */
export const IDLE_SECONDS = 60;
const MAX_STREAMS = 4;
const MAX_SIDE = 1600;
// A window capture from a launchd job takes seconds on macOS (measured 2-6 s against 0.15 s
// from a terminal), so a step gets room before it counts as failed.
const STEP_TIMEOUT_MS = 12000;
const RESOLVE_EVERY_MS = 2000;
const RETRY_RESOLVE_MS = 1000;
const IDLE_EVERY_MS = 1000;

/** macOS's own tools, by absolute path: launchd's PATH is not the user's. A test points them at stubs. */
const tool = (name, real) =>
  process.env.ZEROPS_MATE_VIEW_TOOLS ? join(process.env.ZEROPS_MATE_VIEW_TOOLS, name) : real;

/** Finds the app (bundle id, name or .app path) and lists its windows, front to back. */
export const WINDOWS_JXA = [
  "ObjC.import('AppKit');",
  "ObjC.import('CoreGraphics');",
  "function run(argv) {",
  "  var wanted = argv[0];",
  "  var app = null;",
  "  var byId = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(wanted);",
  "  if (byId.count > 0) app = byId.objectAtIndex(0);",
  "  if (!app) {",
  "    var running = $.NSWorkspace.sharedWorkspace.runningApplications;",
  "    for (var i = 0; i < running.count; i++) {",
  "      var candidate = running.objectAtIndex(i);",
  "      var name = ObjC.unwrap(candidate.localizedName);",
  "      var path = candidate.bundleURL.isNil() ? '' : ObjC.unwrap(candidate.bundleURL.path);",
  "      if (name === wanted || path === wanted || name + '.app' === wanted) { app = candidate; break; }",
  "    }",
  "  }",
  "  if (!app) return JSON.stringify({ running: false, windows: [] });",
  "  var pid = app.processIdentifier;",
  "  var info = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, $.kCGNullWindowID))) || [];",
  "  var windows = [];",
  "  for (var j = 0; j < info.length; j++) {",
  "    var w = info[j];",
  "    if (w.kCGWindowOwnerPID !== pid || !w.kCGWindowBounds) continue;",
  "    windows.push({ number: w.kCGWindowNumber, layer: w.kCGWindowLayer, onscreen: !!w.kCGWindowIsOnscreen, alpha: w.kCGWindowAlpha === undefined ? 1 : w.kCGWindowAlpha,",
  "      bounds: { x: w.kCGWindowBounds.X, y: w.kCGWindowBounds.Y, width: w.kCGWindowBounds.Width, height: w.kCGWindowBounds.Height } });",
  "  }",
  "  return JSON.stringify({ running: true, windows: windows });",
  "}",
].join("\n");

/**
 * The window the view shows: the frontmost ordinary one (layer 0) the app has,
 * on screen before off it; tiny and invisible helper windows never count.
 */
export function pickWindow(windows) {
  const usable = (windows || []).filter(
    (w) =>
      w &&
      w.layer === 0 &&
      Number.isInteger(w.number) &&
      w.bounds &&
      w.bounds.width > 40 &&
      w.bounds.height > 40 &&
      (w.alpha === undefined || w.alpha > 0),
  );
  return usable.find((w) => w.onscreen) || usable[0];
}

/** A PNG's or JPEG's pixel size from its own header; undefined for anything else. */
export function imageSize(bytes) {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mimeType: "image/png" };
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame) {
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5), mimeType: "image/jpeg" };
    }
    at += 2 + length;
  }
  return undefined;
}

/** Seconds since the last keyboard or mouse input, from ioreg's HIDIdleTime (nanoseconds). */
export function idleSeconds(ioregOutput) {
  const match = /"HIDIdleTime" = (\d+)/.exec(ioregOutput || "");
  return match ? Math.floor(Number(match[1]) / 1e9) : undefined;
}

/**
 * Whether someone is working on the Mac: input inside the last minute that
 * came after the Mate's own last drive (its clicks are input too). The same
 * rule as the guard on mac device.
 */
export function userWorking(idle, nowSeconds, lastDriveSeconds) {
  if (idle === undefined || idle >= IDLE_SECONDS) return false;
  return nowSeconds - (lastDriveSeconds || 0) > idle + 2;
}

export function clampFps(value) {
  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0 ? Math.min(5, Math.max(0.2, fps)) : 2;
}

/** One message on the wire: a JSON header line, then the bytes it announces. */
export function message(header, bytes) {
  const line = Buffer.from(JSON.stringify(bytes ? { ...header, size: bytes.length } : header) + "\n");
  return bytes ? Buffer.concat([line, bytes]) : line;
}

const run = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: STEP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || "") });
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveWindow(app) {
  const result = await run(tool("osascript", "/usr/bin/osascript"), ["-l", "JavaScript", "-e", WINDOWS_JXA, app]);
  if (!result.ok) return { status: "no-app" };
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { status: "no-app" };
  }
  if (!parsed.running) return { status: "no-app" };
  const window = pickWindow(parsed.windows);
  return window ? { window } : { status: "no-window" };
}

async function capture(window, file) {
  const shot = await run(tool("screencapture", "/usr/sbin/screencapture"), ["-x", "-o", "-l", String(window.number), "-t", "jpg", file]);
  if (!shot.ok) return undefined;
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    return undefined;
  }
  let size = imageSize(bytes);
  if (size && Math.max(size.width, size.height) > MAX_SIDE) {
    await run(tool("sips", "/usr/bin/sips"), ["-Z", String(MAX_SIDE), file]);
    try {
      bytes = readFileSync(file);
      size = imageSize(bytes);
    } catch {
      return undefined;
    }
  }
  return size ? { bytes, size } : undefined;
}

function makeRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

let streams = 0;

async function stream(root, url, res) {
  const app = url.searchParams.get("app") || "";
  const interval = 1000 / clampFps(url.searchParams.get("fps"));
  const file = join(tmpdir(), "zerops-mate-view-" + process.pid + "-" + Math.random().toString(36).slice(2) + ".jpg");
  let open = true;
  res.on("close", () => {
    open = false;
  });
  res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
  let window;
  let resolvedAt = 0;
  let idleAt = 0;
  let inUse = false;
  let last;
  let failures = 0;
  let lastStatus;
  const send = (header, bytes) => {
    if (open) res.write(message({ ...header, inUse }, bytes));
  };
  try {
    while (open) {
      const started = Date.now();
      if (started - idleAt >= IDLE_EVERY_MS) {
        idleAt = started;
        let lastDrive = 0;
        try {
          lastDrive = Number(readFileSync(join(root, "last-drive"), "utf8").trim()) || 0;
        } catch {}
        inUse = userWorking(idleSeconds((await run(tool("ioreg", "/usr/sbin/ioreg"), ["-c", "IOHIDSystem"])).stdout), Math.floor(Date.now() / 1000), lastDrive);
      }
      if (started - resolvedAt >= (window === undefined ? RETRY_RESOLVE_MS : RESOLVE_EVERY_MS)) {
        resolvedAt = started;
        const resolved = await resolveWindow(app);
        window = resolved.window;
        if (window === undefined) {
          last = undefined;
          if (lastStatus !== resolved.status) send({ type: "state", status: resolved.status });
          else send({ type: "tick" });
          lastStatus = resolved.status;
        }
      }
      if (window !== undefined) {
        const shot = await capture(window, file);
        if (shot === undefined) {
          failures++;
          window = undefined;
          resolvedAt = 0;
          if (failures >= 3 && lastStatus !== "no-capture") {
            lastStatus = "no-capture";
            send({ type: "state", status: "no-capture" });
          } else send({ type: "tick" });
        } else {
          failures = 0;
          lastStatus = undefined;
          if (last !== undefined && last.equals(shot.bytes)) send({ type: "tick" });
          else {
            last = shot.bytes;
            send(
              { type: "frame", mimeType: shot.size.mimeType, width: shot.size.width, height: shot.size.height, bounds: window.bounds },
              shot.bytes,
            );
          }
        }
      }
      await sleep(Math.max(50, interval - (Date.now() - started)));
    }
  } finally {
    rmSync(file, { force: true });
  }
}

function main() {
  const root = makeRoot();
  const socket = join(root, "view.sock");
  rmSync(socket, { force: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://mate");
    if (req.method !== "GET" || url.pathname !== "/stream" || !url.searchParams.get("app")) {
      res.writeHead(404).end();
      return;
    }
    if (streams >= MAX_STREAMS) {
      res.writeHead(503).end();
      return;
    }
    streams++;
    stream(root, url, res)
      .catch(() => {})
      .finally(() => {
        streams--;
        res.end();
      });
  });
  server.listen(socket, () => chmodSync(socket, 0o600));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
`;
