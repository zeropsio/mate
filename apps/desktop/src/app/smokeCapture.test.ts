// @effect-diagnostics nodeBuiltinImport:off - Tests exercise host-side capture files and process output.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { installSmokeCapture } from "./smokeCapture.ts";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeFakeWindow() {
  const windowListeners = new Map<string, () => void>();
  const webContentsListeners = new Map<string, () => void>();
  const capturePage = vi.fn(async () => ({
    toPNG: () => PNG_BYTES,
  }));
  const executeJavaScript = vi.fn(async () => undefined as unknown);

  return {
    window: {
      once: (eventName: string, listener: () => void) => {
        windowListeners.set(eventName, listener);
      },
      webContents: {
        once: (eventName: string, listener: () => void) => {
          webContentsListeners.set(eventName, listener);
        },
        capturePage,
        executeJavaScript,
      },
    },
    capturePage,
    executeJavaScript,
    emit: (eventName: "did-finish-load" | "ready-to-show") => {
      if (eventName === "did-finish-load") {
        webContentsListeners.get(eventName)?.();
        return;
      }
      windowListeners.get(eventName)?.();
    },
  };
}

function restoreCapturePath(previousCapturePath: string | undefined) {
  if (previousCapturePath === undefined) {
    delete NodeProcess.env.T3CODE_SMOKE_CAPTURE;
  } else {
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = previousCapturePath;
  }
}

describe("installSmokeCapture", () => {
  it.each([
    { name: "did-finish-load alone", events: ["did-finish-load"] as const },
    { name: "ready-to-show alone", events: ["ready-to-show"] as const },
    {
      name: "did-finish-load then ready-to-show",
      events: ["did-finish-load", "ready-to-show"] as const,
    },
    {
      name: "ready-to-show then did-finish-load",
      events: ["ready-to-show", "did-finish-load"] as const,
    },
    {
      name: "duplicate events",
      events: ["did-finish-load", "did-finish-load", "ready-to-show", "ready-to-show"] as const,
    },
  ])("captures once after $name", async ({ events }) => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      for (const eventName of events) {
        fake.emit(eventName);
      }
      await completion;

      assert.equal(fake.executeJavaScript.mock.calls.length, 1);
      assert.equal(fake.capturePage.mock.calls.length, 1);
      assert.deepEqual(await NodeFSP.readFile(capturePath), PNG_BYTES);
      assert.deepEqual(exit.mock.calls, [[0]]);
    } finally {
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it.each([
    { name: "unset", value: undefined },
    { name: "empty", value: "" },
  ])("does nothing when the capture environment variable is $name", ({ value }) => {
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    if (value === undefined) {
      delete NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    } else {
      NodeProcess.env.T3CODE_SMOKE_CAPTURE = value;
    }

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);

      assert.isUndefined(installSmokeCapture(fake.window, exit));
      fake.emit("did-finish-load");
      fake.emit("ready-to-show");

      assert.equal(fake.executeJavaScript.mock.calls.length, 0);
      assert.equal(fake.capturePage.mock.calls.length, 0);
      assert.equal(exit.mock.calls.length, 0);
    } finally {
      restoreCapturePath(previousCapturePath);
    }
  });

  it("caps renderer font settling at three seconds", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;
    vi.useFakeTimers();

    try {
      const fake = makeFakeWindow();
      fake.executeJavaScript.mockImplementation(() => new Promise(() => undefined));
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await vi.advanceTimersByTimeAsync(2_999);
      assert.equal(fake.capturePage.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(1);
      await completion;

      assert.equal(fake.capturePage.mock.calls.length, 1);
      assert.deepEqual(exit.mock.calls, [[0]]);
    } finally {
      vi.useRealTimers();
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it("exits non-zero when page capture rejects", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;

    try {
      const fake = makeFakeWindow();
      fake.capturePage.mockRejectedValue(new Error("capture boom"));
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await completion;

      assert.deepEqual(exit.mock.calls, [[1]]);
      assert.isFalse(
        await NodeFSP.access(capturePath).then(
          () => true,
          () => false,
        ),
      );
    } finally {
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it("exits non-zero when the capture file cannot be written", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "missing", "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await completion;

      assert.deepEqual(exit.mock.calls, [[1]]);
      assert.isFalse(
        await NodeFSP.access(capturePath).then(
          () => true,
          () => false,
        ),
      );
    } finally {
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it("waits for the stdout write callback before exiting", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;
    let releaseWrite: (() => void) | undefined;
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const stdoutWrite = vi.spyOn(NodeProcess.stdout, "write").mockImplementation(((
      _chunk: unknown,
      ...args: readonly unknown[]
    ) => {
      releaseWrite = args.find((arg) => typeof arg === "function") as (() => void) | undefined;
      markWriteStarted?.();
      return true;
    }) as typeof NodeProcess.stdout.write);

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await writeStarted;
      assert.equal(exit.mock.calls.length, 0);

      releaseWrite?.();
      await completion;
      assert.deepEqual(exit.mock.calls, [[0]]);
    } finally {
      stdoutWrite.mockRestore();
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it("bounds a stdout write that never acknowledges", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;
    vi.useFakeTimers();
    let markWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const stdoutWrite = vi.spyOn(NodeProcess.stdout, "write").mockImplementation((() => {
      markWriteStarted?.();
      return true;
    }) as typeof NodeProcess.stdout.write);

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await writeStarted;
      await vi.advanceTimersByTimeAsync(1_999);
      assert.equal(exit.mock.calls.length, 0);
      await vi.advanceTimersByTimeAsync(1);

      assert.deepEqual(exit.mock.calls, [[0]]);
      await completion;
      assert.deepEqual(await NodeFSP.readFile(capturePath), PNG_BYTES);
    } finally {
      stdoutWrite.mockRestore();
      vi.useRealTimers();
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });

  it("treats EPIPE on the capture log as written", async () => {
    const tempDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-smoke-capture-"));
    const capturePath = NodePath.join(tempDir, "smoke.png");
    const previousCapturePath = NodeProcess.env.T3CODE_SMOKE_CAPTURE;
    NodeProcess.env.T3CODE_SMOKE_CAPTURE = capturePath;
    const brokenPipe = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    const stdoutWrite = vi.spyOn(NodeProcess.stdout, "write").mockImplementation(((
      _chunk: unknown,
      ...args: readonly unknown[]
    ) => {
      const callback = args.find((arg) => typeof arg === "function") as
        | ((error?: Error | null) => void)
        | undefined;
      callback?.(brokenPipe);
      return false;
    }) as typeof NodeProcess.stdout.write);

    try {
      const fake = makeFakeWindow();
      const exit = vi.fn(async () => undefined);
      const completion = installSmokeCapture(fake.window, exit);
      assert.isDefined(completion);

      fake.emit("did-finish-load");
      await completion;

      assert.deepEqual(exit.mock.calls, [[0]]);
      assert.deepEqual(await NodeFSP.readFile(capturePath), PNG_BYTES);
    } finally {
      stdoutWrite.mockRestore();
      restoreCapturePath(previousCapturePath);
      await NodeFSP.rm(tempDir, { recursive: true });
    }
  });
});
