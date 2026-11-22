#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalJsonInEffect:off -- copies a producer's files.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { readHqRef } from "./hq-ref.ts";

/** The copies' directory, as a path inside a z3 tree. */
export const recordingsDirectory =
  "packages/client-runtime/src/data/__fixtures__/recordings/mate-hq";

/** The `*.json` copies a z3 tree holds. */
function heldCopies(root: string): string[] {
  const directory = NodePath.join(root, recordingsDirectory);
  return NodeFS.existsSync(directory)
    ? NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))
    : [];
}

/** A recording's bytes in mate-hq at `pin`; undefined when the pin lacks it. */
function pinnedRecording(checkout: string, pin: string, name: string): Buffer | undefined {
  const show = NodeChildProcess.spawnSync("git", [
    "-C",
    checkout,
    "show",
    `${pin}:recordings/answers/${name}`,
  ]);
  return show.status === 0 ? show.stdout : undefined;
}

/** The copies `root` holds whose bytes differ from, or are missing in, mate-hq at `pin`. */
export function recordingsOffPin(root: string, checkout: string, pin: string): string[] {
  return heldCopies(root)
    .filter((name) => {
      const pinned = pinnedRecording(checkout, pin, name);
      return (
        pinned === undefined ||
        !pinned.equals(NodeFS.readFileSync(NodePath.join(root, recordingsDirectory, name)))
      );
    })
    .sort();
}

function syncRecordings(checkout: string, names: string[]) {
  const root = NodePath.resolve(import.meta.dirname, "..");
  const pin = readHqRef(root);
  const directory = NodePath.join(root, recordingsDirectory);
  const files = [...new Set([...heldCopies(root), ...names.map((name) => `${name}.json`)])].sort();
  if (files.length === 0) throw new Error("nothing to copy");

  const recordings = files.map((name) => {
    const source = `${checkout} ${pin}:recordings/answers/${name}`;
    if (NodePath.basename(name) !== name) throw new Error(`${source}: expected a recording name`);
    const bytes = pinnedRecording(checkout, pin, name);
    if (bytes === undefined) throw new Error(`${source}: not in mate-hq at the pin`);
    try {
      if (JSON.parse(bytes.toString("utf8"))?.$provenance?.producer !== "mate-hq")
        throw new Error('expected $provenance.producer to be "mate-hq"');
    } catch (error) {
      throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { name, bytes };
  });

  NodeFS.mkdirSync(directory, { recursive: true });
  for (const { name, bytes } of recordings)
    NodeFS.writeFileSync(NodePath.join(directory, name), bytes);
  console.log(`mate-hq: ${files.length} recordings copied (${files.join(", ")})`);
}

if (import.meta.main) {
  try {
    const [checkout, ...names] = process.argv.slice(2);
    if (!checkout)
      throw new Error("Usage: node scripts/sync-recordings.ts <mate-hq checkout> [<name>…]");
    syncRecordings(NodePath.resolve(checkout), names);
  } catch (error) {
    console.error(
      (error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/gu, " "),
    );
    process.exitCode = 1;
  }
}
