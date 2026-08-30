// @effect-diagnostics nodeBuiltinImport:off - The smoke-mode branch must drain host stderr.
import * as NodeProcess from "node:process";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { DesktopWebBundleMissingError, handleFatalStartupError } from "./DesktopApp.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";

describe("DesktopApp errors", () => {
  it("reports the missing hosted-static web bundle", () => {
    const error = new DesktopWebBundleMissingError();

    assert.equal(
      error.message,
      "Could not locate the staged hosted-static web bundle (resources/web/index.html) next to the desktop app.",
    );
  });

  const fatalErrorRows = [
    {
      name: "normal startup",
      smokeCapturePath: undefined,
      expectedDialogCount: 1,
      expectedQuitCount: 1,
      expectedExitCodes: [] as number[],
      expectedStderrCount: 0,
    },
    {
      name: "smoke capture startup",
      smokeCapturePath: "/tmp/desktop-smoke.png",
      expectedDialogCount: 0,
      expectedQuitCount: 0,
      expectedExitCodes: [1],
      expectedStderrCount: 1,
    },
  ] as const;

  for (const {
    name,
    smokeCapturePath,
    expectedDialogCount,
    expectedQuitCount,
    expectedExitCodes,
    expectedStderrCount,
  } of fatalErrorRows) {
    it.effect(`handles a fatal error during ${name}`, () =>
      Effect.gen(function* () {
        const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
        if (smokeCapturePath === undefined) {
          delete NodeProcess.env.T3CODE_SMOKE_CAPTURE;
        } else {
          NodeProcess.env.T3CODE_SMOKE_CAPTURE = smokeCapturePath;
        }

        const dialogCalls: Array<readonly [string, string]> = [];
        let quitCount = 0;
        const exitCodes: number[] = [];
        const stderrLines: string[] = [];
        const stderrWrite = vi.spyOn(NodeProcess.stderr, "write").mockImplementation(((
          chunk: unknown,
          ...args: readonly unknown[]
        ) => {
          stderrLines.push(String(chunk));
          const callback = args.find((arg) => typeof arg === "function") as
            | (() => void)
            | undefined;
          callback?.();
          return true;
        }) as typeof NodeProcess.stderr.write);
        const layer = Layer.mergeAll(
          DesktopShutdown.layer,
          DesktopState.layer,
          Layer.mock(ElectronApp.ElectronApp)({
            quit: Effect.sync(() => {
              quitCount += 1;
            }),
            exit: (code) =>
              Effect.sync(() => {
                exitCodes.push(code);
              }),
          }),
          Layer.mock(ElectronDialog.ElectronDialog)({
            showErrorBox: (title, content) =>
              Effect.sync(() => {
                dialogCalls.push([title, content]);
              }),
          }),
        );

        try {
          yield* handleFatalStartupError("bootstrap", new Error("bundle unavailable")).pipe(
            Effect.provide(layer),
          );

          assert.equal(dialogCalls.length, expectedDialogCount);
          assert.equal(quitCount, expectedQuitCount);
          assert.deepEqual(exitCodes, expectedExitCodes);
          assert.equal(stderrLines.length, expectedStderrCount);
          if (stderrLines.length > 0) {
            assert.include(stderrLines[0], "fatal startup error (bootstrap): bundle unavailable");
          }
        } finally {
          stderrWrite.mockRestore();
          if (previousCapturePath === undefined) {
            delete NodeProcess.env.T3CODE_SMOKE_CAPTURE;
          } else {
            NodeProcess.env.T3CODE_SMOKE_CAPTURE = previousCapturePath;
          }
        }
      }),
    );
  }
});
