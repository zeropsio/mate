#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalJsonInEffect:off -- copies a producer's files.
/**
 * `node scripts/sync-recordings.ts <producer checkout>`: the one writer of
 * `packages/test-recordings/<producer>/`. It copies the checkout's `conformance/recordings/*.json`
 * whose `$provenance.schema` a consumer here decodes byte for byte into the directory of the
 * producer their `$provenance` names, skips the ones nothing here consumes, and removes the rest.
 * Whether they decode is the recordings' own test.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { consumes } from "@t3tools/test-recordings/recorded";

export interface SyncedRecordings {
  readonly producer: string;
  readonly copied: ReadonlyArray<string>;
  /** Recorded under a schema no consumer here decodes. */
  readonly skipped: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

const schemaOf = (text: string): unknown => JSON.parse(text)?.$provenance?.schema;

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
  const skipped = names.filter((name) => {
    const schema = schemaOf(texts.get(name)!.toString("utf8"));
    return typeof schema !== "string" || !consumes(schema);
  });
  for (const name of skipped) texts.delete(name);
  const directory = NodePath.join(target, producer);
  NodeFS.mkdirSync(directory, { recursive: true });
  const removed = NodeFS.readdirSync(directory)
    .filter((name) => name.endsWith(".json") && !texts.has(name))
    .sort();
  for (const name of removed) NodeFS.rmSync(NodePath.join(directory, name));
  for (const [name, bytes] of texts) NodeFS.writeFileSync(NodePath.join(directory, name), bytes);
  return { producer, copied: [...texts.keys()], skipped, removed };
}

if (import.meta.main) {
  try {
    const [checkout, ...rest] = process.argv.slice(2);
    if (!checkout || rest.length)
      throw new Error("Usage: node scripts/sync-recordings.ts <producer checkout>");
    const { producer, copied, skipped, removed } = syncRecordings(
      NodePath.resolve(checkout),
      NodePath.resolve(import.meta.dirname, "..", "packages", "test-recordings"),
    );
    console.log(
      `${producer}: ${copied.length} recordings copied${skipped.length ? `, skipped ${skipped.join(", ")} (no consumer)` : ""}${removed.length ? `, removed ${removed.join(", ")}` : ""}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
