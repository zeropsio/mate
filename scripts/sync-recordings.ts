#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off preferSchemaOverJson:off -- copies a producer's files.
/**
 * `node scripts/sync-recordings.ts <producer checkout>`: the one writer of
 * `packages/test-recordings/<producer>/`. It copies the checkout's `conformance/recordings/*.json`
 * byte for byte into the directory of the producer their `$provenance` names, and removes the
 * recordings that producer no longer makes. Whether they decode is the recordings' own test.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export interface SyncedRecordings {
  readonly producer: string;
  readonly copied: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

const producerOf = (file: string, text: string): string => {
  const producer: unknown = JSON.parse(text)?.$provenance?.producer;
  if (typeof producer !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(producer))
    throw new Error(`${file}: $provenance.producer is not a producer name.`);
  return producer;
};

export function syncRecordings(checkout: string, target: string): SyncedRecordings {
  const source = NodePath.join(checkout, "conformance", "recordings");
  const names = NodeFS.readdirSync(source)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (!names.length) throw new Error(`${source} holds no recordings.`);
  const texts = new Map(
    names.map((name) => [name, NodeFS.readFileSync(NodePath.join(source, name))]),
  );
  const named = new Set(
    [...texts].map(([name, bytes]) => producerOf(name, bytes.toString("utf8"))),
  );
  if (named.size !== 1)
    throw new Error(`${source} names ${[...named].join(", ")}; one checkout is one producer.`);
  const producer = [...named][0]!;
  const directory = NodePath.join(target, producer);
  NodeFS.mkdirSync(directory, { recursive: true });
  const removed = NodeFS.readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !texts.has(name))
    .sort();
  for (const name of removed) NodeFS.rmSync(NodePath.join(directory, name));
  for (const [name, bytes] of texts) NodeFS.writeFileSync(NodePath.join(directory, name), bytes);
  return { producer, copied: names, removed };
}

if (import.meta.main) {
  try {
    const [checkout, ...rest] = process.argv.slice(2);
    if (!checkout || rest.length)
      throw new Error("Usage: node scripts/sync-recordings.ts <producer checkout>");
    const { producer, copied, removed } = syncRecordings(
      NodePath.resolve(checkout),
      NodePath.resolve(import.meta.dirname, "..", "packages", "test-recordings"),
    );
    console.log(
      `${producer}: ${copied.length} recordings copied${removed.length ? `, removed ${removed.join(", ")}` : ""}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
