// @effect-diagnostics nodeBuiltinImport:off -- reads the committed recordings beside it.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { HqGithubView } from "@t3tools/shared/hqGithub";
import { HqRefusal } from "@t3tools/shared/hqProblems";
import { HqScopeDelivery } from "@t3tools/shared/hqStream";
import * as Schema from "effect/Schema";

const schemas = {
  "scope-reset": HqScopeDelivery,
  "GET /api/org/github 200": HqGithubView,
  "GET /api/activity 403": HqRefusal,
};

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

export function recorded<K extends keyof typeof schemas>(
  schema: K,
  name: `${string}/${string}`,
): (typeof schemas)[K]["Type"] {
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
