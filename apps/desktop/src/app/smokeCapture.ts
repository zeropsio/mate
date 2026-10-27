// @effect-diagnostics nodeBuiltinImport:off - The Electron capture boundary writes NativeImage PNG bytes to a host path.
import * as NodeFSP from "node:fs/promises";
import * as NodeProcess from "node:process";

import * as Effect from "effect/Effect";

const FONT_SETTLE_TIMEOUT_MS = 3_000;
const FONT_SETTLE_SCRIPT = "document.fonts.ready.then(() => undefined)";
const STREAM_WRITE_TIMEOUT_MS = 2_000;

interface SmokeCaptureWindow {
  readonly once: (eventName: "ready-to-show", listener: () => void) => unknown;
  readonly webContents: {
    readonly once: (eventName: "did-finish-load", listener: () => void) => unknown;
    readonly executeJavaScript: (script: string) => Promise<unknown>;
    readonly capturePage: () => Promise<{ readonly toPNG: () => Buffer }>;
  };
}

type ExitApp = (code: number) => void | Promise<unknown>;

function writeLine(stream: NodeJS.WriteStream, line: string): Promise<void> {
  const write = Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const finish = (error?: Error | null) => {
          if (error && (error as NodeJS.ErrnoException).code !== "EPIPE") {
            reject(error);
          } else {
            resolve();
          }
        };

        try {
          stream.write(line, finish);
        } catch (cause) {
          finish(cause instanceof Error ? cause : new Error(String(cause)));
        }
      }),
  );
  return Effect.runPromise(Effect.raceFirst(write, Effect.sleep(STREAM_WRITE_TIMEOUT_MS)));
}

async function settleRendererFonts(window: SmokeCaptureWindow): Promise<void> {
  const fontsReady = Effect.promise(() =>
    window.webContents.executeJavaScript(FONT_SETTLE_SCRIPT).then(
      () => undefined,
      () => undefined,
    ),
  );
  await Effect.runPromise(Effect.raceFirst(fontsReady, Effect.sleep(FONT_SETTLE_TIMEOUT_MS)));
}

async function captureAndExit(
  window: SmokeCaptureWindow,
  capturePath: string,
  exitApp: ExitApp,
): Promise<void> {
  let exitCode = 0;
  try {
    await settleRendererFonts(window);
    const image = await window.webContents.capturePage();
    await NodeFSP.writeFile(capturePath, image.toPNG());
  } catch (cause) {
    exitCode = 1;
    const message = cause instanceof Error ? cause.message : String(cause);
    await writeLine(NodeProcess.stderr, `smoke capture failed: ${message}\n`).catch(
      () => undefined,
    );
  }
  if (exitCode === 0) {
    await writeLine(NodeProcess.stdout, `smoke capture written: ${capturePath}\n`).catch(
      () => undefined,
    );
  }

  try {
    await exitApp(exitCode);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await writeLine(NodeProcess.stderr, `smoke capture exit failed: ${message}\n`).catch(
      () => undefined,
    );
  }
}

// The promise is returned only so tests can await capture completion; the
// production caller intentionally lets Electron own the process lifecycle.
export function installSmokeCapture(
  window: SmokeCaptureWindow,
  exitApp: ExitApp,
): Promise<void> | undefined {
  const capturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
  if (capturePath === undefined || capturePath.length === 0) {
    return undefined;
  }

  let started = false;
  let complete: () => void = () => undefined;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const startCapture = () => {
    if (started) {
      return;
    }
    started = true;
    void captureAndExit(window, capturePath, exitApp).finally(complete);
  };

  window.webContents.once("did-finish-load", () => {
    startCapture();
  });
  window.once("ready-to-show", () => {
    startCapture();
  });

  return completion;
}
