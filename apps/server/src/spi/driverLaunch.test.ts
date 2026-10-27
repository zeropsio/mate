import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import { codexExecLaunchArgs, resolveCodexLaunchArgs } from "./driverLaunch.ts";

describe("resolveCodexLaunchArgs", () => {
  it("prefers the T3CODE_CODEX_LAUNCH_ARGS environment override over the configured value", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs("--strict-config", { T3CODE_CODEX_LAUNCH_ARGS: "--enable foo" }),
      "--enable foo",
    );
  });

  it("falls back to the configured launchArgs when the override is blank", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs("--strict-config", { T3CODE_CODEX_LAUNCH_ARGS: "   " }),
      "--strict-config",
    );
  });

  it("resolves to an empty string when neither source is set", () => {
    NodeAssert.equal(resolveCodexLaunchArgs(undefined, {}), "");
  });
});

describe("codexExecLaunchArgs", () => {
  it("keeps exec-valid flags and drops app-server-only flags", () => {
    NodeAssert.deepStrictEqual(
      codexExecLaunchArgs('--strict-config --enable foo --listen off --config model="gpt 5"'),
      ["--strict-config", "--enable", "foo", "--config", "model=gpt 5"],
    );
  });
});

describe("resolveCodexLaunchArgs + codexExecLaunchArgs (CodexTextGeneration's pipeline)", () => {
  it("threads a configured launchArgs value through to the exec-mode argv", () => {
    const resolved = resolveCodexLaunchArgs("--strict-config --enable foo", {});
    NodeAssert.deepStrictEqual(codexExecLaunchArgs(resolved), [
      "--strict-config",
      "--enable",
      "foo",
    ]);
  });

  it("an operator env override still only contributes exec-valid flags", () => {
    const resolved = resolveCodexLaunchArgs(undefined, {
      T3CODE_CODEX_LAUNCH_ARGS: "--listen off --disable bar",
    });
    NodeAssert.deepStrictEqual(codexExecLaunchArgs(resolved), ["--disable", "bar"]);
  });
});
