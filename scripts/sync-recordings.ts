#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalJsonInEffect:off -- copies a producer's files.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

function syncRecordings(checkout: string, names: string[]) {
  const directory = NodePath.resolve(
    import.meta.dirname,
    "../packages/client-runtime/src/data/__fixtures__/recordings/mate-hq",
  );
  const held = NodeFS.existsSync(directory)
    ? NodeFS.readdirSync(directory).filter((name) => name.endsWith(".json"))
    : [];
  const files = [...new Set([...held, ...names.map((name) => `${name}.json`)])].sort();
  if (files.length === 0) throw new Error("nothing to copy");

  const recordings = files.map((name) => {
    const source = NodePath.join(checkout, "recordings", "answers", name);
    if (NodePath.basename(name) !== name) throw new Error(`${source}: expected a recording name`);
    const bytes = NodeFS.readFileSync(source);
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
