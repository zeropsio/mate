import * as NodeAssert from "node:assert/strict";

import { CodexSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, it } from "vite-plus/test";

import {
  codexAppServerArgs,
  codexExecLaunchArgs,
  resolveCodexLaunchArgs,
} from "./codexLaunchArgs.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

describe("resolveCodexLaunchArgs", () => {
  it("uses T3CODE_CODEX_LAUNCH_ARGS before configured settings", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { T3CODE_CODEX_LAUNCH_ARGS: "--enable foo" }),
      "--enable foo",
    );
    NodeAssert.equal(
      resolveCodexLaunchArgs(decodeCodexSettings({ launchArgs: "--strict-config" }).launchArgs, {
        T3CODE_CODEX_LAUNCH_ARGS: "--enable foo",
      }),
      "--enable foo",
    );
  });

  it("uses configured settings when T3CODE_CODEX_LAUNCH_ARGS is empty", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { T3CODE_CODEX_LAUNCH_ARGS: "   " }),
      "--strict-config",
    );
    NodeAssert.equal(
      resolveCodexLaunchArgs(decodeCodexSettings({ launchArgs: "--strict-config" }).launchArgs, {
        T3CODE_CODEX_LAUNCH_ARGS: "   ",
      }),
      "--strict-config",
    );
  });
});

describe("codexAppServerArgs", () => {
  it("appends parsed launch args after app-server", () => {
    const settings = decodeCodexSettings({ launchArgs: "--strict-config --enable foo" });
    NodeAssert.deepStrictEqual(codexAppServerArgs(settings.launchArgs), [
      "app-server",
      "--strict-config",
      "--enable",
      "foo",
    ]);
  });
});

describe("codexExecLaunchArgs", () => {
  it("keeps shared codex flags and omits app-server-only flags", () => {
    const settings = decodeCodexSettings({
      launchArgs: '--strict-config --enable foo --listen off --config model="gpt 5"',
    });
    NodeAssert.deepStrictEqual(codexExecLaunchArgs(settings.launchArgs), [
      "--strict-config",
      "--enable",
      "foo",
      "--config",
      "model=gpt 5",
    ]);
  });

  it("does not pair value-taking flags with adjacent flags", () => {
    const settings = decodeCodexSettings({
      launchArgs: "--config --strict-config --enable --disable",
    });
    NodeAssert.deepStrictEqual(codexExecLaunchArgs(settings.launchArgs), ["--strict-config"]);
  });
});
