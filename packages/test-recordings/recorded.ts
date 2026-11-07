// @effect-diagnostics nodeBuiltinImport:off -- reads the committed recordings beside it.
/**
 * Wire-shaped test input as its producer really sent it. A producer's own suite records what it
 * sends as `<producer>/<name>.json` — a `$provenance` header and the `value` —,
 * `scripts/sync-recordings.ts` copies those files here verbatim, and nothing else writes them.
 * `recorded(name, edit?)` decodes the value through the schema its header names, applies the test's
 * edit and decodes the result again: a test reads only what the wire can carry.
 *
 * @module test-recordings/recorded
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { HqNavigationProject } from "@t3tools/shared/hqStream";
import { Schema } from "effect";

/** A recorded value as the consumer's schema decodes it. */
export type Recorded = HqNavigationProject;

/** The consumer's schema for each `$provenance.schema` a producer records under. */
const schemas: ReadonlyMap<string, Schema.Decoder<Recorded>> = new Map([
  ["navigation project:<id>", HqNavigationProject],
]);

const decodeRecording = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      $provenance: Schema.Struct({
        producer: Schema.String,
        revision: Schema.String,
        schema: Schema.String,
      }),
      value: Schema.Unknown,
    }),
  ),
);

/** The producers recorded under `root`: one directory each. */
export const producers = (root: string): string[] =>
  NodeFS.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
    .map((entry) => entry.name)
    .sort();

/** `recorded` over the producers' directories under `root`. */
export function recordedIn(root: string) {
  return (name: string, edit?: (value: Recorded) => Recorded): Recorded => {
    const files = producers(root)
      .map((producer) => NodePath.join(root, producer, `${name}.json`))
      .filter((file) => NodeFS.existsSync(file));
    if (files.length !== 1)
      throw new Error(`${files.length} recordings named ${name} under ${root}, not one.`);
    const file = files[0]!;
    try {
      const recording = decodeRecording(NodeFS.readFileSync(file, "utf8"));
      const schema = schemas.get(recording.$provenance.schema);
      if (!schema) throw new Error(`names no known schema "${recording.$provenance.schema}"`);
      const decode = Schema.decodeUnknownSync(schema);
      const value = decode(recording.value);
      return edit ? decode(edit(value)) : value;
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
  };
}

/** A committed recording by name, decoded, edited by the test and decoded again. */
export const recorded = recordedIn(import.meta.dirname);
