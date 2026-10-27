// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, afterEach, beforeEach, describe, it } from "vite-plus/test";

import { loadFixture } from "./loader.ts";

describe("loadFixture", () => {
  let dir: string;

  beforeEach(() => {
    dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "spi-loader-test-"));
  });

  afterEach(() => {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, jsonlLines: ReadonlyArray<string>, meta: Record<string, unknown>) {
    NodeFS.writeFileSync(NodePath.join(dir, `${name}.jsonl`), `${jsonlLines.join("\n")}\n`, "utf8");
    NodeFS.writeFileSync(
      NodePath.join(dir, `${name}.meta.json`),
      `${JSON.stringify(meta, null, 2)}\n`,
      "utf8",
    );
  }

  it("parses message and control lines in arrival order", () => {
    write(
      "basic",
      [
        JSON.stringify({ kind: "message", message: { type: "assistant", text: "hi" } }),
        JSON.stringify({
          kind: "control",
          name: "canUseTool",
          args: { toolName: "Foo" },
          answer: { ok: true },
        }),
      ],
      { driver: "claude", synthetic: true },
    );

    const fixture = loadFixture(dir, "basic");

    assert.equal(fixture.name, "basic");
    assert.equal(fixture.dir, dir);
    assert.equal(fixture.meta.driver, "claude");
    assert.equal(fixture.meta.synthetic, true);
    assert.equal(fixture.lines.length, 2);
    assert.deepEqual(fixture.lines[0], {
      kind: "message",
      message: { type: "assistant", text: "hi" },
    });
    assert.deepEqual(fixture.lines[1], {
      kind: "control",
      name: "canUseTool",
      args: { toolName: "Foo" },
      answer: { ok: true },
    });
  });

  it("skips blank lines", () => {
    NodeFS.writeFileSync(
      NodePath.join(dir, "blanks.jsonl"),
      `${JSON.stringify({ kind: "message", message: {} })}\n\n\n`,
      "utf8",
    );
    NodeFS.writeFileSync(
      NodePath.join(dir, "blanks.meta.json"),
      JSON.stringify({ driver: "codex" }),
      "utf8",
    );

    const fixture = loadFixture(dir, "blanks");
    assert.equal(fixture.lines.length, 1);
  });

  it("throws naming the file and line number on invalid JSON", () => {
    NodeFS.writeFileSync(NodePath.join(dir, "bad.jsonl"), "not json\n", "utf8");
    NodeFS.writeFileSync(
      NodePath.join(dir, "bad.meta.json"),
      JSON.stringify({ driver: "codex" }),
      "utf8",
    );

    assert.throws(() => loadFixture(dir, "bad"), /bad\.jsonl:1/);
  });

  it("throws when a line has neither message nor control kind", () => {
    NodeFS.writeFileSync(
      NodePath.join(dir, "unknown-kind.jsonl"),
      `${JSON.stringify({ kind: "mystery" })}\n`,
      "utf8",
    );
    NodeFS.writeFileSync(
      NodePath.join(dir, "unknown-kind.meta.json"),
      JSON.stringify({ driver: "codex" }),
      "utf8",
    );

    assert.throws(() => loadFixture(dir, "unknown-kind"), /unknown kind/);
  });

  it("throws when meta.json is missing the driver field", () => {
    NodeFS.writeFileSync(NodePath.join(dir, "no-driver.jsonl"), "", "utf8");
    NodeFS.writeFileSync(NodePath.join(dir, "no-driver.meta.json"), JSON.stringify({}), "utf8");

    assert.throws(() => loadFixture(dir, "no-driver"), /driver/);
  });
});
