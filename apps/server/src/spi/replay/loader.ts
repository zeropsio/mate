// @effect-diagnostics nodeBuiltinImport:off
/**
 * SPI replay fixture loader: reads `<dir>/<name>.jsonl` + `<dir>/<name>.meta.json`
 * into a `Fixture` (see types.ts for the line/meta shapes). Pure I/O + parsing —
 * no driver-specific interpretation lives here.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { Fixture, FixtureLine, FixtureMeta } from "./types.ts";

function parseLine(raw: string, lineNumber: number, jsonlPath: string): FixtureLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${jsonlPath}:${lineNumber}: invalid JSON (${String(cause)})`);
  }

  if (typeof parsed !== "object" || parsed === null || !("kind" in parsed)) {
    throw new Error(`${jsonlPath}:${lineNumber}: line has no "kind" field`);
  }

  const kind = (parsed as { readonly kind: unknown }).kind;

  if (kind === "message") {
    if (!("message" in parsed)) {
      throw new Error(`${jsonlPath}:${lineNumber}: "message" line is missing its "message" field`);
    }
    return { kind: "message", message: (parsed as { readonly message: unknown }).message };
  }

  if (kind === "control") {
    const line = parsed as {
      readonly name?: unknown;
      readonly args?: unknown;
      readonly answer?: unknown;
    };
    if (typeof line.name !== "string" || line.name.length === 0) {
      throw new Error(`${jsonlPath}:${lineNumber}: "control" line is missing its "name" field`);
    }
    return { kind: "control", name: line.name, args: line.args, answer: line.answer };
  }

  throw new Error(`${jsonlPath}:${lineNumber}: unknown kind ${JSON.stringify(kind)}`);
}

/** Loads and parses `<dir>/<name>.jsonl` + `<dir>/<name>.meta.json`. Throws on any structural problem, naming the file and line. */
export function loadFixture(dir: string, name: string): Fixture {
  const jsonlPath = NodePath.join(dir, `${name}.jsonl`);
  const metaPath = NodePath.join(dir, `${name}.meta.json`);

  const meta = JSON.parse(NodeFS.readFileSync(metaPath, "utf8")) as FixtureMeta;
  if (typeof meta.driver !== "string" || meta.driver.length === 0) {
    throw new Error(`${metaPath}: missing required "driver" field`);
  }

  const lines = NodeFS.readFileSync(jsonlPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => parseLine(line, index + 1, jsonlPath));

  return { name, dir, meta, lines };
}
