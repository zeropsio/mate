// @effect-diagnostics nodeBuiltinImport:off -- reads the committed recordings beside it.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { HqScopeDelivery } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";

const schemas = { "scope-reset": HqScopeDelivery };

const decodeRecording = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      $provenance: Schema.Struct({
        producer: Schema.String,
        schema: Schema.String,
        target: Schema.String,
        command: Schema.String,
        steps: Schema.Array(Schema.String),
        recordedAt: Schema.String,
      }),
      value: Schema.Unknown,
    }),
  ),
);

export function recorded(schema: keyof typeof schemas, name: `${string}/${string}`) {
  const file = NodePath.join(import.meta.dirname, "recordings", `${name}.json`);
  try {
    const recording = decodeRecording(NodeFS.readFileSync(file, "utf8"));
    const producer = NodePath.posix.dirname(name);
    if (recording.$provenance.producer !== producer)
      throw new Error(`names producer "${recording.$provenance.producer}", expected "${producer}"`);
    if (recording.$provenance.schema !== schema)
      throw new Error(`names schema "${recording.$provenance.schema}", expected "${schema}"`);
    return Schema.decodeUnknownSync(schemas[schema])(recording.value);
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}
